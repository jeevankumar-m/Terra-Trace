"""One deterministic command for the whole chain.

    python -m analysis.run_analysis --scene-a A.h5 --scene-b B.h5 --aoi data/aoi/x.geojson --analysis-id x
    python -m analysis.run_analysis --scene-a A.h5 --aoi ... --analysis-id x          # fallback level C

Outputs in data/derived/<analysis_id>/: manifest.json, scene_a.json, scene_b.json, pair_qa.json,
metrics.json, candidates.geojson, cog/*.tif. Re-running with the same inputs gives identical
metrics.json / candidates.geojson (manifest.json differs only in provenance.created_utc).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import box, mapping

from analysis import config
from analysis.compare_pair import compute_layers, display_ranges, write_outputs
from analysis.detect_candidates import detect
from analysis.inspect_product import open_scene, scene_manifest
from analysis.prepare_gcov import load_aoi, prepare, to_crs
from analysis.summarize import fmt_db, summarize
from analysis.validate_pair import _check, validate_pair

SYNTHETIC_LABEL = "SYNTHETIC DEV DATA — not NISAR observations"


def _dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


def code_version() -> str:
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=config.ROOT, capture_output=True,
                             text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "analysis"], cwd=config.ROOT,
                               capture_output=True, text=True).stdout.strip()
        return sha + ("-dirty" if dirty else "")
    except Exception:
        return "unknown"


def run(scene_a: str, scene_b: str | None, aoi_path: str, analysis_id: str, area_id: str | None = None,
        force_exploratory: bool = False, out_root: Path = config.DERIVED_DIR, hash_files: bool = True) -> dict:
    out = Path(out_root) / analysis_id
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    aoi, aoi_props = load_aoi(aoi_path)
    area_id = area_id or aoi_props.get("area_id") or Path(aoi_path).stem

    ma = scene_manifest(scene_a, hash_files)
    mb = scene_manifest(scene_b, hash_files) if scene_b else None
    _dump(out / "scene_a.json", ma)
    if mb:
        _dump(out / "scene_b.json", mb)
    synthetic = any(str(m.get("mission_id", "")).upper().startswith("SYNTHETIC") for m in (ma, mb) if m)

    sa, sb = open_scene(scene_a), (open_scene(scene_b) if scene_b else None)
    qa = validate_pair(ma, mb, aoi) if mb else None
    use_hv = ma["has_hv"] and (mb is None or mb["has_hv"])
    prep = prepare(sa, sb, aoi, use_hv=use_hv)
    q = prep["stats"]
    if qa:
        f = q["common_valid_fraction"]
        qa["checks"].append(_check(
            "common_valid_coverage", f >= config.MIN_COMMON_VALID_FRACTION, round(f, 4),
            config.MIN_COMMON_VALID_FRACTION,
            f"{f:.1%} of AOI pixels are valid in both scenes (minimum {config.MIN_COMMON_VALID_FRACTION:.0%})"))
        qa["passed"] = all(c["status"] != "fail" for c in qa["checks"])
        qa["failed_reasons"] = [c["reason"] for c in qa["checks"] if c["status"] == "fail"]
        if not qa["passed"]:
            qa["fallback_level"] = None
        _dump(out / "pair_qa.json", qa)

    if mb is None:
        status, level = "single_scene", "C"
    elif qa["passed"]:
        status, level = "ok", qa["fallback_level"]
    elif force_exploratory:
        status, level = "exploratory", ("A" if use_hv else "B")
    else:
        status, level = "qa_failed", None

    layers = compute_layers(prep)
    if status == "qa_failed":  # failed pair: per-date layers only, no deltas, no candidates
        layers = {k: v for k, v in layers.items() if not k.startswith("delta_")}
    paths, audit = write_outputs(prep, layers, out)
    legend = display_ranges(layers, prep["valid"])
    px_area = prep["record"]["pixel_area_m2"]
    epsg = prep["record"]["crs_epsg"]

    candidates, fc, det = [], {"type": "FeatureCollection", "features": []}, None
    if "delta_hh_db" in layers:
        det = detect(layers, prep["valid"], prep["transform"], px_area)
        candidates, fc = summarize(det, layers, prep["valid"], px_area, epsg,
                                   pair_passed=bool(qa and qa["passed"]), exploratory=status == "exploratory")
    if det and qa:
        for ch in ("hh", "hv"):
            med = det["background"].get(ch, {}).get("median")
            if med is not None:
                big = abs(med) > config.BACKGROUND_OFFSET_WARN_DB
                qa["checks"].append(_check(
                    f"background_offset_{ch}", not big, round(med, 3), config.BACKGROUND_OFFSET_WARN_DB,
                    f"Scene-wide median Δ{ch.upper()} {fmt_db(med)}" + (
                        ": large offset between dates, possibly calibration/processing rather than surface "
                        "change; z-scores are relative to this background" if big else " (near zero)"),
                    warn=True))
        _dump(out / "pair_qa.json", qa)
    total_ha = sum(c["area_ha"] for c in candidates)
    threshold = {"method": "robust_mad", "value": config.K_ROBUST, "k": config.K_ROBUST,
                 "rule": "|z_robust| >= k on dHH or dHV", "z_formula": "0.6745*(delta-median)/MAD",
                 "background_z": config.BACKGROUND_Z, "mmu_ha": config.MMU_HA,
                 "mmu_pixels": det["mmu_pixels"] if det else None, "connectivity": config.CONNECTIVITY,
                 "speckle_filter": f"median {config.SPECKLE_FILTER_SIZE}x{config.SPECKLE_FILTER_SIZE}"
                 if config.SPECKLE_FILTER else "none"}
    background = {f"delta_{k}_db": {"median": round(v["median"], 4) if v["median"] is not None else None,
                                     "mad": round(v["mad"], 4) if v["mad"] is not None else None, "n": v["n"]}
                  for k, v in (det["background"].items() if det else [])}
    summary = {
        "n_candidates": len(candidates), "total_candidate_area_ha": round(total_ha, 3),
        "aoi_area_ha": round(q["aoi_area_ha"], 3), "analysed_area_ha": round(q["analysed_area_ha"], 3),
        "common_valid_pixel_fraction": round(float(q["common_valid_fraction"]), 4),
        "candidate_pixels_before_mmu": det["candidate_pixels"] if det else None,
        "components_total": det["components_total"] if det else None,
        "components_below_mmu": det["components_below_mmu"] if det else None,
    }
    metrics = {"analysis_id": analysis_id, "method": config.METHOD_ID, "threshold": threshold,
               "summary": summary, "background": background, "candidates": candidates}
    _dump(out / "metrics.json", metrics)
    _dump(out / "candidates.geojson", fc)

    t, (h, w) = prep["transform"], prep["shape"]
    grid_box = box(t.c, t.f + t.e * h, t.c + t.a * w, t.f)
    b4326 = to_crs(grid_box, 4326, src=epsg).bounds
    manifest = {
        "analysis_id": analysis_id,
        "area_id": area_id,
        "area_name": aoi_props.get("name", area_id),
        "sensor": f"NISAR_{ma['band']}_SAR",
        "product": "L2_GCOV",
        "status": status,
        "fallback_level": level,
        "exploratory": status == "exploratory",
        "synthetic": synthetic,
        "data_label": SYNTHETIC_LABEL if synthetic else None,
        "scene_a": ma,
        "scene_b": mb,
        "pair_qa": qa,
        "layers": paths,
        "audit_layers": audit,
        "legend": legend,
        "method": config.METHOD_ID,
        "threshold": threshold,
        "background": background,
        "quality": {"common_valid_pixel_fraction": summary["common_valid_pixel_fraction"],
                    "aoi_area_ha": summary["aoi_area_ha"], "analysed_area_ha": summary["analysed_area_ha"],
                    "aoi_pixels": q["aoi_pixels"],
                    "scene_a_exclusions_in_aoi": q["scene_a_exclusions_in_aoi"],
                    "scene_b_exclusions_in_aoi": q.get("scene_b_exclusions_in_aoi")},
        "preprocessing": prep["record"],
        "summary": summary,
        "aoi": mapping(aoi),
        "bounds_lonlat": [round(v, 6) for v in b4326],
        "corroboration": {"status": "not_available", "note": "Independent corroboration is out of scope in phase 1"},
        "exports": {},  # reserved for GeoJSON / CSV / report exports (phase 2)
        "provenance": {
            "code_version": code_version(),
            "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "command": " ".join(["python -m analysis.run_analysis", *sys.argv[1:]]),
            "config": {k: getattr(config, k) for k in dir(config) if k.isupper() and not k.endswith("_DIR")
                       and k not in ("ROOT", "DATA")},
        },
    }
    _dump(out / "manifest.json", manifest)
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene-a", required=True)
    ap.add_argument("--scene-b")
    ap.add_argument("--aoi", required=True)
    ap.add_argument("--analysis-id", required=True)
    ap.add_argument("--area-id")
    ap.add_argument("--force-exploratory", action="store_true",
                    help="compute deltas even if pair QA fails; everything downstream is labelled exploratory")
    ap.add_argument("--no-hash", action="store_true", help="skip SHA-256 of source files (faster)")
    a = ap.parse_args()
    m = run(a.scene_a, a.scene_b, a.aoi, a.analysis_id, a.area_id, a.force_exploratory, hash_files=not a.no_hash)
    s = m["summary"]
    print(f"[{m['analysis_id']}] status={m['status']} level={m['fallback_level']} "
          f"synthetic={m['synthetic']}")
    if m["pair_qa"] and not m["pair_qa"]["passed"]:
        for r in m["pair_qa"]["failed_reasons"]:
            print(f"  QA FAIL: {r}")
    print(f"  AOI {s['aoi_area_ha']:.1f} ha, common valid {s['common_valid_pixel_fraction']:.1%}, "
          f"{s['n_candidates']} candidates, {s['total_candidate_area_ha']:.1f} ha")
    print(f"  -> {config.DERIVED_DIR / m['analysis_id']}")


if __name__ == "__main__":
    main()
