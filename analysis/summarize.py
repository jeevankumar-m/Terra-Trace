"""Per-candidate statistics, deterministic pattern label and explainable evidence level.
Rules are documented in docs/METHODS.md; every threshold comes from analysis/config.py."""
from __future__ import annotations

import math

import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union

from analysis import config
from analysis.prepare_gcov import to_crs

PATTERNS = ("HH_DOMINANT_CHANGE", "HV_DOMINANT_CHANGE", "DUAL_CHANNEL_CHANGE", "AMBIGUOUS_MIXED",
            "SINGLE_POL_HH_CHANGE",
            "WATER_LIKE_TRANSITION")  # reserved: needs independent corroboration, never assigned in phase 1


def _r(x, n=3):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


def _med(arr, sel):
    v = arr[sel]
    v = v[np.isfinite(v)]
    return float(np.median(v)) if v.size else None


def pattern_label(z_hh: float, z_hv: float | None) -> str:
    k, bg = config.K_ROBUST, config.BACKGROUND_Z
    if z_hv is None:
        return "SINGLE_POL_HH_CHANGE"
    hh, hv = abs(z_hh), abs(z_hv)
    if hh >= k and hv >= k:
        return "DUAL_CHANNEL_CHANGE" if np.sign(z_hh) == np.sign(z_hv) else "AMBIGUOUS_MIXED"
    if hh >= k and hv < bg:
        return "HH_DOMINANT_CHANGE"
    if hv >= k and hh < bg:
        return "HV_DOMINANT_CHANGE"
    return "AMBIGUOUS_MIXED"


def fmt_db(x: float) -> str:
    """Signed dB with a real minus sign: +1.8 dB, −3.4 dB."""
    return f"{x:+.1f}".replace("-", "−") + " dB"


def _channel_reason(name, z, d):
    k, bg = config.K_ROBUST, config.BACKGROUND_Z
    if abs(z) >= k:
        return {"status": "pass", "text": f"{name} change exceeds configured robust threshold "
                f"(median Δ{name} {fmt_db(d)}, |z| {abs(z):.1f} ≥ k = {k:.1f})"}
    if abs(z) < bg:
        return {"status": "pass", "text": f"{name} response remains inside configured background range "
                f"(|z| {abs(z):.1f} < {bg:.1f})"}
    return {"status": "warn", "text": f"{name} change is elevated but below threshold (|z| {abs(z):.1f})"}


def evidence(pair_passed: bool, exploratory: bool, pattern: str, z_hh, z_hv, d_hh, d_hv,
             neigh_valid: float, area_ha: float, compactness: float) -> tuple[str, list[dict]]:
    reasons = []
    reasons.append({"status": "pass", "text": "Pair passed same-track / mode / polarization checks"} if pair_passed
                   else {"status": "fail", "text": "Pair failed QA: exploratory result only"})
    reasons.append(_channel_reason("HH", z_hh, d_hh))
    if z_hv is not None:
        reasons.append(_channel_reason("HV", z_hv, d_hv))
    else:
        reasons.append({"status": "warn", "text": "HV not available in both scenes (single-pol): no HV evidence"})
    agree = pattern not in ("AMBIGUOUS_MIXED", "SINGLE_POL_HH_CHANGE")
    reasons.append({"status": "pass", "text": "HH and HV tell a consistent response story"} if agree else
                   {"status": "warn", "text": "Channel agreement cannot be established" if z_hv is None
                    else "HH and HV disagree or are mixed"})
    q_ok = neigh_valid >= config.EVIDENCE_MIN_NEIGHBOURHOOD_VALID
    reasons.append({"status": "pass" if q_ok else "warn",
                    "text": f"{neigh_valid:.1%} of pixels around the region are valid"
                    + ("" if q_ok else " (borders masked or missing data)")})
    big = area_ha >= config.EVIDENCE_STRONG_SIZE_MMU * config.MMU_HA
    reasons.append({"status": "pass" if big else "warn",
                    "text": f"Region size {area_ha:.1f} ha" + (f" (≥ {config.EVIDENCE_STRONG_SIZE_MMU:g}× MMU)" if big
                                                              else f" (close to the {config.MMU_HA:g} ha MMU)")})
    compact = compactness >= config.EVIDENCE_MIN_COMPACTNESS
    reasons.append({"status": "pass" if compact else "warn",
                    "text": f"Compactness {compactness:.2f}" + (" (spatially coherent)" if compact
                                                               else " (elongated or fragmented)")})
    reasons.append({"status": "warn", "text": "Independent corroboration not yet available"})

    score = sum([agree, q_ok, big, compact])
    if not pair_passed or exploratory:
        level = "LOW"
    elif score == 4:
        level = "MEDIUM" if config.HIGH_REQUIRES_CORROBORATION else "HIGH"
        if config.HIGH_REQUIRES_CORROBORATION:
            reasons.append({"status": "warn", "text": "Capped at MEDIUM: HIGH requires independent corroboration"})
    elif score >= 2:
        level = "MEDIUM"
    else:
        level = "LOW"
    return level, reasons


def summarize(det: dict, layers: dict, valid: np.ndarray, pixel_area_m2: float, epsg: int,
              pair_passed: bool, exploratory: bool) -> tuple[list[dict], dict]:
    labels = det["labels"]
    has_hv = "hv" in det["z"]
    candidates, features = [], []
    dil = np.ones((2 * config.EVIDENCE_DILATE_PX + 1,) * 2, bool)
    objs = ndimage.find_objects(labels)
    pad = config.EVIDENCE_DILATE_PX
    for reg in det["regions"]:
        i = reg["index"]
        sl = objs[i - 1]
        # local window with padding for the neighbourhood check
        r0, r1 = max(0, sl[0].start - pad), min(labels.shape[0], sl[0].stop + pad)
        c0, c1 = max(0, sl[1].start - pad), min(labels.shape[1], sl[1].stop + pad)
        win = (slice(r0, r1), slice(c0, c1))
        sel_w = labels[win] == i
        sel = sel_w  # all per-candidate stats are taken inside the local window
        neigh = ndimage.binary_dilation(sel_w, structure=dil)
        neigh_valid = float(valid[win][neigh].mean())

        st = {f"{k}_median_db": _med(layers[k2][win], sel) for k, k2 in
              (("hh_a", "a_hh_db"), ("hh_b", "b_hh_db"), ("hv_a", "a_hv_db"), ("hv_b", "b_hv_db"),
               ("delta_hh", "delta_hh_db"), ("delta_hv", "delta_hv_db"), ("delta_hh_hv_ratio", "delta_ratio_db"))
              if k2 in layers}
        z_hh = _med(det["z"]["hh"][win], sel)
        z_hv = _med(det["z"]["hv"][win], sel) if has_hv else None
        pat = pattern_label(z_hh, z_hv)
        area_ha = reg["pixel_count"] * pixel_area_m2 / 1e4
        g = reg["geometry_native"]
        # Spatial coherence on the hole-filled outline: speckle holes must not masquerade as fragmentation.
        filled = unary_union([Polygon(p.exterior) for p in getattr(g, "geoms", [g])])
        compactness = 4 * math.pi * filled.area / filled.length ** 2 if filled.length else 0.0
        fill_fraction = (reg["pixel_count"] * pixel_area_m2) / filled.area if filled.area else 0.0
        lvl, reasons = evidence(pair_passed, exploratory, pat, z_hh, z_hv, st["delta_hh_median_db"],
                                st.get("delta_hv_median_db"), neigh_valid, area_ha, compactness)
        dom = st.get("delta_hv_median_db") if pat == "HV_DOMINANT_CHANGE" else st["delta_hh_median_db"]
        direction = "mixed" if pat == "AMBIGUOUS_MIXED" else ("increase" if dom > 0 else "decrease")
        g4326 = to_crs(g, 4326, src=epsg)
        c = to_crs(g.centroid, 4326, src=epsg)
        with np.errstate(invalid="ignore"):
            frac = {f"{ch}_exceeding_fraction": _r(float((np.abs(det['z'][ch][win][sel]) >= det['k']).mean()), 4)
                    for ch in det["z"]}
        cand = {
            "candidate_id": reg["candidate_id"],
            "area_ha": _r(area_ha, 3),
            "pixel_count": reg["pixel_count"],
            "pattern": pat,
            "direction": direction,
            "evidence_level": lvl,
            "centroid_lonlat": [_r(c.x, 6), _r(c.y, 6)],
            "bbox_lonlat": [_r(v, 6) for v in g4326.bounds],
            "statistics": {
                **{k: _r(v) for k, v in st.items()},
                "z_hh_median": _r(z_hh), "z_hv_median": _r(z_hv),
                **frac,
                "valid_pixel_count": reg["pixel_count"],
                "valid_pixel_fraction": _r(neigh_valid, 4),
                "valid_pixel_fraction_definition": f"valid share of the region dilated by {pad} px",
                "compactness": _r(compactness, 3),
                "compactness_definition": "Polsby-Popper 4*pi*A/P^2 of the hole-filled outline",
                "fill_fraction": _r(fill_fraction, 3),
            },
            "evidence": reasons,
            "corroboration": {"status": "not_available"},
            "interpretation_limit": config.INTERPRETATION_LIMIT,
        }
        candidates.append(cand)
        gj = mapping(g4326)
        features.append({"type": "Feature", "id": i, "geometry": _round_geom(gj), "properties": {
            "candidate_id": cand["candidate_id"], "area_ha": cand["area_ha"], "pattern": pat,
            "evidence_level": lvl, "direction": direction,
            "delta_hh_median_db": cand["statistics"].get("delta_hh_median_db"),
            "delta_hv_median_db": cand["statistics"].get("delta_hv_median_db")}})
    fc = {"type": "FeatureCollection", "features": features}
    return candidates, fc


def _round_geom(gj, n=7):
    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], n), round(c[1], n)]
    return {"type": gj["type"], "coordinates": rnd(gj["coordinates"])}
