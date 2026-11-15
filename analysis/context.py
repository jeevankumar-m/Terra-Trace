"""Ancillary context for an analysis: daily rainfall at towns inside the AOI, around and between the two passes.

    python -m analysis.context <analysis_id>

Source: Open-Meteo Historical Weather API (ERA5 / ERA5-Land reanalysis, modelled, CC BY 4.0), no key needed.
Written once to data/derived/<id>/context.json; the app never calls the weather service at runtime.
Rainfall is context for hypotheses, not corroboration of any single candidate.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import date, timedelta

from shapely.geometry import Point, shape

from analysis import config

# Public town centres (approximate, for context only).
TOWNS = {
    "Thanjavur": (79.137, 10.787), "Kumbakonam": (79.384, 10.962), "Thiruvarur": (79.637, 10.772),
    "Mayiladuthurai": (79.652, 11.103), "Nagapattinam": (79.842, 10.766), "Karaikal": (79.838, 10.925),
    "Mannargudi": (79.452, 10.664), "Pattukkottai": (79.319, 10.423), "Thiruthuraipoondi": (79.637, 10.531),
    "Vedaranyam": (79.850, 10.373), "Point Calimere": (79.853, 10.300), "Muthupet": (79.491, 10.396),
}
SOURCE = "Open-Meteo Historical Weather API (ERA5/ERA5-Land reanalysis, modelled), CC BY 4.0"


def build(analysis_id: str) -> dict:
    d = config.DERIVED_DIR / analysis_id
    m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    aoi = shape(m["aoi"])
    towns = {k: v for k, v in TOWNS.items() if aoi.buffer(0.02).contains(Point(v))}
    if not towns:
        c = aoi.centroid
        towns = {"AOI centre": (round(c.x, 3), round(c.y, 3))}
    da = date.fromisoformat(m["scene_a"]["start_utc"][:10])
    db = date.fromisoformat(m["scene_b"]["start_utc"][:10]) if m["scene_b"] else da
    start = da - timedelta(days=16)
    end = min(db + timedelta(days=16), date.today() - timedelta(days=6))
    lats = ",".join(str(v[1]) for v in towns.values())
    lons = ",".join(str(v[0]) for v in towns.values())
    url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={lats}&longitude={lons}"
           f"&start_date={start}&end_date={end}&daily=precipitation_sum&timezone=Asia%2FKolkata")
    with urllib.request.urlopen(url, timeout=30) as r:
        res = json.loads(r.read())
    res = res if isinstance(res, list) else [res]
    series = []
    for (name, (lon, lat)), x in zip(towns.items(), res):
        days, mm = x["daily"]["time"], [v or 0.0 for v in x["daily"]["precipitation_sum"]]
        between = sum(v for t, v in zip(days, mm) if da.isoformat() < t <= db.isoformat())
        series.append({"name": name, "lon": lon, "lat": lat, "mm_between_passes": round(between, 1),
                       "days": days, "mm": mm})
    out = {"rainfall": {"source": SOURCE, "date_a": da.isoformat(), "date_b": db.isoformat(),
                        "mean_mm_between_passes": round(sum(s["mm_between_passes"] for s in series) / len(series), 1),
                        "towns": series}}
    (d / "context.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("analysis_id")
    r = build(ap.parse_args().analysis_id)["rainfall"]
    print(f"{len(r['towns'])} towns, mean {r['mean_mm_between_passes']} mm between {r['date_a']} and {r['date_b']}")
    for t in r["towns"]:
        print(f"  {t['name']:<18} {t['mm_between_passes']:>6.1f} mm")
