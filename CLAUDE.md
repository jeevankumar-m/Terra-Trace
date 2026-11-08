# TerraTrace — project memory

> *A platform for tracing and understanding changes across Earth's surface.*

Long-form blueprint: [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) · Method rules: [docs/METHODS.md](docs/METHODS.md) ·
Decisions + sources: [docs/DECISIONS.md](docs/DECISIONS.md) · Status: [docs/PROGRESS.md](docs/PROGRESS.md) ·
Getting real data: [docs/DATA_ACQUISITION.md](docs/DATA_ACQUISITION.md)

## 1. Identity

| | |
|---|---|
| Product | **TerraTrace** (final name) |
| Event | NASA Space Apps Challenge 2026, challenge **Dancing with the SARs** |
| Team | **Team Dhruva**. **Jeevan** is PM and sole builder: science, pipeline, API, frontend, QA. Ignore the blueprint's role split. |
| Dates | Event 14–15 Nov 2026. Submissions close **15 Nov 2026, 23:59 local**. Build started 8 Nov 2026. |

**Rename rule.** The blueprint called the product "NISAR Pulse". **Never write "NISAR Pulse"** anywhere: code, UI, docs,
package names, titles, comments, exports. "NISAR" stays only where it means the satellite mission or its data products.

**Build in one sentence.** A browser workbench that compares two repeat-pass NISAR S-band L2-GCOV acquisitions over
one coastal/delta study area, maps where the HH and HV radar response changed, turns coherent changes into candidate
polygons with measured area, and lets a reviewer inspect the evidence behind each one.

**60-second judge flow.** See the study area and pair (Date A → Date B, QA badge) → toggle Date A HH / Date B HH / ΔHH /
HV / ΔHV / Δ(HH/HV) → see candidate polygons → click one → read area (ha), HH/HV medians, Δ dB, valid coverage,
evidence reasons, "what it does not prove", provenance. (Export comes in phase 2.)

**Target user.** Coastal researcher, wetland analyst, district planning team or disaster-science student who needs to
investigate a surface-change signal without opening raw HDF5 or assembling GIS layers by hand.

**Primary scientific question.** Where has the radar backscatter response changed between two comparable NISAR
observations of a coastal/delta landscape, and does the HH/HV pattern support a *cautious* water-state or
vegetation-structure hypothesis?

**Closing line (demo).** "TerraTrace turns NISAR radar observations into traceable evidence of where a coastal
landscape's radar response has changed, and shows exactly why the system flagged each location."

## 2. Data contract

- Sensor: **NISAR S-band (ISRO S-SAR) only**. Product: **L2-GCOV** (geocoded, RTC, gamma0 power). Never subtract S from L.
- HDF5 (verified on real files + ISRO Product Format Doc v1.2.1 + JPL D-102274):
  - `/science/SSAR/identification/*`: `granuleId`, `radarBand`, `productType`, `orbitPassDirection` ("Ascending"/"Descending"),
    `trackNumber`, `frameNumber`, `zeroDopplerStartTime`/`EndTime` (`YYYY-mm-ddTHH:MM:SS.sssssss`), `compositeReleaseId`,
    `isFullFrame`, `boundingPolygon` (WKT, lon/lat).
  - `/science/SSAR/GCOV/grids/frequencyA/`: `HHHH`, `HVHV` (float32 gamma0 power, `_FillValue` NaN), `mask` (uint8),
    `numberOfLooks`, `rtcGammaToSigmaFactor`, `xCoordinates`/`yCoordinates` (**pixel centres**), `x/yCoordinateSpacing`,
    `projection` (attr `epsg_code`), `listOfPolarizations`.
  - `.../GCOV/metadata/processingInformation/parameters/rtc/outputBackscatterNormalizationConvention` (gamma0),
    `.../parameters/validSamplesSubSwathMaskingApplied`, `.../sourceData/swaths/frequencyA/acquiredRangeBandwidth`.
  - L-band products use `/science/LSAR/...`. The reader discovers the band group; it never assumes it.
- **Mask codes:** `0` = invalid / partially focused, `1..5` = valid (sub-swath number), `255` = fill (outside radar extent).
  **Exception (found in real data):** if `validSamplesSubSwathMaskingApplied == "False"`, mask holds 0 for every imaged
  pixel. Then 0 is *not* invalid; validity = not 255 and power finite > 0. Recorded in manifest + a QA warning.
- **Never hard-code 10 m.** Pixel spacing/area always come from the product geogrid (S-band GCOV posting depends on mode).
- Filename: `NISAR_IL_PT_PROD_CYL_REL_P_FRM_MODE_POLE_S_Start_End_CRID_A_C_LOC_CTR.h5`

  | Segment | Example (public Nagapattinam ID) | Meaning |
  |---|---|---|
  | `IL` | `S2` | instrument S-band, level 2 |
  | `PT_PROD` | `PR_GCOV` | production processing, GCOV |
  | `CYL_REL` | `024_084` | mission cycle (12 days), relative track |
  | `P_FRM` | `A_007` | orbit direction A/D, track frame |
  | `MODE` | `3700` | bandwidth code primary+secondary (S-band A: 75/37/25/10; B always 00) |
  | `POLE` | `DHNA` | DH = HH/HV dual-pol primary; NA = no secondary band |
  | `S` | `A` | acquired single mode (M = mixed) |
  | `Start_End` | `20260702T001555_20260702T001631` | zero-Doppler start/end UTC |
  | `CRID` | `P00500` | composite release ID / processing baseline |
  | `A_C_LOC_CTR` | `P_F_I_001` | orbit accuracy, full/partial frame, I=ISRO/J=JPL, counter |

  Public example: `NISAR_S2_PR_GCOV_024_084_A_007_3700_DHNA_A_20260702T001555_20260702T001631_P00500_P_F_I_001`.
  The inspector cross-checks every filename field against internal metadata and flags mismatches.

## 3. Scientific method (blueprint §5), as implemented

- **Step A, pair QA** (`analysis/validate_pair.py`). Checks: S-band contract, same band, both GCOV, same POLE, same orbit
  direction, same relative track, same frame, same bandwidth mode, HH+HV in both (HH-only vs HH/HV = **reject**; both
  HH-only = warn → level B), same CRS, grid alignment (sub-pixel offset = warn + resample), AOI overlap ≥ 50 %,
  Date B > Date A, same radiometric convention (warn), same CRID (warn), filename/metadata consistency (warn),
  sub-swath mask semantics (warn), common valid coverage ≥ 30 % (after prep), scene-wide Δ background offset > 1 dB (warn).
  **Reject when:** HH-only vs HH/HV; ascending vs descending; track/frame differ; insufficient overlap; unusable masks.
  A failed pair never gets deltas unless `--force-exploratory` (then everything is labelled exploratory, evidence LOW).
- **Step B, prep** (`prepare_gcov.py`). Scene A's grid is the reference. Window = AOI ∩ both footprints. Pixel-aligned
  grids are sliced (no resampling). Otherwise B is warped: bilinear for power, nearest for mask, recorded in the manifest.
  Joint valid mask excludes fill, invalid codes, non-finite, ≤ 0 power, outside AOI. Linear power kept (`cog/audit/`).
  gamma0 kept for both dates; `APPLY_GAMMA_TO_SIGMA` applies `rtcGammaToSigmaFactor` to **both** if ever enabled.
- **Step C, dB** (`compare_pair.py`). `HH_dB = 10·log10(HHHH)` (**never 20·log10**). `ΔHH = HH_dB(B) − HH_dB(A)`,
  `ΔHV` likewise, `Δ(HH/HV) = ΔHH − ΔHV`. Positive = stronger on Date B. A delta is a measured difference, not a cause.
- **Step D, candidates** (`detect_candidates.py`). Per delta: median and `MAD = median|Δ − median|` over valid pixels.
  `z_robust = 0.6745·(Δ − median)/MAD` (relative anomaly score, **not a probability**). Candidate pixel:
  `|z| ≥ k` (k = 3.0) on ΔHH **or** ΔHV. Optional 3×3 median on z (off by default; unfiltered layers kept). 8-connected
  components. Drop components < MMU (1.0 ha, converted with the real pixel area). Polygonize, then EPSG:4326 for web;
  native CRS for area. IDs `C-001…` by area descending (ties: first pixel).
- **Area** = pixel count × |pixel width × height| from the geotransform; ha = m² / 10 000.

## 4. Interpretation rules

| Label (enum) | Means | Must NOT claim |
|---|---|---|
| HH-dominant response change (`HH_DOMINANT_CHANGE`) | HH beyond threshold, HV near background | not "water expansion", "erosion", "construction" |
| HV-dominant response change (`HV_DOMINANT_CHANGE`) | HV changed more strongly than HH | not biomass or mangrove-health measurement |
| Dual-channel coherent change (`DUAL_CHANNEL_CHANGE`) | both channels coherent, same direction | not a confirmed flood / land-cover conversion |
| Water-like transition candidate (`WATER_LIKE_TRANSITION`) | needs independent water/optical reference | not a flood alert (tide, wind, wet soil). **Never assigned in phase 1.** |
| Ambiguous / mixed response (`AMBIGUOUS_MIXED`) | channels disagree, weak quality, many explanations | do not force a category |
| HH response change, single-pol (`SINGLE_POL_HH_CHANGE`) | level B only: HV absent in the pair | cannot separate HH-dominant from dual |

Pattern rule (median z inside region): both |z| ≥ k → dual if same sign else ambiguous; HH ≥ k and |z_HV| < 2 →
HH-dominant; HV ≥ k and |z_HH| < 2 → HV-dominant; else ambiguous. **Evidence level** High/Medium/Low from explicit
rules (pair QA, valid neighbourhood ≥ 90 %, channel agreement, size ≥ 5×MMU, compactness ≥ 0.2), with the list of
reasons always shown, and always including "Independent corroboration not yet available". **HIGH is reserved**: capped at
MEDIUM until corroboration exists. Failed/exploratory pair → LOW. **No fake probabilities, ever.**

**Scientific language rule.** Report "radar-response change candidates". Use "water-like" / "vegetation-associated" only
where independently supported. Never claim a cause without independent evidence. Every candidate carries
`interpretation_limit: "Radar-response candidate; cause not established"`. UI words never used: flood detected,
mangrove loss, erosion, deforestation.

**Safe demo wording.** "This 12.6 ha region exhibits a coherent HH backscatter decrease between the two selected
acquisitions. HV remains near its local background range. The app flags it as an HH-dominant radar-response change
candidate; an independent reference is still needed to determine whether the cause is inundation, surface wetness,
roughness change or another process." (The 12.6 is illustrative wording from the blueprint, not a result.)

## 5. Honesty rules (non-negotiable)

- No fabricated scene IDs, acquisition dates, coordinates or metrics in code, seed data, copy or screenshots.
  Placeholders look like placeholders (`<from metadata>`).
- Synthetic data lives only in `tests/fixtures/` and `analysis_id = synthetic_dev`. It is marked `missionId=SYNTHETIC_DEV`,
  placed in open ocean near 0°N 0°E, dated year 2000. The UI shows a persistent red banner
  **"SYNTHETIC DEV DATA — not NISAR observations"**. Synthetic is never the default once any real analysis exists, and
  never appears in the demo.
- The NASA public sample (`nasa_sample_lband_exploratory`) is real product structure but **ALOS PALSAR L-band 2008 data
  in NISAR GCOV format** (missionId=ALOS). It fails the S-band gate by design and is only shown as EXPLORATORY.
  It is not the demo.
- UI adapts from the manifest (`fallback_level`, `status`, `layers`), never hard-coded flags.

## 6. Fallback levels (blueprint §15)

| Level | What remains | When |
|---|---|---|
| A | two-date HH+HV change, candidates, evidence, area | target |
| B | two-date single-pol (HH) change; HV layers and HV claims removed automatically | pair shares only HH |
| C | one-scene HH/HV viewer, no temporal claim (`--scene-b` omitted) | no usable pair |

**Risk headlines:** no 2nd compatible Nagapattinam scene → move AOI (keep Nagapattinam as reference); direction/track/mode
mismatch → reject, never force alignment; missing HV → level B; big HDF5 → Bhoonidhi AOI slicing; GDAL NISAR driver
issues → we read with h5py; residual banding/RFI → masks, don't interpret ocean/low-SNR; tide/rain → call it a
response candidate; no optical → "corroboration not available"; tile server fails → static PNG/QGIS fallback + recording;
too many features → scope freeze.

## 7. Non-goals + "do not forget" checks

Non-goals: no flood warnings; no automatic mangrove/biomass/crop/land-cover claims; no raw focusing or custom InSAR;
no S−L subtraction; no accounts, payments, collaboration, live streaming.
Checks: no zero/negative power into log10; same dB conversion and radiometric convention for both dates; apply
`rtcGammaToSigmaFactor` to both or neither; never mix A and D passes; report the AOI fraction actually analysed;
store threshold + software commit with every output.

## 8. Phase plan

**Phase 1 (now):** Feature 1 = pair QA + change-detection engine + API. Feature 2 = comparison workspace
(map, 8-layer switcher, legends, candidate polygons, evidence inspector, QA drawer).
**Deferred (design hooks exist):** GeoJSON/CSV/PDF export (`manifest.exports` reserved); optical/water-mask corroboration
(`corroboration` key + inspector row); rainfall/tide; swipe compare; 3+ dates; multiple AOIs in UI; live threshold slider;
polarimetric decomposition; GUNW; AI explanation; auth/DB/deployment.
**Stretch order (blueprint §16, only after MVP works):** 3rd/4th date → water-reference corroboration → rainfall/tide →
S-band decomposition → GUNW → AI summary (must not invent causes).

## 9. Repo layout and commands

```
analysis/   config.py (ALL thresholds) · inspect_product · validate_pair · prepare_gcov · compare_pair ·
            detect_candidates · summarize · run_analysis (CLI) · catalog (pair gate over a folder)
backend/    main.py (FastAPI + rio-tiler tiles) · schemas.py (Pydantic v2)
frontend/   Next.js 16 App Router + Tailwind 4 + MapLibre 5 (components/Workspace, MapPanel, MapView, Inspector; lib/tt.ts)
data/       aoi/*.geojson (committed) · raw/<area_id>/ (gitignored) · derived/<analysis_id>/ (gitignored)
tests/      test_pipeline.py · test_api.py · fixtures/synthetic.py (SYNTHETIC NISAR-layout HDF5)
docs/       PROJECT_CONTEXT · METHODS · DECISIONS · PROGRESS · DATA_ACQUISITION
```

No `make` on Jeevan's Windows machine: use `powershell -ExecutionPolicy Bypass -File tasks.ps1 <target>` (same targets).

| Task | Command |
|---|---|
| setup | `make setup` (venv + `pip install -r requirements.txt` + `pnpm install` in frontend) |
| tests | `make test` (pytest, 25 tests) |
| synthetic dev analysis | `make synthetic` |
| NASA sample (exploratory) | `make sample` |
| real pair gate | `.venv/Scripts/python -m analysis.catalog data/raw/<area> --aoi data/aoi/<area>.geojson` |
| real analysis | `make analysis SCENE_A=… SCENE_B=… AOI=data/aoi/<area>.geojson ID=<id>` |
| API | `make api` → http://127.0.0.1:8000/docs |
| web | `make web` → http://localhost:3000 (`?analysis=<id>` to pick one) |

Outputs per analysis: `manifest.json` (blueprint §9 schema + status/fallback/legend/background/provenance/exports),
`scene_a.json`, `scene_b.json`, `pair_qa.json`, `metrics.json`, `candidates.geojson`, `cog/*.tif` (+ `cog/audit/`).
Re-runs are byte-identical except `manifest.provenance.created_utc/command`.

API: `/api/health`, `/api/areas`, `/api/scenes?area_id=`, `/api/pairs?area_id=`, `/api/analyses` (list + default),
`/api/analyses/{id}`, `/api/analyses/{id}/candidates`, `/api/candidates/{id}/{cid}`, `/api/tiles/{id}/{layer}/{z}/{x}/{y}.png`.

**Gotcha:** use `127.0.0.1`, not `localhost`, for the API on Windows (localhost costs ~2 s per request via IPv6 fallback).
**Gotcha:** `maplibre-gl.css` forces `.maplibregl-map{position:relative}`; the map container needs a sized wrapper.
**Gotcha:** `frontend/AGENTS.md` is regenerated by `next dev`; Next 16 docs live in `frontend/node_modules/next/dist/docs/`.

## 10. Conventions

- Python 3.11+ (dev on 3.13), deps pinned in `requirements.txt`. Every tunable lives in `analysis/config.py`.
- Method ID exactly `paired_gcov_temporal_backscatter_v1`.
- Science changes need a test in `tests/` (synthetic fixtures only). Run `make test` before committing.
- Small, meaningful commits. Raw data is never committed.
- Record decisions and their sources in `docs/DECISIONS.md`. Keep `docs/PROGRESS.md` and this file current.
- Trust the real product + official spec over the blueprint; log discrepancies in DECISIONS.

## 11. UI design rules (condensed)

- Light, calm canvas `#F6F7F9`, white cards, 14 px radius, hairline borders, no gradients/glass/neon. One accent
  (ink blue `#14213d` / `#1f4e79`); semantic colours only for pass/warn/fail and increase/decrease.
- Geist sans; title 20 px semibold, section labels 12 px medium muted uppercase, body 14 px; **tabular numerals** everywhere.
- KPI tiles: 28–32 px value + small muted unit + one-line label. 8 px grid, 16–24 px card padding. Nothing < 12 px.
- Backscatter: grayscale dB, **shared Date A/B stretch** (joint p2–p98 from manifest). Deltas: RdBu_r, **symmetric ±6 dB**,
  blue = weaker on Date B, red = stronger. Valid mask: excluded = muted grey.
- Candidate colours by pattern (CVD-validated): HH-dominant violet `#6250d6`, HV-dominant aqua `#1baf7a`, dual amber
  `#eda100`, ambiguous grey `#8a8984` (dashed). Same colours on map, chips, legend.
- Formatting: dB 1 decimal with sign and real minus (`+1.8 dB`, `−3.4 dB`, never `−0.0`); ha 1 decimal; % 1 decimal;
  coordinates 4 decimals; dates `2026-07-02 00:15 UTC`. Units always shown.
- Charts: labelled axes with units, two dates = paired dots, no trend line, no pies/3D, transitions ≤ 200 ms.

## 12. Sources (blueprint §18)

1. NASA Space Apps 2026: https://www.spaceappschallenge.org/2026/ · challenges: https://www.spaceappschallenge.org/2026/challenges/
2. ISRO NISAR S-band release (24 Jul 2026): https://www.isro.gov.in/NISARS_Band_SAR_Data_Products_Release.html
3. Bhoonidhi NISAR: https://bhoonidhi.nrsc.gov.in/NISAR/NisarProducts.html · tools: https://bhoonidhi.nrsc.gov.in/bhoonidhi/help/tools.html
4. ISRO Product Format Doc v1.2.1: https://bhoonidhi.nrsc.gov.in/NISAR/NISAR_Data_Product_Format_Document_V1.2.1_digisigned.pdf
5. ASF GCOV guide: https://hyp3-docs.asf.alaska.edu/nisar-docs/gcov/ · HDF5 format: https://nisar-docs.asf.alaska.edu/data-format/
6. OpenSARLab cookbook: https://asfopensarlab.github.io/NISAR_Cookbook/gcov-intro/ · access: https://asfopensarlab.github.io/NISAR_Cookbook/nisar-data-access/
7. NASA NISAR data: https://science.nasa.gov/mission/nisar/data/ · samples: https://science.nasa.gov/mission/nisar/sample-data/
8. JPL D-102274 GCOV spec: https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/DOCS/NISAR_D-102274_RevD_NASA_SDS_Product_Specification_L2_GCOV_w-sigs.pdf

## 13. Three-minute demo script (blueprint §14, phase-1 version)

| Time | Do / say |
|---|---|
| 0:00–0:25 | "NISAR measures radar response, not a photo, so we can inspect surface change through cloud and at night." |
| 0:25–0:50 | Show the real AOI, Date A → Date B in the top bar, open the QA drawer: exact scene IDs, times, checklist. |
| 0:50–1:25 | Date A HH → Date B HH → ΔHH; then HV → ΔHV. Candidate polygons on. |
| 1:25–2:10 | Click a candidate: hectares, HH/HV medians, Δ dB, valid coverage, evidence reasons, "what it does not prove". |
| 2:10–2:40 | (phase 2: optical/context layer.) For now: show the valid mask and explain why QA and thresholds matter. |
| 2:40–3:00 | (phase 2: export.) Close with the one-line statement and the limitation. |

Never demo `synthetic_dev` or the NASA L-band sample as results. They exist for development and reader validation only.

## 14. Current state (update every session)

- 2026-11-08: Features 1 + 2 built and verified on synthetic fixtures (25 tests) and on the real NASA GCOV sample
  structure (exploratory). **Blocking item: Jeevan downloads a real S-band pair** (docs/DATA_ACQUISITION.md), then
  `analysis.catalog` → `make analysis`. First real run: confirm `validSamplesSubSwathMaskingApplied`, real posting,
  CRID and background offset; record the findings in DECISIONS.
- Proposed AOI `data/aoi/nagapattinam_vedaranyam.geojson` is `status: proposed`. Shrink it to the passing pair's footprint
  and mark it `verified` after the first real run.
