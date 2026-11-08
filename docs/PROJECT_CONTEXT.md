# TerraTrace: implementation blueprint (long form)

*Team Dhruva · NASA Space Apps Challenge 2026 · Challenge: Dancing with the SARs*
*Transcribed from the internal technical blueprint v1.0 (8 November 2026). The product, originally drafted under a
working title, is now called **TerraTrace**: "A platform for tracing and understanding changes across Earth's surface."
Section 12's team-role split is replaced: **Jeevan owns everything**.*

> **The build in one sentence.** Turn two or more comparable NISAR S-band GCOV acquisitions over one selected delta /
> estuary into aligned HH and HV radar layers, interpretable change maps, candidate polygons, measured affected area,
> and a traceable evidence report.

This is the agreed MVP path, not a generic dashboard. (Phase 1 of the build implements the comparison engine and the
workspace; the evidence report/export is phase 2. See `CLAUDE.md` §8.)

---

## 1. The decision: what we are building

TerraTrace is a browser-based scientific workbench for examining repeat-pass radar changes in one coastal / delta study
area. Its first use case is to inspect changes in water-related and vegetation-related radar response across a selected
estuary or delta, using NISAR S-band Level-2 GCOV data.

The product does not attempt to be a national disaster portal, a universal land-cover classifier, or an AI chatbot. It
solves one narrow and demonstrable job: compare two valid NISAR observations of the same place, show where the radar
response changed, quantify the changed area, and let a reviewer inspect the underlying HH/HV evidence before
interpreting it.

**The judge should be able to do this in 60 seconds:**
Choose a delta → select Date A and Date B → switch HH / HV / ΔHH / ΔHV → see coherent change clusters → click one
cluster → inspect the channel changes, data quality, estimated hectares and uncertainty → export a one-page evidence report.

**Target user.** A coastal researcher, wetland analyst, district planning team or disaster-science student who needs to
investigate a surface-change signal without opening raw HDF5 files or manually assembling multiple GIS layers.

**Primary scientific question.** Where has the radar backscatter response changed between two comparable NISAR
observations of a coastal / delta landscape, and does the HH/HV response pattern support a cautious water-state or
vegetation-structure hypothesis?

**Why this is the right size for a hackathon**
- It uses a real NISAR Level-2 product rather than a made-up satellite feed.
- The science pipeline is meaningful but bounded: data QA, alignment, backscatter conversion, temporal difference,
  candidate extraction and evidence display.
- The wow factor is the inspectable transformation from raw measurement to mapped candidate, not an oversized AI claim.
- The application can be demonstrated with a single verified AOI and one compatible acquisition pair; it does not
  require global coverage.

## 2. Product specification and boundaries

| Item | Definition |
|---|---|
| Product | TerraTrace: coastal and delta surface-change workbench |
| Challenge | Dancing with the SARs |
| Sensor for MVP | NISAR S-band SAR (ISRO S-SAR) only |
| Primary product | Level-2 GCOV (Geocoded Polarimetric Covariance) |
| Primary channels | HHHH and HVHV diagonal covariance layers when the scene is dual-pol HH/HV |
| Study geography | One data-verified delta / estuary AOI. Nagapattinam is the first candidate, not a guaranteed multi-date dataset. |
| Time dimension | At least two comparable acquisition dates; three or more is preferable. |
| Core output | ΔHH and ΔHV backscatter maps, change candidates, polygons, area statistics and evidence panel. |
| User interface | Map + date pair controls + channel switcher + candidate inspector + export. |
| Deployment | Web app; heavy raster processing precomputed by Python worker. |

**Explicit non-goals for the hackathon**
- No claim that the application detects all floods or produces operational flood warnings.
- No automatic claim of mangrove destruction, biomass loss, crop failure or land-cover conversion from backscatter alone.
- No raw orbital SAR focusing or custom InSAR processing in the MVP. GCOV is selected because it is already geocoded and
  terrain-corrected.
- No cross-sensor subtraction between S-band and L-band. Cross-band views may be shown as separate context, never as a
  direct same-channel temporal delta.
- No user accounts, payments, complex collaboration or live streaming unless the core analysis is already stable.

> **Scientific language rule.** The app reports "radar-response change candidates" and, where independently supported,
> "water-like" or "vegetation-associated" response patterns. It does not report a confirmed cause unless independent
> evidence validates it.

## 3. Study area: choose by evidence, not preference

**Initial candidate:** Nagapattinam district and the adjoining Cauvery delta / coastal lagoon system in Tamil Nadu. ISRO
has publicly shown a NISAR S-band GCOV false-colour example from Nagapattinam acquired on 2 July 2026, with HH mapped to
red, HV to green and HH/HV to blue. The same release describes mangroves, agricultural fields, wetlands and coastal
lagoons as visible landscape elements [3].

**Important limitation:** that public example proves that a sample scene exists; it does not prove that a second,
geometrically comparable GCOV acquisition for the same AOI is available and downloadable. ISRO states that systematic
daily processed S-band products are released from Cycle 25, which commenced on 8 July 2026, while earlier historical
scenes are being reprocessed in phases [3].

> **Mandatory pre-build gate.** Before writing the comparison engine, search the Bhoonidhi catalogue and confirm at least
> two S-band L2-GCOV products covering the same AOI with compatible track/frame, orbit direction, bandwidth mode and
> polarization. If Nagapattinam does not pass, select the nearest suitable delta / estuary that does. Do not manufacture
> a before/after pair.

**Exact catalogue search procedure**
1. Open the Bhoonidhi NISAR page and enter Browse & Order. Register / sign in as required.
2. Draw a compact polygon around the study area. Start with a coastal wetland / estuary section rather than the whole
   district; smaller subsets reduce data volume.
3. Filter mission / sensor to NISAR S-SAR, product to L2-GCOV, and acquisition date range to the released period. Start
   with 8 July 2026 onward, then widen the period if needed.
4. Download candidate product metadata first. Group scenes by relative orbit track, orbit direction, frame number,
   bandwidth mode and polarization code.
5. Select a pair with the same geometry / acquisition mode. Prefer consecutive repeat cycles, but do not assume every
   12-day cycle contains an acquisition over the AOI.
6. Check that both scenes cover the same part of the AOI and both contain valid HH and HV layers. Confirm pixel grid /
   projection and quality metadata.
7. Only then freeze the study area and build the demo story around the pair.

**What to do if Nagapattinam fails the pair gate.** Keep Nagapattinam as an optional reference preset, but move the live
temporal analysis to another data-verified coastal or river-delta AOI. Use the same app architecture and method. The
project is the repeat-pass NISAR change workbench; it is not dependent on one district.

Bhoonidhi's public NISAR release page also shows S-band examples from other observation areas, including the
Brahmaputra basin, Idaho, Indonesia, Greenland and Antarctica [3][4]. These examples can guide catalogue searches, but
their public images are not proof of repeat-pair availability.

## 4. Data contract: exactly what enters the system

**Primary input: NISAR S-band L2-GCOV.** GCOV is selected because it provides calibrated backscatter measurements in map
coordinates and applies radiometric terrain correction. ASF describes GCOV as gamma-zero power data, geocoded to the
appropriate UTM / polar projection, with 10 m or 20 m posting for many land acquisitions depending on mode and location
[5]. **Always read the actual geogrid spacing from each product; do not hard-code a nominal resolution.**

| Layer / metadata | Use in TerraTrace |
|---|---|
| `/science/SSAR/GCOV/grids/frequencyA/HHHH` | Real-valued HH backscatter power (gamma0) for dual-pol HH/HV products. |
| `/science/SSAR/GCOV/grids/frequencyA/HVHV` | Real-valued HV backscatter power (gamma0), when HV was acquired. |
| `/science/SSAR/GCOV/grids/frequencyA/mask` | Valid-sample / subswath mask. Interpret values using the product specification; exclude invalid and outside-swath samples. |
| `/science/SSAR/GCOV/grids/frequencyA/numberOfLooks` | Quality / interpretation context for the adaptive multilooking used to form each pixel. |
| `/science/SSAR/GCOV/grids/frequencyA/rtcGammaToSigmaFactor` | Optional factor to convert gamma0 to sigma0. Keep the normalization convention consistent across all compared dates. |
| Metadata: acquisition time, orbit, track/frame, mode, POLE, CRS, spacing | Pair validation, date labels, provenance and spatial alignment. |

The ISRO product-format document describes the S-band GCOV structure under `/science/SSAR` and identifies the
real-valued diagonal covariance layers as backscatter. The ASF GCOV guide gives the analogous LSAR path and explains that
available channels depend on the acquisition mode [5][6].

**Decode the public Nagapattinam example**
`NISAR_S2_PR_GCOV_024_084_A_007_3700_DHNA_A_20260702T001555_20260702T001631_P00500_P_F_I_001`

| Name segment | Interpretation |
|---|---|
| `S2` | S-band instrument, Level-2 product. |
| `PR_GCOV` | Production processing, Geocoded Polarimetric Covariance product. |
| `024 / 084` | Mission cycle and relative orbit track fields. |
| `A / 007` | Ascending orbit direction and track frame number. |
| `3700` | Bandwidth mode code in the product naming convention. |
| `DHNA` | Dual H polarization (HH/HV) for the primary band; secondary band is NA. |
| `20260702T001555` | Radar start time, UTC. Acquisition start / end are carried in the name. |
| `P00500` | Composite Release Identifier / processing baseline. |

The naming fields are defined in the ASF NISAR GCOV guide; the Nagapattinam product identifier and its HH/HV sample
description are published by ISRO [3][5].

**Data access options**

| Route | Use it for | Caution |
|---|---|---|
| ISRO Bhoonidhi Browse & Order | Primary S-band India data search, visualization and download. Supports AOI/date/product filters. | Account / download workflow and any order limits must be checked before the event. |
| Bhoonidhi HDF-to-GeoTIFF / COG tool | Extract only HHHH, HVHV and mask layers and spatially subset to the AOI. | Use the output metadata to confirm CRS, pixel grid and layer units. |
| Bhoonidhi SARPOLTOOL | QGIS-based conversion and polarimetric exploration. | Use only if it shortens preprocessing; do not add unnecessary decomposition to MVP. |
| NASA ASF Vertex / Earthdata | Alternative for NISAR L-band GCOV if a compatible L-band repeat pair is easier to obtain. | Compare L with L, not L with S. S-band and L-band have different wavelengths and scattering responses. |

## 5. Scientific method: from radar power to change evidence

The MVP uses the calibrated, real-valued diagonal covariance layers in GCOV. It does not reprocess raw SAR data. For each
acquisition, the HH and HV layers are read from the HDF5 product or received as GeoTIFF / COG exports from Bhoonidhi.
GCOV is already geocoded and radiometrically terrain-corrected, but pair consistency and quality control remain the
team's responsibility [5][6].

**Step A: validate the pair before comparing pixels**
- Same instrument band: S-band for both scenes.
- Same GCOV product type and same polarization mode; for this MVP, dual-pol HH/HV (product code DH on primary S-band).
- Same orbit direction (ascending or descending), relative track and frame. Prefer the same acquisition geometry and a
  comparable bandwidth mode.
- Both products cover the same AOI. Their valid footprints overlap sufficiently for the intended analysis.
- Read processing baseline, acquisition times, projection, pixel spacing, radiometric convention, masks and quality flags.

> **Reject the pair when** one scene is HH-only and the other is HH/HV; one is ascending and the other descending; the
> frame / track is incompatible; the product grid does not overlap enough; or the calibration / mask metadata indicates
> unusable data.

**Step B: prepare the rasters**
8. Read HHHH, HVHV, mask, geotransform / projection and metadata. If using HDF5 directly, inspect group paths first rather
   than assuming every acquisition contains the same channels.
9. Clip both acquisitions to the same AOI polygon and the same overlap footprint.
10. Use the common map CRS and pixel grid. If grids differ, warp continuous backscatter rasters to one reference grid
    with a suitable continuous resampler; resample masks with nearest-neighbour. Avoid resampling where grids already match.
11. Create a valid-pixel mask from both scenes, excluding fill values, non-finite samples and invalid / outside-swath
    mask codes as defined in the product specification.
12. Check the scene metadata and compare stable control patches. Record every transform and preprocessing decision in
    the analysis manifest.

**Step C: convert calibrated power to decibels.** GCOV diagonal layers represent gamma0 power. For positive power values,
convert to dB using 10 log10(power), not 20 log10(power). Preserve the original linear-power layers for audit and apply
the same convention to both dates [5][6].

```
HH_dB(t) = 10 * log10(HHHH(t))
HV_dB(t) = 10 * log10(HVHV(t))

Delta_HH = HH_dB(date_B) - HH_dB(date_A)
Delta_HV = HV_dB(date_B) - HV_dB(date_A)
# Change in HH/HV power ratio, expressed in dB
Delta_HH_HV_ratio_dB = Delta_HH - Delta_HV
```

Interpretation: positive delta means the backscatter power is stronger on date B; negative delta means it is weaker. A
delta is a measured radar-response difference, not a diagnosis of the physical cause.

**Step D: detect spatially coherent changes**
13. Build a valid overlap mask and difference arrays for HH and HV.
14. Estimate the background distribution of each delta layer over valid pixels. Use a robust median and median absolute
    deviation (MAD) to identify unusual changes; document the chosen threshold and allow the analyst to adjust it.
15. Optionally compute a robust anomaly score: z_robust = 0.6745 × (delta − median(delta)) / MAD(delta). Treat this as a
    relative anomaly score, not a probability.
16. Apply a small spatial filter only if it improves speckle suppression without erasing narrow channels or small
    features. Preserve an unfiltered layer for scientific inspection.
17. Group adjacent candidate pixels into connected regions; remove only noise-sized components using a clearly stated
    minimum mapping unit.
18. Calculate polygon area using the raster geotransform / projected pixel area. Convert square metres to hectares
    (ha = m² / 10,000). Do not assume every NISAR pixel is 10 m.

*(The blueprint's illustrative schematic is not mission data. The app renders real Date A, Date B and their measured difference.)*

## 6. Interpretation: what the system may and may not say

TerraTrace should present evidence patterns rather than overconfident surface labels. SAR backscatter depends on surface
roughness, moisture, geometry, vegetation structure and other factors. A single channel or one two-date difference is
insufficient to infer a unique physical cause [6].

| App label | What it means | What it must not claim |
|---|---|---|
| HH-dominant response change | HH changed beyond the configured robust threshold while HV did not show a comparable change. | Not automatically "water expansion", "erosion" or "construction". |
| HV-dominant response change | HV changed more strongly than HH; may merit inspection of vegetation / structural scattering context. | Not a direct biomass or mangrove-health measurement. |
| Dual-channel coherent change | Both HH and HV exhibit spatially coherent changes. | Not a confirmed flood or land-cover conversion without corroboration. |
| Water-like transition candidate | A low-backscatter/open-water-like signature is supported by channel evidence and an independent water reference or contemporaneous optical context. | Not a flood alert; note tide, wind, wet soil and vegetation-water interaction can alter returns. |
| Ambiguous / mixed response | The channels disagree, quality is weak, or multiple explanations remain plausible. | Do not force a confident category. |

**Candidate confidence should be explainable.** Use High / Medium / Low evidence labels, not fake AI probabilities. The
app should show the reasons that led to the evidence label: pair compatibility, valid-pixel coverage, channel agreement,
spatial coherence, and optional independent corroboration. If no independent check exists, say "not corroborated".

| Evidence dimension | Implementation |
|---|---|
| Pair compatibility | Pass / fail checklist using product metadata. |
| Data quality | Share of common valid pixels; masked / missing regions; warning flags. |
| Channel agreement | Whether HH and HV changes tell a consistent or divergent response story. |
| Spatial coherence | Region size, compactness / connectivity and persistence if more than two dates are available. |
| External corroboration (optional) | Nearest cloud-free Sentinel-2 / optical context, known water masks, rainfall or tide context. Context only; never direct cross-sensor subtraction. |

> **Safe demo wording.** "This 12.6 ha region exhibits a coherent HH backscatter decrease between the two selected
> acquisitions. HV remains near its local background range. The app flags it as an HH-dominant radar-response change
> candidate; an independent reference is still needed to determine whether the cause is inundation, surface wetness,
> roughness change or another process."

## 7. What the judge will actually see

The centre of the product is one comparison workspace, not a collection of unrelated dashboard cards. The judge should be
able to follow the full scientific chain without navigating multiple pages.

**Screen 1: study area / scene selection.** One named study area and its AOI boundary, with a short reason why it was
selected. A scene-pair selector with date, orbit direction, relative track, frame, mode, polarization, product baseline
and valid coverage. A visible compatibility badge: "Pair passed QA" or the exact reason it failed.

**Screen 2: comparison map.** Layer selector: Date A HH, Date B HH, ΔHH, Date A HV, Date B HV, ΔHV, Δ(HH/HV), valid-data
mask and optional reference layer. Date scrubber / pair selector; keep the selected dates visible at all times. Opacity
slider, map legend, zoom-to-AOI, swipe / split-map comparison and a small scale bar. Change polygons on top of the
relevant delta layer; clicking a polygon selects it in the inspector.

**Screen 3: evidence inspector.** Candidate ID, area in hectares, centroid / bounding box, response-pattern label and
evidence level. HH and HV values for the selected polygon: median Date A, median Date B, delta in dB and valid-pixel count.
Mini time-series chart if three or more dates exist; otherwise show a two-date comparison, not a fabricated trend line.
Metadata provenance: exact scene IDs, UTC acquisition time, track / frame, polarization, baseline and processing steps.
A short "what this means / what it does not prove" explanation.

**Screen 4: export.** GeoJSON of candidate polygons, CSV of candidate metrics and a concise PDF / HTML evidence report.
Every export must include AOI, source IDs, acquisition dates, channel names, thresholds, valid-pixel coverage and
software version.

**Core interaction loop.** Select AOI → choose compatible Date A / Date B → run or load analysis → select layer →
inspect candidate polygon → read evidence → compare optical/context layer if available → export evidence report.

## 8. Technical architecture

| Layer | Recommended choice | Why |
|---|---|---|
| Frontend | Next.js / React + TypeScript | Fast to build a polished, responsive single-page workbench. |
| Map | MapLibre GL JS | Open map stack; supports raster tile layers and vector overlays. |
| Charts | Recharts or lightweight SVG charts | Two-date / multi-date HH and HV evidence plots. |
| API | Python FastAPI | Natural fit with geospatial processing and simple typed endpoints. |
| Raster processing | h5py, GDAL, Rasterio, NumPy, SciPy, Shapely / GeoPandas | Read NISAR HDF5, align rasters, compute deltas and polygonize candidates. |
| Raster serving | TiTiler with Cloud Optimized GeoTIFF (COG) | Serve precomputed layers as map tiles without loading whole rasters into browser memory. |
| Persistence | Local manifest JSON / SQLite for MVP | Avoid building authentication or database complexity. Supabase / PostGIS is optional. |
| Storage | Local data directory during build; object storage if hosted | Keep raw source files separate from generated analysis outputs. |

> **Critical architectural choice: precompute first.** Do not run full raster analysis every time a judge clicks the map.
> Process the selected scene pair once, write aligned COGs, change rasters, GeoJSON and an analysis manifest, then have
> the web app read those outputs. This makes the demo stable and keeps the API responsive.

**Data flow.** Raw scene products remain immutable. A Python worker writes derived artefacts into a versioned analysis
folder. FastAPI exposes metadata and candidate details. TiTiler or a COG tile service renders the raster layers. The
frontend combines the map layers, selector controls and evidence inspector.

*(As built: rio-tiler is mounted inside the FastAPI process. See DECISIONS.)*

## 9. Backend contract and output schema

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/areas` | GET | List configured study areas and AOI geometry. |
| `/api/scenes?area_id=...` | GET | List downloaded scenes and their parsed metadata. |
| `/api/pairs?area_id=...` | GET | Return pairs with the compatibility gate result and reasons. |
| `/api/analyses/{analysis_id}` | GET | Return thresholds, scene IDs, summary metrics and output layer URLs. |
| `/api/candidates/{candidate_id}` | GET | Return polygon, area, HH/HV statistics and evidence reasoning. (Built as `/api/candidates/{analysis_id}/{candidate_id}`.) |
| `/api/export/{analysis_id}?format=geojson\|csv` | GET | Download analysis outputs. (Phase 2.) |

**Example analysis manifest (placeholders in angle brackets are intentional)**
```json
{
  "analysis_id": "nagapattinam_pair_01",
  "area_id": "coastal_delta_demo",
  "sensor": "NISAR_S_SAR",
  "product": "L2_GCOV",
  "scene_a": {
    "scene_id": "<exact source product identifier>",
    "acquired_utc": "<timestamp from product metadata>",
    "orbit_direction": "A",
    "relative_track": "<metadata>",
    "frame": "<metadata>",
    "polarization": "DHNA"
  },
  "scene_b": { "scene_id": "<exact second product identifier>" },
  "layers": {
    "a_hh": "cog/date_a_hh.tif",
    "b_hh": "cog/date_b_hh.tif",
    "delta_hh": "cog/delta_hh_db.tif",
    "delta_hv": "cog/delta_hv_db.tif",
    "valid_mask": "cog/valid_mask.tif"
  },
  "method": "paired_gcov_temporal_backscatter_v1",
  "threshold": { "method": "robust_mad", "value": "<record actual setting>" },
  "quality": { "common_valid_pixel_fraction": "<computed>" },
  "provenance": { "code_version": "<git commit>" }
}
```
The app must be populated from real file metadata and computed outputs; never ship placeholder scene IDs or invented
metrics. Store the method identifier exactly as `paired_gcov_temporal_backscatter_v1`.

**Candidate detail payload (shape)**
```json
{
  "candidate_id": "C-004",
  "area_ha": "<measured>",
  "pattern": "HH_DOMINANT_CHANGE",
  "evidence_level": "MEDIUM",
  "statistics": {
    "hh_a_median_db": "<measured>", "hh_b_median_db": "<measured>",
    "delta_hh_median_db": "<measured>", "delta_hv_median_db": "<measured>",
    "valid_pixel_fraction": "<measured>"
  },
  "evidence": [
    "Pair passed same-track / mode / polarization checks",
    "HH change exceeds configured robust threshold",
    "HV response remains inside configured background range",
    "Independent corroboration not yet available"
  ],
  "interpretation_limit": "Radar-response candidate; cause not established"
}
```

## 10. Processing implementation checklist

| Module | Responsibilities | Output |
|---|---|---|
| `inspect_product.py` | Open HDF5, list groups, read attributes, check expected datasets and write metadata JSON. | `scene_manifest.json` (as built: `scene_a.json` / `scene_b.json`) |
| `prepare_gcov.py` | Extract / convert HHHH, HVHV and mask; subset to AOI; verify CRS and pixel spacing. | aligned arrays (+ audit COGs) |
| `validate_pair.py` | Compare sensor, product, track, direction, frame, mode, POLE, time, grid and overlap. | `pair_qa.json` |
| `compare_pair.py` | Apply joint mask; convert power to dB; align; compute ΔHH, ΔHV and change in HH/HV ratio (dB). | delta rasters / COGs |
| `detect_candidates.py` | Robust threshold, spatial filtering, connected components and polygonization. | `candidates.geojson` |
| `summarize.py` | Compute area, per-candidate statistics, valid-pixel fraction and evidence reasons. | `metrics.json` |
| `export_report.py` | Write a reproducible report with methods and provenance. | evidence report (phase 2) |

**HDF5 inspection pattern**
```python
import h5py
with h5py.File("scene.h5", "r") as f:
    base = "/science/SSAR/GCOV/grids/frequencyA"
    print(list(f[base].keys()))
    hh_power = f[f"{base}/HHHH"][:]
    mask = f[f"{base}/mask"][:]
    # Read HVHV only when the product metadata confirms HV is present.
    hv_power = f[f"{base}/HVHV"][:]
```
The exact HDF5 group and datasets must be checked against the selected product and its product-format specification
[7]. GDAL support for NISAR HDF5 depends on version (ASF: GDAL 3.13+; older stacks need the `.nc` extension workaround
or the official HDF conversion route) [8][9].

**Do not forget these checks**
- No negative or zero power is fed to log10; preserve nodata and invalid masks.
- Both scenes use the same dB conversion and same radiometric convention (gamma0 unless deliberately converted).
- If converting gamma0 to sigma0, apply the per-pixel `rtcGammaToSigmaFactor` to both products and document it. Do not mix conventions.
- Do not mix Ascending and Descending scenes for direct per-pixel subtraction.
- Use exact common valid overlap; report the fraction of the AOI actually analysed.
- Store the threshold and software commit alongside every derived raster.

## 11. Validation: how we prove the output is not just a colourful map

| Test | Procedure | Pass condition |
|---|---|---|
| Pair metadata | Unit test deliberately mismatched direction / frame / polarization. | Invalid pair is rejected with human-readable reason. |
| Raster alignment | Compare CRS, affine transform, dimensions and pixel alignment. | Same grid or explicit documented warp; no silent pixel shift. |
| Mask handling | Inject nodata / fill / outside swath values. | Invalid pixels are not counted or polygonized. |
| dB math | Check known synthetic powers, e.g. ratio of 10 equals +10 dB. | Numeric output matches formula within floating-point tolerance. |
| Area calculation | Use a known rectangle on a projected grid. | Computed hectare value agrees with pixel-count × pixel-area. |
| Noise / threshold | Inspect stable patches and change hotspots. | Default threshold suppresses obvious speckle while preserving coherent features; threshold is exposed. |
| Independent check | Compare selected candidate with a contemporaneous cloud-free optical image or trusted reference where available. | Agreement / disagreement is documented, not hidden. |
| Reproducibility | Re-run same pair and same settings. | Identical masks, metrics and outputs within numerical tolerance. |

**Ablation demo.** Show the same AOI with: (1) raw Date A HH, (2) raw Date B HH, (3) ΔHH, (4) ΔHV, and (5) candidate
polygons. Then disable the valid mask or loosen/tighten the threshold to show why quality control and thresholds matter.
The intent is to teach the judge how the signal was obtained, not to manipulate the map to look dramatic.

**Acceptance criteria for submission**
- At least one real NISAR S-band GCOV pair passed by the metadata gate.
- At least one comparison output exists for both HH and HV, or a clear explanation if a channel is unavailable.
- The app shows source scenes, dates, units / normalization, valid coverage and threshold settings.
- Candidate polygons are clickable and display real measured statistics.
- A downloadable GeoJSON / CSV or report can be generated from the same analysis manifest.
- The demo uses no fake coordinates, fake acquisition dates or fabricated change values.

## 12. Ownership and repository plan

**Jeevan owns everything**: data access, product inspection, pair QA, interpretation and validation; HDF5/GeoTIFF
processing, alignment, masks, deltas, polygons and metrics; the MapLibre app, layers, legend and inspector; FastAPI, tiles,
manifest and exports; visual hierarchy, copy, demo script and report; QA, browser testing, Git freeze and submission.
One owner holds the scientific truth of the pipeline (common grid, masking, units) and has authority to reject a bad pair
or a misleading interpretation.

Repository layout: see `CLAUDE.md` §9. **Git discipline:** keep raw HDF5 out of Git (manifests record file names, sizes,
hashes and source IDs); commit code and small configuration files frequently; use one stable `demo` branch for the judge
build; pin Python dependencies and GDAL / Rasterio versions after the first successful install; keep one deterministic
`make demo` or shell command that regenerates analysis outputs from the selected files.

## 13. Execution plan

The official 2026 event runs on 14–15 November. NASA's participant page says project submission opens on 14 November at
9:00 AM and closes on 15 November at 11:59 PM local time [1].

**Before the event: 8–13 November**

| Date | Work | Exit condition |
|---|---|---|
| Nov 8 | Create / verify Bhoonidhi and NASA Earthdata access. Search AOI catalogue and collect candidate scene IDs. | Pair availability spreadsheet started; credentials tested. |
| Nov 9 | Download one scene and inspect HDF5 structure / metadata. Test HDF-to-COG conversion. | HHHH / HVHV / mask open correctly; CRS and pixel spacing recorded. |
| Nov 10 | Find and download a second compatible scene. Build pair validator. | One pair passes all metadata and overlap checks. |
| Nov 11 | Run one end-to-end Python comparison; generate delta rasters and GeoJSON. | Real change outputs exist and pass basic QA. |
| Nov 12 | Build base map with static COG / GeoJSON layers and candidate inspector. | Frontend loads a real raster and real candidate data. |
| Nov 13 | Integrate, write demo narrative, rehearse, freeze data + code plan. Check local-event rules for any pre-event code/data work. | A reproducible, event-compliant starting point and a risk fallback. |

**Hackathon sprint: 14–15 November**

| Window | Priority | Deliverable |
|---|---|---|
| Sat 09:00–12:00 | Freeze AOI + scene pair; reproduce the accepted analysis; finish backend/API skeleton. | Stable data manifest + first comparison layers. |
| Sat 12:00–18:00 | Map controls, date pair selector, HH/HV/delta layers, candidate inspector. | Complete main interaction loop. |
| Sat 18:00–23:00 | Area stats, evidence reasoning, quality panel, exports. | Scientifically defensible candidate details. |
| Sun 00:00–06:00 | Polish UI, legend, charts, metadata provenance, responsive layout. | Feature-complete demo build. |
| Sun 06:00–12:00 | Validation and independent reference check; fix only high-impact defects. | QA checklist passes. |
| Sun 12:00–18:00 | Demo video / screenshots, README, project story, source citations. | Submission package drafted. |
| Sun 18:00–21:00 | Rehearse 3-minute demo; deploy stable version; backup local build. | No new risky features. |
| Sun 21:00–23:00 | Final test and submit early. | Submission complete before 23:59 local. |

> **Scope freeze.** If the comparison engine is not correct, do not add AI narration, GUNW deformation, user accounts or
> a second geography. A working analysis with provenance is more valuable than five unfinished features.

## 14. The three-minute judge demonstration

| Time | What to say / do | What the judge learns |
|---|---|---|
| 0:00–0:25 | "NISAR does not photograph the coast like a phone camera. It measures radar response, so we can inspect surface changes even when optical imagery is limited by clouds or daylight." | The team understands what SAR contributes. |
| 0:25–0:50 | Open the selected real AOI and show the exact Date A / Date B IDs, acquisition times and pair-compatibility checklist. | The data is real and the pair is scientifically selected. |
| 0:50–1:25 | Toggle Date A HH → Date B HH → ΔHH. Repeat with HV and show the coherent candidate polygons. | The product performs real analysis rather than showing a static screenshot. |
| 1:25–2:10 | Click one candidate. Show HH/HV medians, delta dB, valid coverage, hectares and evidence reasons. Explain what is not proven. | The result is interpretable, quantitative and honest. |
| 2:10–2:40 | Switch on the optional optical/context reference and show agreement or disagreement. | The team validates rather than overclaims. |
| 2:40–3:00 | Export the GeoJSON / evidence report. Close with local coastal monitoring value and limitations. | The project is usable beyond the demo. |

**One-line closing statement.** "TerraTrace turns NISAR radar observations into traceable evidence of where a coastal
landscape's radar response has changed, and shows exactly why the system flagged each location."

## 15. Risk register and fallback strategy

| Risk | Impact | Mitigation / decision |
|---|---|---|
| No second compatible scene for Nagapattinam | Temporal analysis cannot be demonstrated for that AOI. | Use the data-pair gate. Move to a region with two matched GCOV scenes. Keep Nagapattinam as a single-scene reference only. |
| Scenes differ in orbit direction / track / mode | False changes caused by viewing geometry / acquisition differences. | Reject the pair; never compensate by forcing a visual alignment. |
| Missing HH or HV channel | Dual-pol comparison incomplete. | Choose a scene pair with same polarization; if impossible, downgrade explicitly to single-pol and remove HV claims. |
| Large HDF5 / conversion delay | Analysis takes too long. | Use Bhoonidhi HDF-to-GeoTIFF with spatial subset; process only needed layers; prepare small AOI. |
| GDAL / HDF5 driver issue | Data cannot open in current environment. | Use official HDF-to-GeoTIFF tool or a tested GDAL 3.13+ environment. Pin the working stack. |
| Residual banding / RFI artifacts | False candidate clusters. | Use masks, inspect low-SNR regions, preserve quality warnings, and do not interpret uniform ocean / low-SNR areas. |
| Tide / rainfall changes water response | App misattributes natural variation. | Show acquisition times and optional tide / rainfall context; call it a response candidate, not a confirmed event. |
| No cloud-free optical image | Independent validation unavailable. | Mark corroboration as unavailable. Do not fake a validation score. |
| Map tile service fails | Judge cannot view raster. | Keep static PNG previews and a local GeoTIFF / QGIS fallback, plus a pre-rendered demo recording. |
| Too many features | Core workflow unstable. | Protect the MVP feature list and scope freeze. |

| Fallback level | What remains | When to use |
|---|---|---|
| A: full MVP | Two-date HH/HV change, candidate polygons, evidence panel, area and export. | Target. |
| B: reduced but valid | Two-date single-polarization change, pair QA, evidence panel and area. | Only if the available matched products do not share both channels. |
| C: exploratory visualizer | One-scene HH/HV composite, feature explanation and metadata inspection. No temporal change claim. | Last resort if no usable pair can be acquired. Clearly label the limitation. |

## 16. Stretch features (only after the MVP works)

| Stretch | What it adds | Gate to start |
|---|---|---|
| Third / fourth acquisition date | Multi-date timeline; median baseline and persistence of candidate changes. | At least three comparable scenes and a stable processing pipeline. |
| Water-reference corroboration | Compare candidate polygons with a trusted open-water baseline or cloud-free optical view. | Suitable date-matched reference data and correct alignment. |
| Rainfall / tide context | Help interpret short-term surface-water changes. | Time-aligned and trusted context data; not required for MVP. |
| S-band polarimetric decomposition | More nuanced scattering characterization if the selected product includes required polarimetric terms. | Verify product mode / covariance layers; do not assume every channel exists. |
| GUNW deformation view | Separate advanced deformation investigation using NISAR interferometric products. | A coherent GUNW time pair, specialist validation and enough time. Not a core dependency. |
| AI explanation assistant | Turn precomputed evidence and metadata into a concise plain-language summary. | Deterministic metrics and rule-based evidence exist first. AI must not invent causes. |

> **Do not build the stretch before the map works.** A third date, GUNW deformation, full polarimetric decomposition and
> generative AI can each become a project of their own. They are optional extensions, not the hackathon definition of done.

## 17. Definition of done: the release checklist

**Data and science**
- [ ] We have at least two real NISAR scenes covering the same chosen AOI.
- [ ] The pair is validated for instrument, product, orbit direction, relative track, frame, mode and polarization.
- [ ] HHHH / HVHV are present where expected; masks and fill values are handled.
- [ ] Both scenes are on the same grid and use the same gamma0 / sigma0 convention.
- [ ] ΔHH and ΔHV are computed in dB and tested against known numeric examples.
- [ ] Candidate polygons are spatially coherent and area is computed from the real geotransform.
- [ ] We show uncertainty, quality coverage and limitations; no causal claim is fabricated.

**Application**
- [ ] The judge can select the AOI and pair of dates.
- [ ] The judge can toggle Date A, Date B, HH, HV, ΔHH and ΔHV layers.
- [ ] Clicking a polygon opens an inspector with real metrics and evidence reasons.
- [ ] The app displays source product identifiers and acquisition times.
- [ ] Export works for GeoJSON / CSV or an evidence report.
- [ ] The deployment has been tested in the browser used for judging.
- [ ] A local backup exists if the hosting or network fails.

**Submission narrative**
- [ ] The challenge problem is stated in plain language.
- [ ] The role of NISAR and the GCOV layers is explained accurately.
- [ ] The selected AOI and data pair are justified by actual coverage.
- [ ] The demo demonstrates a real computed result, not a mock value.
- [ ] All data, software and reference sources are acknowledged.
- [ ] The limitation statement is visible and easy to understand.

## 18. Quick reference and source library (checked 8 November 2026)

1. NASA Space Apps Challenge 2026: participant timeline and submission window. https://www.spaceappschallenge.org/2026/
2. 2026 Challenge catalogue: Dancing with the SARs. https://www.spaceappschallenge.org/2026/challenges/
3. ISRO: NISAR S-Band SAR Data Products Release (24 July 2026). https://www.isro.gov.in/NISARS_Band_SAR_Data_Products_Release.html
4. Bhoonidhi: NISAR product release page. https://bhoonidhi.nrsc.gov.in/NISAR/NisarProducts.html
5. ASF NISAR Data User Guide: GCOV. https://hyp3-docs.asf.alaska.edu/nisar-docs/gcov/
6. ASF OpenSARLab NISAR Cookbook: GCOV introduction. https://asfopensarlab.github.io/NISAR_Cookbook/gcov-intro/
7. ISRO NISAR L & S Band Level-1 & Level-2 Data Product Format Document v1.2.1. https://bhoonidhi.nrsc.gov.in/NISAR/NISAR_Data_Product_Format_Document_V1.2.1_digisigned.pdf
8. ASF NISAR Data User Guide: HDF5 format. https://nisar-docs.asf.alaska.edu/data-format/
9. ASF OpenSARLab: NISAR Data Access. https://asfopensarlab.github.io/NISAR_Cookbook/nisar-data-access/
10. NASA NISAR Data Overview. https://science.nasa.gov/mission/nisar/data/
11. NASA NISAR Sample Data. https://science.nasa.gov/mission/nisar/sample-data/

*The blueprint is an engineering implementation plan. It is not an official NASA / ISRO document and does not imply
endorsement by either agency.*
