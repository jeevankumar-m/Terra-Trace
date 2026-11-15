# Progress: phase 1 (Features 1 & 2)

Legend: ✅ done and verified · 🟡 done, not yet verified on real S-band data · ⬜ not started

## Feature 1: Pair QA and change-detection engine

| Item | Status | Verified by |
|---|---|---|
| 1a `inspect_product.py`: HDF5 + GeoTIFF/sidecar, filename decoding + cross-check, SHA-256 | ✅ 🟡 | NASA sample HDF5 (real structure, LSAR); synthetic SSAR fixtures; Nagapattinam ID decode test |
| 1b `validate_pair.py`: full checklist with readable reasons, `--force-exploratory` | ✅ | 6 mismatch tests + mixed channels + date order |
| 1c `prepare_gcov.py`: AOI ∩ footprints, slice-or-warp, joint valid mask, spec mask codes | ✅ | alignment + warp-recorded tests; mask tests; real sample |
| 1d `compare_pair.py`: 10·log10, ΔHH/ΔHV/Δratio, COGs (DEFLATE, overviews, nodata) | ✅ | dB tests; COG reproducibility |
| 1e `detect_candidates.py`: median/MAD, z ≥ k, optional filter, 8-conn, MMU in ha, polygons | ✅ | implanted-change, noise, area, MMU tests |
| 1f `summarize.py`: stats, pattern, evidence + reasons, interpretation limit | ✅ | recovery test asserts labels; payload checked via API |
| 1g `run_analysis.py` + `make analysis`: manifest per blueprint §9 | ✅ | byte-identical re-run test |
| 1h FastAPI: health, areas, scenes, pairs, analyses (+list), candidates, candidate, tiles | ✅ | curl on every route; `tests/test_api.py` |
| 1i Tests (blueprint §11 applicable set) | ✅ | 25 passing (`make test`) |
| `analysis/catalog.py`: pair gate over a folder of downloads | ✅ | sample + synthetic folders |

## Feature 2: Comparison workspace

| Item | Status |
|---|---|
| Sidebar (wordmark, tagline, Workspace + disabled Reports/Methods) | ✅ |
| Top bar: area, Date A → Date B UTC, QA badge (exact first failure reason), analysis switcher | ✅ |
| Map: 8-layer switcher (unavailable layers struck out with reason), opacity, candidate toggle, zoom-to-AOI, scale bar, AOI outline | ✅ |
| Legends with real ranges from the manifest (shared A/B stretch, ±6 dB diverging, mask key, pattern key) | ✅ |
| Candidate hover (ID + ha), click select, fly-to, deselect (click empty / Esc / back) | ✅ |
| Inspector summary: 4 KPI tiles, sortable list, method + background offset, corroboration row | ✅ |
| Inspector detail: chips, area, centroid/bbox, safe sentence, channel table, two-date chart, evidence checklist, means / does-not-prove, provenance | ✅ |
| QA drawer: scene metadata table + warnings + full checklist | ✅ |
| States: loading skeletons, API down, no analysis, failed QA (deltas blocked), exploratory, level B/C, zero candidates, synthetic banner | ✅ (screenshot-checked: failed QA, exploratory, zero candidates, API down; "no analysis" built but not screenshot-checked) |
| Visual review at 1440×900 and 1280×720 (Playwright + system Chrome) | ✅ |

## Data

| Item | Status |
|---|---|
| Real S-band pair downloaded (Bhoonidhi) | ✅ 2026-10-06 → 2026-10-18, track 084 A frame 007 DHNA (DECISIONS 26) |
| Real S-band analysis as default | ✅ `nagapattinam_20261006_20261018`: level A, 90 candidates, 283.6 ha; screenshots in `docs/screenshots/` |
| NASA public sample (L-band, exploratory) | ✅ `make sample` |

## Next (phase 2, in order)

1. ✅ Real pair run; mask flag, posting and CRID verified; multilook + coastal AOI added (DECISIONS 28–30).
2. ✅ Export (2026-11-15): `GET /api/analyses/{id}/export/{candidates.geojson|candidates.csv|report.html}` via `analysis/export.py`; Inspector "Export" section. Test: `test_exports`.
3. Optional corroboration layer (water mask / optical context), never subtracted.
4. Demo branch freeze, recording, static PNG fallback.
