"""Exports built from an analysis folder: candidates GeoJSON, a flat CSV and a one-page HTML evidence report.

Pure functions over manifest.json / metrics.json / candidates.geojson; no science is recomputed.
"""
from __future__ import annotations

import csv
import html
import io
import json

LABELS = {
    "HH_DOMINANT_CHANGE": "HH-dominant response change",
    "HV_DOMINANT_CHANGE": "HV-dominant response change",
    "DUAL_CHANNEL_CHANGE": "Dual-channel coherent change",
    "WATER_LIKE_TRANSITION": "Water-like transition candidate",
    "AMBIGUOUS_MIXED": "Ambiguous / mixed response",
    "SINGLE_POL_HH_CHANGE": "HH response change (single-pol)",
}
CSV_STATS = ["hh_a_median_db", "hh_b_median_db", "hv_a_median_db", "hv_b_median_db", "delta_hh_median_db",
             "delta_hv_median_db", "delta_hh_hv_ratio_median_db", "z_hh_median", "z_hv_median",
             "valid_pixel_fraction", "compactness"]


def _label(m: dict) -> str | None:
    if m["synthetic"]:
        return "SYNTHETIC DEV DATA — not NISAR observations"
    if m["exploratory"]:
        return "EXPLORATORY — pair failed QA; not a valid change result"
    return None


def geojson(m: dict, fc: dict) -> bytes:
    out = {**fc, "properties": {"analysis_id": m["analysis_id"], "method": m["method"], "data_label": _label(m),
                                "scene_a": m["scene_a"]["scene_id"],
                                "scene_b": m["scene_b"]["scene_id"] if m["scene_b"] else None,
                                "interpretation_limit": "Radar-response candidates; cause not established"}}
    return json.dumps(out, indent=1, ensure_ascii=False).encode("utf-8")


def csv_bytes(m: dict, metrics: dict) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["analysis_id", "candidate_id", "pattern", "direction", "evidence_level", "area_ha",
                "centroid_lon", "centroid_lat", *CSV_STATS, "interpretation_limit", "data_label"])
    for c in metrics["candidates"]:
        st = c["statistics"]
        w.writerow([m["analysis_id"], c["candidate_id"], c["pattern"], c["direction"], c["evidence_level"],
                    c["area_ha"], *c["centroid_lonlat"], *[st.get(k) for k in CSV_STATS],
                    c["interpretation_limit"], _label(m) or ""])
    return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM so Excel reads UTF-8


def _db(v) -> str:
    if v is None:
        return "—"
    v = round(v, 1) or 0.0
    return f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.1f} dB"


def report_html(m: dict, metrics: dict) -> bytes:
    e = html.escape
    a, b, s = m["scene_a"], m["scene_b"], m["summary"]
    lab = _label(m)
    rows = "".join(
        f"<tr><td><b>{e(c['candidate_id'])}</b></td><td>{e(LABELS.get(c['pattern'], c['pattern']))}</td>"
        f"<td class=r>{c['area_ha']:.1f}</td><td class=r>{_db(c['statistics'].get('delta_hh_median_db'))}</td>"
        f"<td class=r>{_db(c['statistics'].get('delta_hv_median_db'))}</td><td>{e(c['evidence_level'].title())}</td>"
        f"<td>{c['centroid_lonlat'][1]:.4f}, {c['centroid_lonlat'][0]:.4f}</td></tr>"
        for c in metrics["candidates"])
    qa = "".join(f"<li class={e(q['status'])}><b>{e(q['name'])}</b>: {e(q['reason'])}</li>"
                 for q in (m["pair_qa"] or {}).get("checks", []))
    scene = lambda x: (f"<code>{e(x['scene_id'])}</code><br>{e(x['start_utc'][:16].replace('T', ' '))} UTC · {e(str(x['orbit_direction']))} · "
                       f"track {e(str(x['relative_track']))} · frame {e(str(x['frame']))}") if x else "—"
    doc = f"""<!doctype html><html lang=en><meta charset=utf-8><title>TerraTrace evidence report · {e(m['analysis_id'])}</title>
<style>body{{font:14px/1.45 system-ui,sans-serif;color:#14213d;max-width:960px;margin:32px auto;padding:0 16px}}
h1{{font-size:22px;margin:0}}h2{{font-size:15px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#555}}
table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}}td,th{{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}}
.r{{text-align:right}}.banner{{background:#b42318;color:#fff;padding:8px 12px;font-weight:600;margin:12px 0}}
code{{font-size:12px}}li.fail{{color:#b42318}}li.warn{{color:#8a5a00}}.muted{{color:#666}}@media print{{body{{margin:0}}}}</style>
<h1>TerraTrace evidence report</h1><p class=muted>{e(m['area_name'])} · {e(m['analysis_id'])} · method {e(m['method'])}</p>
{f'<div class=banner>{e(lab)}</div>' if lab else ''}
<h2>Pair</h2><table><tr><th>Date A</th><td>{scene(a)}</td></tr><tr><th>Date B</th><td>{scene(b)}</td></tr>
<tr><th>Pair QA</th><td>{'passed' if (m['pair_qa'] or {}).get('passed') else 'single scene, no pair' if not b else 'FAILED'} · fallback level {e(m['fallback_level'])}</td></tr></table>
<h2>Summary</h2><table><tr><th>Candidates</th><td>{s['n_candidates']} ({s['total_candidate_area_ha']:.1f} ha)</td></tr>
<tr><th>Analysed area</th><td>{s['analysed_area_ha']:.1f} ha of {s['aoi_area_ha']:.1f} ha AOI · common valid coverage {s['common_valid_pixel_fraction'] * 100:.1f}%</td></tr>
<tr><th>Rule</th><td>|z<sub>robust</sub>| ≥ {m['threshold']['k']} on ΔHH or ΔHV, z = 0.6745·(Δ − median)/MAD · MMU {m['threshold']['mmu_ha']} ha · multilook {e(m['threshold'].get('multilook', 'none'))}</td></tr></table>
<h2>Candidates</h2>{'<table><tr><th>ID</th><th>Pattern</th><th class=r>Area (ha)</th><th class=r>ΔHH</th><th class=r>ΔHV</th><th>Evidence</th><th>Centroid (lat, lon)</th></tr>' + rows + '</table>' if rows else '<p>Single-scene view (fallback level C): no temporal comparison, so no change candidates.</p>' if not b else '<p>No candidates above threshold and minimum mapping unit.</p>'}
<h2>Pair checklist</h2><ul>{qa or '<li>Single-scene analysis: no pair checks.</li>'}</ul>
<h2>What this does not prove</h2><p>Each region is a radar-response change candidate; the cause is not established.
Backscatter change alone cannot distinguish inundation, surface wetness, roughness, tide, wind or vegetation change.
Independent corroboration: {e(m['corroboration']['status'].replace('_', ' '))}.</p>
<p class=muted>Generated from manifest created {e(m['provenance']['created_utc'])} · code {e(str(m['provenance']['code_version']))}</p></html>"""
    return doc.encode("utf-8")


if __name__ == "__main__":  # self-check on the signed dB formatter
    assert _db(-3.44) == "−3.4 dB" and _db(1.8) == "+1.8 dB" and _db(-0.04) == "0.0 dB" and _db(None) == "—"
    print("ok")
