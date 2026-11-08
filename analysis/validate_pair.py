"""Pair QA gate (blueprint Step A). A failed pair never proceeds unless --force-exploratory.

    python -m analysis.validate_pair <scene_a> <scene_b> [--aoi data/aoi/x.geojson] [--out pair_qa.json]
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from shapely.geometry import box

from analysis import config


def _check(name, ok, a, b, reason, warn=False):
    return {"name": name, "status": "pass" if ok else ("warn" if warn else "fail"),
            "value_a": a, "value_b": b, "reason": reason}


def _ts(s):
    return datetime.fromisoformat(s.rstrip("Z"))


def overlap_fraction(a: dict, b: dict, aoi_4326) -> float:
    """Share of the AOI covered by both scene grids, measured in scene A's CRS."""
    from analysis.prepare_gcov import to_crs
    aoi = to_crs(aoi_4326, a["crs_epsg"])
    fa = box(*a["bounds_native"])
    fb = box(*b["bounds_native"]) if b["crs_epsg"] == a["crs_epsg"] else to_crs(
        to_crs(box(*b["bounds_native"]), 4326, src=b["crs_epsg"]), a["crs_epsg"])
    return aoi.intersection(fa).intersection(fb).area / aoi.area if aoi.area else 0.0


def validate_pair(a: dict, b: dict, aoi_4326=None) -> dict:
    c = []
    req = config.REQUIRED_BAND
    c.append(_check("band_contract", a["band"] == req and b["band"] == req, a["band"], b["band"],
                    f"Both scenes are {req}-band, as the TerraTrace contract requires" if a["band"] == req == b["band"]
                    else f"TerraTrace compares NISAR {req}-band only; got {a['band']} and {b['band']}"))
    c.append(_check("same_band", a["band"] == b["band"], a["band"], b["band"],
                    "Same radar band" if a["band"] == b["band"]
                    else "Different radar bands (S vs L) must never be subtracted per pixel"))
    ok = a["product_type"] == b["product_type"] == config.REQUIRED_PRODUCT
    c.append(_check("product_type", ok, a["product_type"], b["product_type"],
                    "Both are L2-GCOV" if ok else f"Both scenes must be {config.REQUIRED_PRODUCT}"))
    pa, pb = a.get("polarization_code"), b.get("polarization_code")
    c.append(_check("polarization_mode", pa == pb and pa is not None, pa, pb,
                    f"Same polarization mode ({pa})" if pa == pb and pa
                    else "Polarization modes differ (or are unknown); channels are not comparable"))
    c.append(_check("orbit_direction", a["orbit_direction"] == b["orbit_direction"], a["orbit_direction"],
                    b["orbit_direction"], "Same orbit direction" if a["orbit_direction"] == b["orbit_direction"]
                    else "Ascending and descending scenes see the surface from different geometry; not subtractable"))
    c.append(_check("relative_track", a["relative_track"] == b["relative_track"], a["relative_track"],
                    b["relative_track"], "Same relative track" if a["relative_track"] == b["relative_track"]
                    else "Different relative tracks: viewing geometry differs"))
    c.append(_check("frame", a["frame"] == b["frame"], a["frame"], b["frame"],
                    "Same track frame" if a["frame"] == b["frame"] else "Different frames"))
    ma, mb = a.get("bandwidth_mode"), b.get("bandwidth_mode")
    c.append(_check("bandwidth_mode", ma == mb and ma is not None, ma, mb,
                    f"Same bandwidth mode ({ma})" if ma == mb and ma
                    else "Bandwidth modes differ (or are unknown): resolution and posting differ"))
    ha, hb = (a["has_hh"], a["has_hv"]), (b["has_hh"], b["has_hv"])
    if not (a["has_hh"] and b["has_hh"]):
        c.append(_check("channels_hh_hv", False, ha, hb, "HH (HHHH) missing in at least one scene"))
    elif a["has_hv"] and b["has_hv"]:
        c.append(_check("channels_hh_hv", True, ha, hb, "Both scenes contain HHHH and HVHV"))
    elif a["has_hv"] != b["has_hv"]:
        c.append(_check("channels_hh_hv", False, ha, hb, "One scene is HH-only and the other is HH/HV"))
    else:
        c.append(_check("channels_hh_hv", False, ha, hb,
                        "Neither scene has HVHV: single-pol comparison only (fallback level B, no HV claims)", warn=True))
    c.append(_check("crs", a["crs_epsg"] == b["crs_epsg"], a["crs_epsg"], b["crs_epsg"],
                    f"Same map projection (EPSG:{a['crs_epsg']})" if a["crs_epsg"] == b["crs_epsg"]
                    else "Different map projections"))
    sa, sb = a["pixel_spacing_m"], b["pixel_spacing_m"]
    if sa != sb:
        c.append(_check("grid", False, sa, sb, "Different pixel spacing"))
    else:
        ta, tb = a["transform"], b["transform"]
        aligned = ((ta[2] - tb[2]) / sa[0]) % 1 == 0 and ((ta[5] - tb[5]) / sa[1]) % 1 == 0
        c.append(_check("grid", aligned, sa, sb,
                        f"Same {sa[0]:g} m grid, pixel-aligned (no resampling needed)" if aligned
                        else "Same spacing but grids offset by a sub-pixel amount; scene B will be resampled (recorded)",
                        warn=True))
    if aoi_4326 is not None:
        f = overlap_fraction(a, b, aoi_4326)
        c.append(_check("aoi_overlap", f >= config.MIN_OVERLAP_FRACTION, round(f, 4), config.MIN_OVERLAP_FRACTION,
                        f"{f:.1%} of the AOI is covered by both scenes (minimum {config.MIN_OVERLAP_FRACTION:.0%})"))
    ok = _ts(b["start_utc"]) > _ts(a["start_utc"])
    c.append(_check("date_order", ok, a["start_utc"], b["start_utc"],
                    "Date B is after Date A" if ok else "Date B must be later than Date A"))
    ca, cb = a.get("backscatter_convention"), b.get("backscatter_convention")
    c.append(_check("radiometric_convention", ca == cb and ca is not None, ca, cb,
                    f"Both {ca}" if ca == cb and ca else "Backscatter convention differs or is unrecorded", warn=True))
    c.append(_check("processing_baseline", a.get("crid") == b.get("crid"), a.get("crid"), b.get("crid"),
                    "Same processing baseline (CRID)" if a.get("crid") == b.get("crid")
                    else "Different CRIDs: calibration may differ between dates", warn=True))
    sm = (a.get("subswath_masking_applied"), b.get("subswath_masking_applied"))
    c.append(_check("subswath_mask_semantics", False not in sm, *sm,
                    "Both products applied sub-swath validity masking (mask 0 = invalid)" if False not in sm
                    else "Sub-swath validity masking not applied in at least one product: validity taken from "
                         "fill code 255 and finite positive power only", warn=True))
    fa = [w for w in a.get("warnings", []) if w.startswith("Filename")]
    fb = [w for w in b.get("warnings", []) if w.startswith("Filename")]
    c.append(_check("filename_metadata_consistency", not fa and not fb, len(fa), len(fb),
                    "File names agree with internal metadata" if not fa and not fb
                    else "; ".join(fa + fb), warn=True))
    passed = all(x["status"] != "fail" for x in c)
    level = None
    if passed:
        level = "A" if a["has_hv"] and b["has_hv"] else "B"
    return {
        "scene_a": a["scene_id"], "scene_b": b["scene_id"], "passed": passed, "fallback_level": level,
        "failed_reasons": [x["reason"] for x in c if x["status"] == "fail"], "checks": c,
    }


def main():
    from analysis.inspect_product import scene_manifest
    from analysis.prepare_gcov import load_aoi
    ap = argparse.ArgumentParser()
    ap.add_argument("scene_a")
    ap.add_argument("scene_b")
    ap.add_argument("--aoi")
    ap.add_argument("--out")
    x = ap.parse_args()
    qa = validate_pair(scene_manifest(x.scene_a, False), scene_manifest(x.scene_b, False),
                       load_aoi(x.aoi)[0] if x.aoi else None)
    txt = json.dumps(qa, indent=2, default=str)
    if x.out:
        Path(x.out).write_text(txt)
    print(txt)


if __name__ == "__main__":
    main()
