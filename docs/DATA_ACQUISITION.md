# Getting real NISAR S-band data: step-by-step checklist

Goal: **two NISAR S-band L2-GCOV products over one coastal/delta AOI that pass the pair gate.** Download them yourself
(Bhoonidhi needs your login); TerraTrace never scrapes or bypasses it. Once the files are in `data/raw/<area_id>/`, the
pipeline runs without code changes.

> Bhoonidhi's exact menu labels below come from ISRO's public pages and may differ slightly in the live UI. The filter
> *values* are what matter.

## 0. Before you start (5 min)

- [ ] Bhoonidhi account works: https://bhoonidhi.nrsc.gov.in → Register / Login. NISAR info page:
      https://bhoonidhi.nrsc.gov.in/NISAR/NisarProducts.html
- [ ] Note any order/download limits shown after login (ISRO's pages don't state them).
- [ ] Earthdata login is **not** needed. The NASA sample used for reader validation is public.

- [ ] **If login hangs after the OTP email, or the map is blank:** Bhoonidhi's `odap.js` had a syntax error on
      2026-11-15 (DECISIONS 27). Fix: open DevTools (F12) and go to Sources › Overrides › select a folder. In the Page
      tab, right-click `bhoonidhi/js/odap.js` and choose Override content. Change `includes("WISP")) &&` to
      `includes("WISP") &&`, save, and reload.
- [ ] Open data needs no payment: add scenes to the **Open_Data cart**, click **Confirm**, then use the green
      download icon per scene.

## 1. Search (Browse & Order)

- [ ] **Area of interest.** Start with the proposed AOI `data/aoi/nagapattinam_vedaranyam.geojson` (Vedaranyam swamp +
      Point Calimere, lon 79.55–79.90 E, lat 10.25–10.42 N). Draw that box, or upload it if the UI accepts a polygon or
      shapefile. A compact coastal box keeps downloads small.
- [ ] **Mission / sensor:** NISAR → **S-SAR** (S-band).
- [ ] **Product:** **L2-GCOV**. Not GSLC/GUNW.
- [ ] **Dates:** start **2026-07-08** (Cycle 25, systematic production) → today. Widen to earlier reprocessed scenes only if needed.
- [ ] **Advanced NISAR filters** (if offered): polarization **DH** (dual HH/HV), processing type PR (not UR: urgent-response
      products can be partial or single-pol).

## 2. Group the results (the pair gate on paper)

The product name holds everything you need. Example:
`NISAR_S2_PR_GCOV_024_084_A_007_3700_DHNA_A_20260702T001555_20260702T001631_P00500_P_F_I_001`

| Must be identical for both scenes | Where in the name | Example |
|---|---|---|
| Band + level + product | `S2_PR_GCOV` | S-band L2 GCOV |
| Relative track | 2nd 3-digit block | `084` |
| Orbit direction | letter after track | `A` |
| Frame | 3 digits after direction | `007` |
| Bandwidth mode | 4 digits | `3700` |
| Polarization | 4 letters | `DHNA` (want DH, both scenes) |
| Prefer same | CRID `P00500`, coverage `F` (full frame) | |

- [ ] List every hit in a small sheet: name, date, track, direction, frame, mode, POLE, CRID, F/P.
- [ ] Pick **two dates with identical track / direction / frame / mode / POLE**. Prefer consecutive 12-day cycles, but
      don't assume every cycle has an acquisition. The first cycle number is in the name (`024`).
- [ ] The public Nagapattinam scene is **cycle 024, track 084, ascending, frame 007, 3700, DHNA (2 Jul 2026)**. It predates
      Cycle 25 (cycle 025 began 8 Jul 2026), so it may be a reprocessed scene. Look for later cycles on **track 084 / A / 007**
      first: that is the most likely matching pair.
- [ ] Check the preview footprint: both scenes must cover the AOI (the pipeline requires ≥ 50 % AOI overlap and ≥ 30 % of
      AOI pixels valid in both).

## 3. Download format: which one?

1. **Best: full HDF5 (`.h5`)**. All metadata intact (track/frame/direction, times, CRID, mask semantics, bandwidth).
   Works directly with `analysis/inspect_product.py`. Files can be large (multi-GB). Make sure you have the disk space.
2. **Good, smaller: Bhoonidhi "HDF to GeoTIFF" utility v7.0 → *sliced HDF5*** (AOI by shapefile or centre + radius).
   The output keeps the HDF5 structure, so the same reader should work. Manual:
   https://bhoonidhi.nrsc.gov.in/bhoonidhi_resources/tools/HDF_to_GeoTIFF_Manual.pdf (tools page:
   https://bhoonidhi.nrsc.gov.in/bhoonidhi/help/tools.html).
   - The AOI shapefile can be made from our GeoJSON in QGIS (Export → ESRI Shapefile).
   - Unverified on a real ISRO slice yet: run step 5's `inspect_product` first. If the slice renames the file, the
     inspector warns and falls back to internal metadata.
3. **Fallback: GeoTIFF/COG export** of `HHHH`, `HVHV`, `mask` per scene + a **sidecar JSON** you fill from the exported
   XML/TXT metadata. Name it `<anything>.scene.json` and put it next to the TIFFs:

```json
{
  "scene_id": "<exact product identifier from Bhoonidhi>",
  "band": "S",
  "product_type": "GCOV",
  "start_utc": "<zeroDopplerStartTime from metadata>",
  "end_utc": "<zeroDopplerEndTime from metadata>",
  "orbit_direction": "<Ascending|Descending>",
  "relative_track": "<track number>",
  "frame": "<frame number>",
  "bandwidth_mode": "<MODE from the product name, e.g. 3700>",
  "polarization_code": "<POLE from the product name, e.g. DHNA>",
  "crid": "<CRID>",
  "backscatter_convention": "gamma0",
  "subswath_masking_applied": "<true|false from validSamplesSubSwathMaskingApplied>",
  "layers": { "HHHH": "<file>_HHHH.tif", "HVHV": "<file>_HVHV.tif", "mask": "<file>_mask.tif" }
}
```
   Every value must be copied from the product's own metadata. All TIFFs of one scene must share CRS, transform and shape.

## 4. Put the files in place

```
data/raw/nagapattinam_vedaranyam/
  NISAR_S2_PR_GCOV_..._<date A>_....h5
  NISAR_S2_PR_GCOV_..._<date B>_....h5
```
(One folder per AOI. The folder name should match the AOI file stem. `data/raw/` is gitignored.)

## 5. Run (no code changes)

```bash
# 1. inspect one product: CRS, real pixel spacing, channels, filename vs metadata cross-check
.venv/Scripts/python -m analysis.inspect_product data/raw/nagapattinam_vedaranyam/<file>.h5 --no-hash

# 2. pair gate over everything you downloaded: prints PASS/fail per date-ordered pair with reasons
.venv/Scripts/python -m analysis.catalog data/raw/nagapattinam_vedaranyam --aoi data/aoi/nagapattinam_vedaranyam.geojson

# 3. full analysis on the passing pair
make analysis SCENE_A=data/raw/nagapattinam_vedaranyam/<A>.h5 SCENE_B=data/raw/nagapattinam_vedaranyam/<B>.h5 \
     AOI=data/aoi/nagapattinam_vedaranyam.geojson ID=nagapattinam_pair_01
# Windows:
powershell -ExecutionPolicy Bypass -File tasks.ps1 analysis -SceneA <A.h5> -SceneB <B.h5> -Aoi data/aoi/nagapattinam_vedaranyam.geojson -Id nagapattinam_pair_01
```

The API makes a real analysis that passed QA the default automatically (synthetic is never the default once a real one
exists). Restart nothing: refresh the browser.

**After the first real run, edit the AOI** (`data/aoi/nagapattinam_vedaranyam.geojson`). Shrink it to the part both scenes
actually cover (the output reports `aoi_overlap` and common valid %), set `"status": "verified"`, and update the `why`
text with the real reason.

## 6. If Nagapattinam fails the gate

Keep Nagapattinam as a single-scene reference (level C: run with `--scene-a` only). Move the temporal analysis to the
nearest delta/estuary with a passing pair. Search in this order (nearest first, same coast and likely the same
ascending track family):

1. **Pichavaram mangroves / Coleroon (Kollidam) estuary**, ~11.40–11.48 N, 79.74–79.82 E: northern edge of the Cauvery delta.
2. **Muthupet lagoon & mangroves**, ~10.30–10.42 N, 79.45–79.60 E: just west of the proposed AOI (Tiruvarur district).
3. **Krishna–Godavari delta (Coringa mangroves)**, ~16.70–16.90 N, 82.20–82.35 E.
4. **Mahanadi delta / Bhitarkanika**, ~20.60–20.80 N, 86.80–87.00 E.
5. **Sundarbans (Indian side)**, ~21.6–22.0 N, 88.6–89.0 E.

For any new AOI, copy `nagapattinam_vedaranyam.geojson`, change `area_id`, `name`, `why`, the polygon (draw it around the
footprint of the passing pair), and the raw folder name. These coordinates are search-window suggestions for
Bhoonidhi, not analysed data.

## 7. If HV is missing in one or both scenes

- One HH/HV + one HH-only → **rejected** by QA. Find another pair.
- Both HH-only (SHNA) → passes as **fallback level B**. The UI automatically removes HV layers and HV claims.
- No usable pair at all → **level C**: run with `--scene-a` only, for a one-scene viewer with no temporal claim.

## 8. Reference: the public NASA sample (already wired in)

`make sample` / `tasks.ps1 sample` downloads two public NISAR-format GCOV files (L-band ALOS PALSAR, 2008, ~172 MB each,
no login) from https://science.nasa.gov/mission/nisar/sample-data/ and runs them as **exploratory** (they fail the S-band
contract by design). They prove the HDF5 reader on a real product, and they are **not** demo data.
