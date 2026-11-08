"""Pair gate over a folder of downloaded scenes: inspect every product, QA every date-ordered pair.

    python -m analysis.catalog data/raw/<area_id> --aoi data/aoi/<area_id>.geojson

Prints a table and writes data/derived/_catalog/<area_id>.json. Use it to pick the pair to analyse.
"""
from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

from analysis import config
from analysis.inspect_product import scene_manifest
from analysis.prepare_gcov import load_aoi
from analysis.validate_pair import validate_pair


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--aoi")
    a = ap.parse_args()
    folder = Path(a.folder)
    paths = sorted([*folder.glob("*.h5"), *folder.glob("*.scene.json")])
    if not paths:
        raise SystemExit(f"No .h5 or .scene.json files in {folder}")
    scenes = []
    for p in paths:
        try:
            scenes.append(scene_manifest(p, with_hash=False))
        except Exception as e:  # report unreadable products instead of stopping the gate
            print(f"UNREADABLE {p.name}: {e}")
    scenes.sort(key=lambda s: s["start_utc"])
    aoi = load_aoi(a.aoi)[0] if a.aoi else None
    print(f"{len(scenes)} scenes")
    for s in scenes:
        print(f"  {s['start_utc'][:16]}  {s['band']}  {s['orbit_direction']}  track {s['relative_track']}  "
              f"frame {s['frame']}  {s['polarization_code']}  mode {s['bandwidth_mode']}  {s['scene_id']}")
    pairs = []
    for sa, sb in itertools.combinations(scenes, 2):
        qa = validate_pair(sa, sb, aoi)
        pairs.append(qa)
        mark = "PASS" if qa["passed"] else "fail"
        why = "" if qa["passed"] else " | " + "; ".join(qa["failed_reasons"])
        print(f"[{mark}] {sa['start_utc'][:10]} -> {sb['start_utc'][:10]}  level {qa['fallback_level']}{why}")
    area = Path(a.aoi).stem if a.aoi else folder.name
    out = config.DERIVED_DIR / "_catalog" / f"{area}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"area_id": area, "scenes": scenes, "pairs": pairs}, indent=2, default=str))
    print(f"-> {out}")


if __name__ == "__main__":
    main()
