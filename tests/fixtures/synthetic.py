"""SYNTHETIC test/dev fixtures, NOT NISAR observations.

Writes HDF5 files with the NISAR L2-GCOV layout (/science/SSAR/...) so tests exercise the real reader.
Every synthetic product is marked missionId="SYNTHETIC_DEV", granuleId "SYNTHETIC_DEV_*", and is placed on
an obviously non-real grid near 0°N 0°E (open ocean), with dates in year 2000, so it can never be
mistaken for a real acquisition.

    python -m tests.fixtures.synthetic --out tests/fixtures/synthetic_dev --aoi data/aoi/synthetic_dev.geojson
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import h5py
import numpy as np
from pyproj import Transformer

EPSG = 32631
X0, Y0, SPACING = 200000.0, 80000.0, 20.0     # UTM 31N, ~0.72°N 0.3°E (Gulf of Guinea, open ocean)
SHAPE = (400, 400)
LOOKS = 16

# Implanted changes in scene B: (name, rows, cols, dHH dB, dHV dB, expected pattern)
REGIONS = [
    ("hh_drop", (60, 100), (80, 130), -6.0, 0.0, "HH_DOMINANT_CHANGE"),
    ("hv_rise", (200, 230), (250, 280), 0.0, 6.0, "HV_DOMINANT_CHANGE"),
    ("dual_drop", (300, 325), (60, 100), -6.0, -6.0, "DUAL_CHANNEL_CHANGE"),
    ("tiny", (150, 153), (330, 333), -8.0, 0.0, None),  # 9 px = 0.36 ha < 1 ha MMU -> must be dropped
]


def _speckle(rng, mean_db, looks=LOOKS):
    mean = 10 ** (mean_db / 10)
    return rng.gamma(looks, mean / looks).astype(np.float32)


def base_landscape():
    hh = np.full(SHAPE, -9.0)
    hv = np.full(SHAPE, -16.0)
    hh[:, 180:200] = -20.0   # a low-backscatter channel
    hv[:, 180:200] = -26.0
    hh[250:380, 280:390] = -7.0  # a brighter textured patch
    hv[250:380, 280:390] = -13.0
    return hh, hv


def write_gcov(path, *, granule_id, start, end, hh, hv, mask, direction="Ascending", track=1, frame=1,
               band="S", crid="SYNTH0", x0=X0, y0=Y0, spacing=SPACING, epsg=EPSG, bandwidth_hz=37.5e6):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    grp = f"science/{band}SAR"
    with h5py.File(path, "w") as f:
        idg = f.create_group(f"{grp}/identification")
        for k, v in dict(granuleId=granule_id, missionId="SYNTHETIC_DEV", instrumentName="SYNTHETIC",
                         radarBand=band, productType="GCOV", orbitPassDirection=direction,
                         zeroDopplerStartTime=start, zeroDopplerEndTime=end, compositeReleaseId=crid,
                         processingCenter="SYNTHETIC", productVersion="0.0.0", isFullFrame="True",
                         lookDirection="Left").items():
            idg[k] = np.bytes_(v)
        idg["trackNumber"] = np.uint8(track)
        idg["frameNumber"] = np.uint16(frame)
        g = f.create_group(f"{grp}/GCOV/grids/frequencyA")
        pols = ["HH"] + (["HV"] if hv is not None else [])
        g["listOfPolarizations"] = np.array([p.encode() for p in pols])
        g["xCoordinateSpacing"] = spacing
        g["yCoordinateSpacing"] = -spacing
        g["xCoordinates"] = x0 + spacing / 2 + spacing * np.arange(hh.shape[1])
        g["yCoordinates"] = y0 - spacing / 2 - spacing * np.arange(hh.shape[0])
        p = g.create_dataset("projection", data=np.uint32(epsg))
        p.attrs["epsg_code"] = epsg
        g.create_dataset("HHHH", data=hh.astype(np.float32), compression="gzip")
        if hv is not None:
            g.create_dataset("HVHV", data=hv.astype(np.float32), compression="gzip")
        g.create_dataset("mask", data=mask.astype(np.uint8), compression="gzip")
        g.create_dataset("numberOfLooks", data=np.full(hh.shape, LOOKS, np.float32), compression="gzip")
        g.create_dataset("rtcGammaToSigmaFactor", data=np.full(hh.shape, 0.9, np.float32), compression="gzip")
        m = f.create_group(f"{grp}/GCOV/metadata")
        m["processingInformation/parameters/rtc/outputBackscatterNormalizationConvention"] = np.bytes_("gamma0")
        m["sourceData/swaths/frequencyA/acquiredRangeBandwidth"] = bandwidth_hz
    return path


def make_pair(out_dir, seed=7, with_changes=True, with_hv=True):
    """Two synthetic scenes; returns (path_a, path_b, truth)."""
    rng = np.random.default_rng(seed)
    hh_db, hv_db = base_landscape()
    mask_a = np.ones(SHAPE, np.uint8)
    mask_a[:, :20] = 255            # outside the radar extent
    mask_a[10:20, 300:320] = 0      # invalid / partially focused
    mask_b = mask_a.copy()
    mask_b[:, :20] = 255
    mask_b[380:, :] = 255           # scene B partial coverage
    mask_b[100:110, 200:215] = 2    # a different valid sub-swath (still valid)
    a_hh, a_hv = _speckle(rng, hh_db), _speckle(rng, hv_db)
    hh_b_db, hv_b_db = hh_db.copy(), hv_db.copy()
    if with_changes:
        for _, (r0, r1), (c0, c1), dhh, dhv, _ in REGIONS:
            hh_b_db[r0:r1, c0:c1] += dhh
            hv_b_db[r0:r1, c0:c1] += dhv
    b_hh, b_hv = _speckle(rng, hh_b_db), _speckle(rng, hv_b_db)
    b_hh[5:8, 340:343] = np.nan     # non-finite samples
    a_hh[mask_a == 255] = np.nan    # fill outside extent, as in real products
    b_hh[mask_b == 255] = np.nan
    out = Path(out_dir)
    pa = write_gcov(out / "SYNTHETIC_DEV_SCENE_A.h5", granule_id="SYNTHETIC_DEV_SCENE_A",
                    start="2000-01-01T00:00:00.000000", end="2000-01-01T00:00:30.000000",
                    hh=a_hh, hv=a_hv if with_hv else None, mask=mask_a)
    pb = write_gcov(out / "SYNTHETIC_DEV_SCENE_B.h5", granule_id="SYNTHETIC_DEV_SCENE_B",
                    start="2000-01-13T00:00:00.000000", end="2000-01-13T00:00:30.000000",
                    hh=b_hh, hv=b_hv if with_hv else None, mask=mask_b)
    return pa, pb, REGIONS if with_changes else []


def write_aoi(path, margin_px=10):
    t = Transformer.from_crs(EPSG, 4326, always_xy=True)
    r0, c0 = margin_px, margin_px
    r1, c1 = SHAPE[0] - margin_px, SHAPE[1] - margin_px
    ring = [(X0 + c * SPACING, Y0 - r * SPACING) for r, c in ((r0, c0), (r0, c1), (r1, c1), (r1, c0), (r0, c0))]
    coords = [[round(v, 7) for v in t.transform(x, y)] for x, y in ring]
    gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
        "area_id": "synthetic_dev", "name": "Synthetic development grid", "synthetic": True,
        "status": "synthetic",
        "why": "Generated test grid placed in open ocean near 0°N 0°E for UI development and tests. "
               "Not an observation of any real place."},
        "geometry": {"type": "Polygon", "coordinates": [coords]}}]}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(gj, indent=2) + "\n")
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="tests/fixtures/synthetic_dev")
    ap.add_argument("--aoi", default="data/aoi/synthetic_dev.geojson")
    a = ap.parse_args()
    print(make_pair(a.out)[:2], write_aoi(a.aoi))
