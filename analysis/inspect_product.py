"""Open a NISAR L2-GCOV product (HDF5, or GeoTIFF/COG + sidecar JSON) and describe it.

    python -m analysis.inspect_product <scene.h5 | scene.scene.json> [--out scene_manifest.json]

HDF5 paths follow the ISRO NISAR L&S Product Format Document v1.2.1 / JPL D-102274:
/science/{SSAR|LSAR}/identification/* and /science/{SSAR|LSAR}/GCOV/grids/frequencyA/*.
The band group is discovered from the file, never assumed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

import h5py
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.windows import Window

from analysis import config

# Naming convention: ISRO Product Format Doc sec 2.2.1 / ASF NISAR GCOV guide.
NAME_RE = re.compile(
    r"^NISAR_(?P<instrument>[LS])(?P<level>\d)_(?P<processing_type>[A-Z]{2})_(?P<product>[A-Z]{4})_"
    r"(?P<cycle>\d{3})_(?P<track>\d{3})_(?P<direction>[AD])_(?P<frame>\d{3})_(?P<mode>\d{4})_"
    r"(?P<pole>[A-Z]{4})_(?P<source>[AM])_(?P<start>\d{8}T\d{6})_(?P<end>\d{8}T\d{6})_"
    r"(?P<crid>[A-Z0-9]{6})_(?P<accuracy>[PMNF])_(?P<coverage>[FP])_(?P<location>[A-Z])_(?P<counter>\d{3})$"
)
POLE_CODES = {
    "SH": ["HH"], "SV": ["VV"], "DH": ["HH", "HV"], "DV": ["VV", "VH"],
    "CL": ["LH", "LV"], "CR": ["RH", "RV"], "QP": ["HH", "HV", "VV", "VH"], "NA": [],
}
LAYERS = ("HHHH", "HVHV", "mask", "numberOfLooks", "rtcGammaToSigmaFactor")


def parse_product_name(name: str) -> dict | None:
    """Decode a NISAR product identifier. Returns None if it does not follow the convention."""
    m = NAME_RE.match(Path(name).name.removesuffix(".h5"))
    if not m:
        return None
    d = m.groupdict()
    iso = lambda s: datetime.strptime(s, "%Y%m%dT%H%M%S").strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        **d,
        "band": d["instrument"],
        "cycle": int(d["cycle"]), "track": int(d["track"]), "frame": int(d["frame"]),
        "bandwidth_primary_mhz_code": d["mode"][:2], "bandwidth_secondary_mhz_code": d["mode"][2:],
        "polarizations_primary": POLE_CODES.get(d["pole"][:2]),
        "start_utc": iso(d["start"]), "end_utc": iso(d["end"]),
    }


def _s(v):
    if isinstance(v, bytes):
        return v.decode()
    if isinstance(v, np.ndarray):
        return [_s(x) for x in v.tolist()]
    if isinstance(v, np.generic):
        return v.item()
    return v


def _iso_utc(s: str) -> str:
    """'2008-10-12T06:09:11.567105263' -> '2008-10-12T06:09:11.567105Z' (datetime keeps 6 digits)."""
    s = s.strip().rstrip("Z")
    if "." in s:
        head, frac = s.split(".", 1)
        s = f"{head}.{frac[:6]}"
    return datetime.fromisoformat(s).isoformat() + "Z"


def _bool(v):
    return None if v is None else str(v).strip().lower() == "true"


def _direction(v: str) -> str:
    return {"ascending": "A", "descending": "D"}.get(str(v).lower(), str(v).upper()[:1])


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


class H5Scene:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.f = h5py.File(self.path, "r")
        sci = self.f["science"]
        bands = [k for k in sci.keys() if k.endswith("SAR")]
        if not bands:
            raise ValueError(f"{path}: no /science/*SAR group")
        self.band_group = bands[0]
        root = f"science/{self.band_group}"
        self.grid_path = f"{root}/GCOV/grids/{config.FREQUENCY}"
        if self.grid_path not in self.f:
            raise ValueError(f"{path}: missing {self.grid_path} (is this a GCOV product?)")
        g = self.f[self.grid_path]
        ident = {k: _s(v[()]) for k, v in self.f[f"{root}/identification"].items() if isinstance(v, h5py.Dataset)}
        x, y = g["xCoordinates"][:], g["yCoordinates"][:]
        dx = float(g["xCoordinateSpacing"][()]) if "xCoordinateSpacing" in g else float(x[1] - x[0])
        dy = float(g["yCoordinateSpacing"][()]) if "yCoordinateSpacing" in g else float(y[1] - y[0])
        if len(x) > 1 and not np.isclose(x[1] - x[0], dx):
            raise ValueError(f"xCoordinates step {x[1]-x[0]} != xCoordinateSpacing {dx}")
        if len(y) > 1 and not np.isclose(y[1] - y[0], dy):
            raise ValueError(f"yCoordinates step {y[1]-y[0]} != yCoordinateSpacing {dy}")
        # Coordinates are pixel centres (JPL D-102274 sec 4.2) -> shift half a pixel for the corner.
        self.transform = Affine(dx, 0, float(x[0]) - dx / 2, 0, dy, float(y[0]) - dy / 2)
        self.crs = CRS.from_epsg(int(g["projection"].attrs["epsg_code"]))
        self.shape = (len(y), len(x))
        self.channels = [k for k in LAYERS if k in g]

        meta_root = f"{root}/GCOV/metadata"
        def opt(p):
            p = f"{meta_root}/{p}"
            return _s(self.f[p][()]) if p in self.f else None
        bw = opt(f"sourceData/swaths/{config.FREQUENCY}/acquiredRangeBandwidth") or opt(
            f"sourceData/swaths/{config.FREQUENCY}/processedRangeBandwidth")
        self.ident = ident
        self.meta = {
            "scene_id": ident.get("granuleId") or self.path.stem,
            "band": ident.get("radarBand"),
            "product_type": ident.get("productType"),
            "mission_id": ident.get("missionId"),
            "instrument": ident.get("instrumentName"),
            "start_utc": _iso_utc(ident["zeroDopplerStartTime"]),
            "end_utc": _iso_utc(ident["zeroDopplerEndTime"]),
            "orbit_direction": _direction(ident.get("orbitPassDirection", "")),
            "relative_track": ident.get("trackNumber"),
            "frame": ident.get("frameNumber"),
            "range_bandwidth_hz": bw,
            "polarizations": _s(g["listOfPolarizations"][:]) if "listOfPolarizations" in g else None,
            "crid": ident.get("compositeReleaseId"),
            "processing_center": ident.get("processingCenter"),
            "product_version": ident.get("productVersion"),
            "is_full_frame": ident.get("isFullFrame"),
            "bounding_polygon_wkt": ident.get("boundingPolygon"),
            "backscatter_convention": opt("processingInformation/parameters/rtc/outputBackscatterNormalizationConvention"),
            # "False" in e.g. the NASA ALOS-derived sample: mask then holds 0 for every imaged pixel.
            "subswath_masking_applied": _bool(opt("processingInformation/parameters/validSamplesSubSwathMaskingApplied")),
        }

    def read(self, layer: str, win: tuple[int, int, int, int] | None = None) -> np.ndarray:
        d = self.f[f"{self.grid_path}/{layer}"]
        if win is None:
            return d[:]
        r0, r1, c0, c1 = win
        return d[r0:r1, c0:c1]


class TiffScene:
    """GeoTIFF/COG layers (e.g. Bhoonidhi HDF-to-GeoTIFF export) described by a sidecar JSON.

    Sidecar schema (docs/DATA_ACQUISITION.md): scene_id, band, product_type, start_utc, end_utc,
    orbit_direction, relative_track, frame, bandwidth_mode, polarization_code, crid,
    backscatter_convention, layers: {HHHH, HVHV?, mask, numberOfLooks?, rtcGammaToSigmaFactor?} -> paths
    relative to the sidecar.
    """

    def __init__(self, sidecar: Path):
        self.path = Path(sidecar)
        sc = json.loads(self.path.read_text())
        missing = [k for k in ("scene_id", "band", "product_type", "start_utc", "end_utc", "orbit_direction",
                               "relative_track", "frame", "layers") if k not in sc]
        if missing:
            raise ValueError(f"{sidecar}: sidecar missing {missing}")
        self.files = {k: self.path.parent / v for k, v in sc["layers"].items()}
        with rasterio.open(self.files["HHHH"]) as ds:
            self.transform, self.crs, self.shape = ds.transform, ds.crs, (ds.height, ds.width)
        for k, p in self.files.items():
            with rasterio.open(p) as ds:
                if ds.transform != self.transform or ds.crs != self.crs or (ds.height, ds.width) != self.shape:
                    raise ValueError(f"{p}: grid differs from HHHH layer")
        self.channels = [k for k in LAYERS if k in self.files]
        pol = sc.get("polarization_code")
        self.ident = sc
        self.meta = {
            "scene_id": sc["scene_id"], "band": sc["band"], "product_type": sc["product_type"],
            "mission_id": sc.get("mission_id"), "instrument": sc.get("instrument"),
            "start_utc": _iso_utc(sc["start_utc"]), "end_utc": _iso_utc(sc["end_utc"]),
            "orbit_direction": _direction(sc["orbit_direction"]),
            "relative_track": int(sc["relative_track"]), "frame": int(sc["frame"]),
            "range_bandwidth_hz": sc.get("range_bandwidth_hz"),
            "polarizations": sc.get("polarizations") or (POLE_CODES.get(pol[:2]) if pol else None),
            "crid": sc.get("crid"), "processing_center": sc.get("processing_center"),
            "product_version": sc.get("product_version"), "is_full_frame": sc.get("is_full_frame"),
            "bounding_polygon_wkt": sc.get("bounding_polygon_wkt"),
            "backscatter_convention": sc.get("backscatter_convention"),
            "subswath_masking_applied": sc.get("subswath_masking_applied"),
            "bandwidth_mode_sidecar": sc.get("bandwidth_mode"),
        }

    def read(self, layer: str, win: tuple[int, int, int, int] | None = None) -> np.ndarray:
        with rasterio.open(self.files[layer]) as ds:
            w = None if win is None else Window(win[2], win[0], win[3] - win[2], win[1] - win[0])
            return ds.read(1, window=w)


def open_scene(path) -> H5Scene | TiffScene:
    p = Path(path)
    if p.suffix.lower() in (".h5", ".hdf5", ".he5"):
        return H5Scene(p)
    if p.name.endswith(".scene.json"):
        return TiffScene(p)
    raise ValueError(f"{p}: expected a .h5 product or a .scene.json sidecar")


def _pole_from_pols(pols) -> str | None:
    """Fallback when the file name is not a NISAR identifier: ['HH','HV'] -> 'DHNA' (primary band only)."""
    if not pols:
        return None
    key = sorted(pols)
    code = next((k for k, v in POLE_CODES.items() if v and sorted(v) == key), None)
    return code + "NA" if code else None


def _mode_from_bw(meta) -> str | None:
    bw = meta.get("range_bandwidth_hz")
    return f"{int(bw // 1e6):02d}00" if bw else None


def crosscheck(meta: dict, parsed: dict) -> list[dict]:
    """Compare filename fields against internal metadata. Mismatch -> flag (not silently trusted)."""
    rows = [
        ("band", parsed["band"], meta["band"]),
        ("product_type", parsed["product"], meta["product_type"]),
        ("relative_track", parsed["track"], meta["relative_track"]),
        ("frame", parsed["frame"], meta["frame"]),
        ("orbit_direction", parsed["direction"], meta["orbit_direction"]),
        ("start_utc (to the second)", parsed["start_utc"], meta["start_utc"][:19] + "Z"),
        ("end_utc (to the second)", parsed["end_utc"], meta["end_utc"][:19] + "Z"),
        ("crid", parsed["crid"], meta["crid"]),
        ("polarizations", parsed["polarizations_primary"], meta["polarizations"]),
    ]
    if meta.get("range_bandwidth_hz"):
        rows.append(("bandwidth MHz (primary)", int(parsed["bandwidth_primary_mhz_code"]),
                     int(meta["range_bandwidth_hz"] // 1e6)))
    return [{"field": f, "filename_value": a, "metadata_value": b, "match": a == b} for f, a, b in rows]


def scene_manifest(path, with_hash: bool = True) -> dict:
    sc = open_scene(path)
    meta = dict(sc.meta)
    warnings = []
    src = Path(path)
    parsed = parse_product_name(src.name) or parse_product_name(str(meta["scene_id"]))
    if src.suffix == ".h5" and src.stem != meta["scene_id"]:
        warnings.append(f"File name '{src.stem}' differs from internal granuleId '{meta['scene_id']}'")
    if parsed:
        checks = crosscheck(meta, parsed)
        warnings += [f"Filename {c['field']}={c['filename_value']} but metadata says {c['metadata_value']}"
                     for c in checks if not c["match"]]
    else:
        checks = []
        warnings.append("Product identifier does not follow the NISAR naming convention; fields not cross-checked")
    files = [src] if isinstance(sc, H5Scene) else [src, *sc.files.values()]
    t = sc.transform
    h, w = sc.shape
    bounds = [t.c, t.f + t.e * h, t.c + t.a * w, t.f]
    meta.update({
        "source_path": src.as_posix(),
        "source_format": "hdf5" if isinstance(sc, H5Scene) else "geotiff+sidecar",
        "band_group": getattr(sc, "band_group", None),
        "files": [{"name": f.name, "size_bytes": f.stat().st_size, "sha256": sha256(f) if with_hash else None}
                  for f in files],
        "bandwidth_mode": parsed["mode"] if parsed else (meta.get("bandwidth_mode_sidecar") or _mode_from_bw(meta)),
        "polarization_code": parsed["pole"] if parsed else (sc.ident.get("polarization_code")
                                                            or _pole_from_pols(meta.get("polarizations"))),
        "mode_fields_source": "filename" if parsed else "internal metadata",
        "crs_epsg": sc.crs.to_epsg(),
        "pixel_spacing_m": [abs(t.a), abs(t.e)],
        "pixel_area_m2": abs(t.a * t.e),
        "grid_shape": [h, w],
        "transform": [t.a, t.b, t.c, t.d, t.e, t.f],
        "bounds_native": bounds,
        "channels": sc.channels,
        "has_hh": "HHHH" in sc.channels,
        "has_hv": "HVHV" in sc.channels,
        "filename_fields": parsed,
        "filename_crosscheck": checks,
        "warnings": warnings,
    })
    meta.pop("bandwidth_mode_sidecar", None)
    return meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--out")
    ap.add_argument("--no-hash", action="store_true")
    a = ap.parse_args()
    m = scene_manifest(a.path, with_hash=not a.no_hash)
    txt = json.dumps(m, indent=2, default=str)
    if a.out:
        Path(a.out).write_text(txt)
    print(txt)


if __name__ == "__main__":
    main()
