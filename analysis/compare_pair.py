"""Blueprint Step C: calibrated power -> dB (10*log10, never 20*log10), temporal deltas, COG outputs."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.shutil import copy as rio_copy

from analysis import config


def power_to_db(power: np.ndarray, valid: np.ndarray | None = None) -> np.ndarray:
    """10*log10(power) for finite power > 0 (and `valid`); NaN elsewhere. Never returns -inf."""
    p = np.asarray(power, dtype=np.float64)
    ok = np.isfinite(p) & (p > 0)
    if valid is not None:
        ok &= valid
    out = np.full(p.shape, np.nan, np.float32)
    out[ok] = 10.0 * np.log10(p[ok])
    return out


def compute_layers(prep: dict) -> dict[str, np.ndarray]:
    v = prep["valid"]
    out = {"a_hh_db": power_to_db(prep["a"]["HHHH"], v)}
    has_hv = "HVHV" in prep["a"]
    if has_hv:
        out["a_hv_db"] = power_to_db(prep["a"]["HVHV"], v)
    if "b" in prep:
        out["b_hh_db"] = power_to_db(prep["b"]["HHHH"], v)
        out["delta_hh_db"] = out["b_hh_db"] - out["a_hh_db"]
        if has_hv:
            out["b_hv_db"] = power_to_db(prep["b"]["HVHV"], v)
            out["delta_hv_db"] = out["b_hv_db"] - out["a_hv_db"]
            out["delta_ratio_db"] = out["delta_hh_db"] - out["delta_hv_db"]  # change in HH/HV ratio, dB
    return out


def display_ranges(layers: dict, valid: np.ndarray) -> dict:
    """Shared 2-98 % stretch for Date A and Date B of the same channel; symmetric fixed range for deltas."""
    lo, hi = config.BACKSCATTER_PERCENTILES
    r = {}
    for ch in ("hh", "hv"):
        vals = [layers[k][valid] for k in (f"a_{ch}_db", f"b_{ch}_db") if k in layers]
        if vals:
            v = np.concatenate(vals)
            v = v[np.isfinite(v)]
            if v.size:
                p = np.percentile(v, [lo, hi])
                for k in (f"a_{ch}_db", f"b_{ch}_db"):
                    if k in layers:
                        r[k] = {"min": round(float(p[0]), 2), "max": round(float(p[1]), 2), "unit": "dB",
                                "colormap": "greys_r", "stretch": f"joint p{lo}-p{hi} of Date A and Date B"}
    d = config.DELTA_RANGE_DB
    for k in ("delta_hh_db", "delta_hv_db", "delta_ratio_db"):
        if k in layers:
            r[k] = {"min": -d, "max": d, "unit": "dB", "colormap": "rdbu_r",
                    "stretch": f"symmetric +/-{d:g} dB, clipped"}
    r["valid_mask"] = {"min": 0, "max": 1, "unit": "", "colormap": "valid_mask",
                       "stretch": "1 = analysed, 0 = excluded inside AOI"}
    return r


def write_cog(path: Path, arr: np.ndarray, transform, crs, nodata) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    profile = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype,
                   crs=crs, transform=transform, nodata=nodata)
    with MemoryFile() as mf, mf.open(**profile) as ds:
        ds.write(arr, 1)
        rio_copy(ds, path, driver="COG", compress="DEFLATE", blocksize=256, bigtiff="IF_SAFER",
                 overview_resampling="nearest" if arr.dtype == np.uint8 else "average")


def write_outputs(prep: dict, layers: dict, out_dir: Path) -> tuple[dict, dict]:
    t, crs = prep["transform"], prep["crs"]
    paths = {}
    for k, arr in layers.items():
        write_cog(out_dir / "cog" / f"{k}.tif", arr.astype(np.float32), t, crs, np.nan)
        paths[k] = f"cog/{k}.tif"
    vm = np.full(prep["shape"], 255, np.uint8)
    vm[prep["aoi_mask"]] = 0
    vm[prep["valid"]] = 1
    write_cog(out_dir / "cog" / "valid_mask.tif", vm, t, crs, 255)
    paths["valid_mask"] = "cog/valid_mask.tif"
    # Linear-power audit layers (as delivered, unmasked).
    audit = {}
    for date in ("a", "b"):
        for ch, arr in prep.get(date, {}).items():
            k = f"{date}_{ch.lower()}_linear"
            write_cog(out_dir / "cog" / "audit" / f"{k}.tif", arr.astype(np.float32), t, crs, np.nan)
            audit[k] = f"cog/audit/{k}.tif"
    return paths, audit


def read_cog(path) -> np.ndarray:
    with rasterio.open(path) as ds:
        return ds.read(1)
