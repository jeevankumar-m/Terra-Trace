"""Freeze the API into static files so the web app runs with no backend (e.g. on Vercel).

    python -m analysis.export_static            # all real analyses -> frontend/public/data

Every JSON endpoint the frontend calls is written to `frontend/public/data/<path>.json`; map tiles are pre-rendered
for zoom MIN_Z..native zoom and written as `frontend/public/data/api/tiles/<id>/<layer>/<z>/<x>/<y>.<ext>`.
Fully transparent tiles are skipped. Synthetic and exploratory analyses are never exported.
The frontend reads these files whenever NEXT_PUBLIC_API_BASE is not set.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import morecantile
import numpy as np
from rasterio.io import MemoryFile

from analysis import config
from backend import main as api

OUT = config.ROOT / "frontend" / "public" / "data"
LAYERS = ["rgb_a", "rgb_b", "change_hh", "a_hh_db", "b_hh_db", "delta_hh_db", "a_hv_db", "b_hv_db", "delta_hv_db",
          "valid_mask"]
MIN_Z = 7
TMS = morecantile.tms.get("WebMercatorQuad")


def _json(path: str, obj) -> None:
    p = OUT / f"{path.lstrip('/')}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False, default=str), encoding="utf-8")


def _bytes(path: str, data: bytes) -> None:
    p = OUT / path.lstrip("/")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def native_zoom(pixel_m: float, lat: float) -> int:
    """Smallest web-mercator zoom whose ground resolution is at least as fine as the data."""
    return math.ceil(math.log2(156543.034 * math.cos(math.radians(lat)) / pixel_m))


def encode(png: bytes, fmt: str) -> bytes | None:
    """None for fully transparent tiles; otherwise PNG as-is or re-encoded to lossy WEBP (with alpha)."""
    with MemoryFile(png) as mf, mf.open() as ds:
        a = ds.read()
    if not a[-1].any():
        return None
    if fmt == "png":
        return png
    if a.shape[0] == 2:  # grey + alpha -> RGBA (WEBP needs 3 or 4 bands)
        a = np.concatenate([a[:1], a[:1], a[:1], a[1:]])
    with MemoryFile() as mf:
        with mf.open(driver="WEBP", width=a.shape[2], height=a.shape[1], count=a.shape[0], dtype="uint8",
                     QUALITY=82) as ds:
            ds.write(a)
        return mf.read()


def export_analysis(aid: str, fmt: str, workers: int) -> dict:
    m = api.analysis(aid)
    keep = [k for k in LAYERS if k in m["tiles"]]
    px = math.sqrt(m["preprocessing"]["pixel_area_m2"])
    w, s, e, n = m["bounds_lonlat"]
    zmax = native_zoom(px, (s + n) / 2)
    m["layers"] = {k: v for k, v in m["layers"].items() if k in keep}
    m["tiles"] = {k: f"/api/tiles/{aid}/{k}/{{z}}/{{x}}/{{y}}.{fmt}" for k in keep}
    m["tiles_maxzoom"] = zmax
    _json(f"/api/analyses/{aid}", m)
    _json(f"/api/analyses/{aid}/candidates", api.candidates(aid))
    _json(f"/api/analyses/{aid}/story", api.story(aid))
    _json(f"/api/analyses/{aid}/context", api.context(aid))
    for k in ("delta_hh_db", "delta_hv_db"):
        if k in m["layers"]:
            _json(f"/api/analyses/{aid}/histogram/{k}", api.histogram(aid, k))
    metrics = api._read(api.DERIVED / aid / "metrics.json")
    for c in metrics["candidates"]:
        _json(f"/api/candidates/{aid}/{c['candidate_id']}", api.candidate(aid, c["candidate_id"]))
    for name in api.EXPORTS:
        _bytes(f"/api/analyses/{aid}/export/{name}", api.export(aid, name).body)

    jobs = [(k, t) for k in keep for z in range(MIN_Z, zmax + 1) for t in TMS.tiles(w, s, e, n, [z])]

    def one(job):
        k, t = job
        b = encode(api.tile(aid, k, t.z, t.x, t.y).body, fmt)
        if b:
            _bytes(f"/api/tiles/{aid}/{k}/{t.z}/{t.x}/{t.y}.{fmt}", b)
            return len(b)
        return 0

    with ThreadPoolExecutor(workers) as ex:
        sizes = list(ex.map(one, jobs))
    written = [x for x in sizes if x]
    print(f"[{aid}] z{MIN_Z}-{zmax}, {len(keep)} layers: {len(written)} tiles, {sum(written) / 1e6:.1f} MB "
          f"({len(jobs) - len(written)} empty skipped), {len(metrics['candidates'])} candidates")
    return {"zmax": zmax, "tiles": len(written), "mb": sum(written) / 1e6}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--format", choices=["webp", "png"], default="webp")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--only", nargs="*", help="analysis ids (default: every real, QA-passed analysis)")
    a = ap.parse_args()
    lst = api.analyses()
    real = [x for x in lst["analyses"] if not x["synthetic"] and not x["exploratory"] and x["status"] == "ok"]
    if a.only:
        real = [x for x in real if x["analysis_id"] in a.only]
    if OUT.exists():
        shutil.rmtree(OUT)
    _json("/api/analyses", {"default_analysis_id": real[0]["analysis_id"] if real else None, "analyses": real})
    for x in real:
        export_analysis(x["analysis_id"], a.format, a.workers)
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"-> {OUT}  ({total / 1e6:.1f} MB total)")


if __name__ == "__main__":
    main()
