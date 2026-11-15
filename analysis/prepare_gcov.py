"""Blueprint Step B: put both scenes on one reference grid, clipped to AOI and common footprint,
and build the joint valid mask. Scene A's grid is the reference; scene B is sliced when pixel-aligned
and warped only when it is not (recorded in the returned `record`)."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.features import geometry_mask
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject
from shapely.geometry import box, shape
import shapely
from shapely.ops import unary_union

from analysis import config


def load_aoi(path) -> tuple:
    gj = json.loads(Path(path).read_text())
    feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    geom = unary_union([shape(f["geometry"]) for f in feats])
    return geom, (feats[0].get("properties") or {})


def to_crs(geom, dst_epsg: int, src: int = 4326):
    if src == dst_epsg:
        return geom
    t = Transformer.from_crs(src, dst_epsg, always_xy=True)
    return shapely.transform(geom, lambda x, y: t.transform(x, y), interleaved=False)


def _bounds(sc):
    t, (h, w) = sc.transform, sc.shape
    return box(min(t.c, t.c + t.a * w), min(t.f, t.f + t.e * h), max(t.c, t.c + t.a * w), max(t.f, t.f + t.e * h))


def _window(t: Affine, shape_, geom) -> tuple[int, int, int, int]:
    """Pixel window (r0, r1, c0, c1) on grid `t` covering `geom`, snapped outward and clipped."""
    minx, miny, maxx, maxy = geom.bounds
    inv = ~t
    cols, rows = zip(*[inv @ (x, y) for x in (minx, maxx) for y in (miny, maxy)])
    r0, r1 = max(0, math.floor(min(rows) + 1e-9)), min(shape_[0], math.ceil(max(rows) - 1e-9))
    c0, c1 = max(0, math.floor(min(cols) + 1e-9)), min(shape_[1], math.ceil(max(cols) - 1e-9))
    if r1 <= r0 or c1 <= c0:
        raise ValueError("AOI does not intersect the common scene footprint")
    return r0, r1, c0, c1


class Decimated:
    """Scene adapter on an n-times coarser grid: power = mean of the valid (finite, > 0) linear-power samples in each
    n x n block (spatial multilook while reading), mask = block-centre code. Lets a whole delta run at 50 m in small
    memory. Everything downstream (QA, prep, dB, detection) is unchanged and sees the coarse transform."""

    STRIP = 512  # rows of the full-res grid read at a time (matches the 512 x 512 HDF5 chunks)

    def __init__(self, scene, n: int):
        self.scene, self.n = scene, n
        self.transform = scene.transform * Affine.scale(n)
        self.shape = (scene.shape[0] // n, scene.shape[1] // n)

    def __getattr__(self, k):  # crs, meta, ... come from the wrapped scene
        return getattr(self.scene, k)

    def read(self, layer: str, win=None):
        n = self.n
        r0, r1, c0, c1 = win if win else (0, self.shape[0], 0, self.shape[1])
        out = np.empty((r1 - r0, c1 - c0), np.float32 if layer != "mask" else np.uint8)
        step = max(1, self.STRIP // n)
        for i in range(r0, r1, step):
            j = min(r1, i + step)
            blk = self.scene.read(layer, (i * n, j * n, c0 * n, c1 * n))
            blk = blk.reshape(j - i, n, c1 - c0, n)
            if layer == "mask":
                out[i - r0:j - r0] = blk[:, n // 2, :, n // 2]
            else:
                b = blk.astype(np.float32)
                ok = np.isfinite(b) & (b > 0)
                cnt = ok.sum(axis=(1, 3))
                sm = np.where(ok, b, 0).sum(axis=(1, 3))
                out[i - r0:j - r0] = np.where(cnt > 0, sm / np.maximum(cnt, 1), np.nan)
        return out


def zero_is_invalid(scene) -> bool:
    """Mask code 0 means 'invalid' only when the product applied sub-swath validity masking.
    If the product says validSamplesSubSwathMaskingApplied=False, 0 carries no validity information."""
    return scene.meta.get("subswath_masking_applied") is not False


def scene_valid(power: list[np.ndarray], mask: np.ndarray, zero_invalid: bool = True) -> tuple[np.ndarray, dict]:
    """Valid where every power layer is finite and > 0 and the mask code is a valid sub-swath (1..5)
    (or 0 too, when the product did not apply sub-swath masking)."""
    fill = mask == config.MASK_FILL
    invalid = (mask == config.MASK_INVALID) if zero_invalid else np.zeros(mask.shape, bool)
    lo = config.MASK_VALID_MIN if zero_invalid else config.MASK_INVALID
    other = ~fill & ~invalid & ((mask < lo) | (mask > config.MASK_VALID_MAX))
    nonfinite = np.zeros(mask.shape, bool)
    nonpos = np.zeros(mask.shape, bool)
    for p in power:
        nonfinite |= ~np.isfinite(p)
        with np.errstate(invalid="ignore"):
            nonpos |= np.isfinite(p) & (p <= 0)
    valid = ~(fill | invalid | other | nonfinite | nonpos)
    counts = {"mask_fill_255": int(fill.sum()), "mask_invalid_0": int(invalid.sum()),
              "mask_unexpected_code": int(other.sum()), "power_nonfinite": int(nonfinite.sum()),
              "power_nonpositive": int(nonpos.sum())}
    return valid, counts


def prepare(scene_a, scene_b, aoi_4326, use_hv: bool) -> dict:
    """Returns arrays on the reference grid plus a `record` of every preprocessing decision."""
    epsg = scene_a.crs.to_epsg()
    aoi = to_crs(aoi_4326, epsg)
    common = aoi.intersection(_bounds(scene_a))
    if scene_b is not None:
        bb = _bounds(scene_b)
        if scene_b.crs != scene_a.crs:
            bb = to_crs(to_crs(bb, 4326, src=scene_b.crs.to_epsg()), epsg)
        common = common.intersection(bb)
    if common.is_empty:
        raise ValueError("AOI does not intersect the common scene footprint")
    r0, r1, c0, c1 = _window(scene_a.transform, scene_a.shape, common)
    t = scene_a.transform @ Affine.translation(c0, r0)
    shp = (r1 - r0, c1 - c0)
    chans = ["HHHH", "HVHV"] if use_hv else ["HHHH"]
    apply_sigma = config.APPLY_GAMMA_TO_SIGMA
    record = {"reference_grid": "scene_a", "window_rows_cols": [r0, r1, c0, c1], "crs_epsg": epsg,
              "transform": [t.a, t.b, t.c, t.d, t.e, t.f], "shape": list(shp),
              "pixel_area_m2": abs(t.a * t.e), "channels": chans,
              "radiometric_convention": "sigma0 (rtcGammaToSigmaFactor applied to both dates)" if apply_sigma
              else "gamma0 (as delivered, both dates)", "scene_b_resampled": False}

    def read_scene(sc, win):
        layers = {c: sc.read(c, win).astype(np.float32) for c in chans}
        m = sc.read("mask", win).astype(np.uint8)
        if apply_sigma:
            f = sc.read("rtcGammaToSigmaFactor", win).astype(np.float32)
            layers = {k: v * f for k, v in layers.items()}
        return layers, m

    a_layers, a_mask = read_scene(scene_a, (r0, r1, c0, c1))
    out = {"transform": t, "crs": CRS.from_epsg(epsg), "shape": shp, "record": record,
           "a": a_layers, "a_mask": a_mask}

    if scene_b is not None:
        tb = scene_b.transform
        same_grid = (scene_b.crs == scene_a.crs and np.isclose(tb.a, t.a) and np.isclose(tb.e, t.e)
                     and np.isclose(((t.c - tb.c) / t.a) % 1, 0, atol=1e-6)
                     and np.isclose(((t.f - tb.f) / t.e) % 1, 0, atol=1e-6))
        if same_grid:
            bc0, br0 = round((t.c - tb.c) / t.a), round((t.f - tb.f) / t.e)
            b_layers, b_mask = read_scene(scene_b, (br0, br0 + shp[0], bc0, bc0 + shp[1]))
            record["scene_b_offset_rows_cols"] = [br0, bc0]
        else:
            # ponytail: reads scene B's window around the common area, then warps once onto A's grid.
            src_geom = to_crs(to_crs(box(*_bounds_of(t, shp)), 4326, src=epsg), scene_b.crs.to_epsg()).buffer(
                3 * abs(tb.a))
            bw = _window(tb, scene_b.shape, src_geom)
            btr = tb @ Affine.translation(bw[2], bw[0])
            raw_layers, raw_mask = read_scene(scene_b, bw)
            b_layers = {}
            for k, v in raw_layers.items():
                dst = np.full(shp, np.nan, np.float32)
                reproject(v, dst, src_transform=btr, src_crs=scene_b.crs, dst_transform=t, dst_crs=out["crs"],
                          resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
                b_layers[k] = dst
            b_mask = np.full(shp, config.MASK_FILL, np.uint8)
            reproject(raw_mask, b_mask, src_transform=btr, src_crs=scene_b.crs, dst_transform=t,
                      dst_crs=out["crs"], resampling=Resampling.nearest, src_nodata=config.MASK_FILL,
                      dst_nodata=config.MASK_FILL)
            record.update({"scene_b_resampled": True, "resampling_power": "bilinear",
                           "resampling_mask": "nearest", "scene_b_src_crs_epsg": scene_b.crs.to_epsg()})
        out["b"], out["b_mask"] = b_layers, b_mask

    aoi_mask = geometry_mask([aoi], out_shape=shp, transform=t, invert=True)
    za = zero_is_invalid(scene_a)
    record["mask_rule_scene_a"] = "0 invalid, 1-5 valid, 255 fill" if za else         "sub-swath masking not applied in product: 0 and 1-5 valid if power finite > 0, 255 fill"
    va, _ = scene_valid(list(a_layers.values()), a_mask, za)
    valid = va & aoi_mask
    stats = {"aoi_pixels": int(aoi_mask.sum()), "scene_a_exclusions_in_aoi": _in(a_mask, aoi_mask, a_layers, za)}
    if scene_b is not None:
        zb = zero_is_invalid(scene_b)
        record["mask_rule_scene_b"] = "0 invalid, 1-5 valid, 255 fill" if zb else             "sub-swath masking not applied in product: 0 and 1-5 valid if power finite > 0, 255 fill"
        vb, _ = scene_valid(list(out["b"].values()), out["b_mask"], zb)
        valid &= vb
        stats["scene_b_exclusions_in_aoi"] = _in(out["b_mask"], aoi_mask, out["b"], zb)
    stats["common_valid_pixels"] = int(valid.sum())
    stats["common_valid_fraction"] = valid.sum() / max(1, aoi_mask.sum())
    stats["aoi_area_ha"] = aoi_mask.sum() * record["pixel_area_m2"] / 1e4
    stats["analysed_area_ha"] = valid.sum() * record["pixel_area_m2"] / 1e4
    out.update(aoi_mask=aoi_mask, valid=valid, stats=stats)
    return out


def _in(mask, aoi_mask, layers, zero_invalid):
    _, counts = scene_valid([v[aoi_mask] for v in layers.values()], mask[aoi_mask], zero_invalid)
    return counts


def _bounds_of(t: Affine, shp):
    x0, y0 = t.c, t.f
    x1, y1 = t.c + t.a * shp[1], t.f + t.e * shp[0]
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)
