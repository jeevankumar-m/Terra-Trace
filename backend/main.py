"""TerraTrace API. Reads the per-analysis folders written by analysis.run_analysis; never recomputes science.

    uvicorn backend.main:app --port 8000
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from rio_tiler.colormap import cmap
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader

from analysis import config
from backend import schemas as S

DATA = Path(os.environ.get("TERRATRACE_DATA", config.DATA))
DERIVED, AOI = DATA / "derived", DATA / "aoi"

app = FastAPI(title="TerraTrace API", version="0.1.0",
              description="Paired NISAR S-band L2-GCOV temporal backscatter workbench (phase 1)")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get(
    "TERRATRACE_CORS", "http://localhost:3000,http://127.0.0.1:3000").split(","), allow_methods=["GET"],
    allow_headers=["*"])


def _read(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _manifests() -> list[dict]:
    return [_read(p) for p in sorted(DERIVED.glob("*/manifest.json"))]


def _manifest(analysis_id: str) -> dict:
    p = DERIVED / analysis_id / "manifest.json"
    if "/" in analysis_id or "\\" in analysis_id or ".." in analysis_id or not p.exists():
        raise HTTPException(404, f"analysis '{analysis_id}' not found; run `make analysis` first")
    return _read(p)


def _tier(m: dict) -> int:
    """Default analysis: real passed pair (0) > other real (1) > synthetic (2, never default if 0/1 exist)."""
    return 2 if m["synthetic"] else (0 if m["status"] == "ok" else 1)


@app.get("/api/health", response_model=S.Health)
def health():
    return {"status": "ok", "analyses": len(list(DERIVED.glob("*/manifest.json"))), "data_dir": str(DATA)}


@app.get("/api/areas", response_model=list[S.Area])
def areas():
    out = []
    for p in sorted(AOI.glob("*.geojson")):
        gj = _read(p)
        f = gj["features"][0] if gj.get("type") == "FeatureCollection" else gj
        pr = f.get("properties") or {}
        out.append({"area_id": pr.get("area_id", p.stem), "name": pr.get("name", p.stem), "why": pr.get("why"),
                    "status": pr.get("status"), "synthetic": bool(pr.get("synthetic")), "geometry": f["geometry"]})
    return out


@app.get("/api/scenes", response_model=list[S.Scene])
def scenes(area_id: str = Query(...)):
    seen = {}
    for m in _manifests():
        if m["area_id"] == area_id:
            for s in (m["scene_a"], m["scene_b"]):
                if s:
                    seen.setdefault(s["scene_id"], s)
    return sorted(seen.values(), key=lambda s: s["start_utc"])


@app.get("/api/pairs", response_model=list[S.PairQA])
def pairs(area_id: str = Query(...)):
    """Every evaluated pair for the area, passed and failed, each with its reasons."""
    return [{**m["pair_qa"], "analysis_id": m["analysis_id"]} for m in _manifests()
            if m["area_id"] == area_id and m["pair_qa"]]


@app.get("/api/analyses", response_model=S.AnalysisList)
def analyses():
    newest = sorted(_manifests(), key=lambda m: m["provenance"]["created_utc"], reverse=True)
    ms = sorted(newest, key=_tier)  # stable: newest first within each tier
    items = [{"analysis_id": m["analysis_id"], "area_id": m["area_id"], "area_name": m["area_name"],
              "status": m["status"], "fallback_level": m["fallback_level"], "synthetic": m["synthetic"],
              "exploratory": m["exploratory"], "date_a": m["scene_a"]["start_utc"],
              "date_b": m["scene_b"]["start_utc"] if m["scene_b"] else None,
              "n_candidates": m["summary"]["n_candidates"], "created_utc": m["provenance"]["created_utc"]}
             for m in ms]
    return {"default_analysis_id": items[0]["analysis_id"] if items else None, "analyses": items}


@app.get("/api/analyses/{analysis_id}", response_model=S.Analysis)
def analysis(analysis_id: str):
    m = _manifest(analysis_id)
    m["tiles"] = {k: f"/api/tiles/{analysis_id}/{k}/{{z}}/{{x}}/{{y}}.png" for k in m["layers"]}
    return m


@app.get("/api/analyses/{analysis_id}/candidates", response_model=S.FeatureCollection)
def candidates(analysis_id: str):
    _manifest(analysis_id)
    return _read(DERIVED / analysis_id / "candidates.geojson")


@app.get("/api/candidates/{analysis_id}/{candidate_id}", response_model=S.Candidate)
def candidate(analysis_id: str, candidate_id: str):
    _manifest(analysis_id)
    metrics = _read(DERIVED / analysis_id / "metrics.json")
    c = next((c for c in metrics["candidates"] if c["candidate_id"] == candidate_id), None)
    if c is None:
        raise HTTPException(404, f"candidate '{candidate_id}' not in '{analysis_id}'")
    fc = _read(DERIVED / analysis_id / "candidates.geojson")
    geom = next(f["geometry"] for f in fc["features"] if f["properties"]["candidate_id"] == candidate_id)
    return {**c, "analysis_id": analysis_id, "geometry": geom}


# --- tiles ---------------------------------------------------------------------------------
VALID_MASK_CMAP = {0: (99, 107, 121, 150), 1: (0, 0, 0, 0)}  # excluded = muted grey, analysed = clear


@lru_cache(maxsize=1)
def _blank() -> bytes:
    from rio_tiler.models import ImageData
    return ImageData(np.ma.masked_all((1, 256, 256), dtype="uint8")).render(img_format="PNG")


@app.get("/api/tiles/{analysis_id}/{layer}/{z}/{x}/{y}.png", response_class=Response,
         responses={200: {"content": {"image/png": {}}}})
def tile(analysis_id: str, layer: str, z: int, x: int, y: int):
    m = _manifest(analysis_id)
    if layer not in m["layers"]:
        raise HTTPException(404, f"layer '{layer}' not available in '{analysis_id}'")
    lg = m["legend"][layer]
    headers = {"Cache-Control": "public, max-age=600"}
    try:
        with Reader(str(DERIVED / analysis_id / m["layers"][layer])) as r:
            img = r.tile(x, y, z, tilesize=256)
    except TileOutsideBounds:
        return Response(_blank(), media_type="image/png", headers=headers)
    if layer == "valid_mask":
        png = img.render(img_format="PNG", colormap=VALID_MASK_CMAP)
    else:
        img = img.rescale(in_range=((lg["min"], lg["max"]),))
        png = img.render(img_format="PNG", colormap=cmap.get(lg["colormap"]))
    return Response(png, media_type="image/png", headers=headers)
