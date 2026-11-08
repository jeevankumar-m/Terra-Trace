# TerraTrace methods (`paired_gcov_temporal_backscatter_v1`)

Every number below is a setting in `analysis/config.py`. Changing it changes the outputs, and the full config is
snapshotted into each `manifest.json → provenance.config`.

## 1. Inputs and validity

- Layers: `HHHH`, `HVHV` (gamma0 power, linear), `mask`, from `/science/{SSAR|LSAR}/GCOV/grids/frequencyA`.
- A pixel is **valid in a scene** when every power layer used is finite and > 0 **and** its mask code is a valid
  sub-swath (1–5). Code 255 (fill, outside radar extent) and 0 (invalid / partially focused) are excluded. Codes
  outside {0, 1–5, 255} are excluded and counted as `mask_unexpected_code`.
- **Exception:** when the product reports `validSamplesSubSwathMaskingApplied = "False"`, code 0 carries no validity
  information (every imaged pixel is 0). Then 0 counts as valid if the power is finite and > 0. This is recorded per scene
  as `preprocessing.mask_rule_scene_a/b`, plus a `subswath_mask_semantics` QA warning.
- **Joint valid** = valid in A ∧ valid in B ∧ inside the AOI polygon (pixel centre inside). Exclusion counts per reason are
  in `manifest.quality`.

## 2. Grid

Scene A's geogrid is the reference (pixel centres from `xCoordinates`/`yCoordinates`, corner = centre − half a pixel).
Window = AOI ∩ footprint A ∩ footprint B, snapped outward to A's pixels. If B is pixel-aligned (same CRS, spacing, integer
offset), B is sliced (no resampling). Otherwise B is warped onto A's grid (bilinear for power, nearest for mask) and the
manifest records `scene_b_resampled: true` with both resamplers.

## 3. Backscatter and deltas

`X_dB = 10·log10(X)` on valid pixels only (NaN elsewhere; never −inf).
`ΔHH = HH_dB(B) − HH_dB(A)`, `ΔHV = HV_dB(B) − HV_dB(A)`, `Δ(HH/HV) = ΔHH − ΔHV`. Positive = stronger on Date B.

## 4. Robust background and candidate pixels

For each of ΔHH and ΔHV over joint-valid pixels: `median`, `MAD = median(|Δ − median|)`.
`z_robust = 0.6745 · (Δ − median) / MAD`. If MAD = 0 the layer yields no z-score (degenerate background).
Candidate pixel: `|z_HH| ≥ k` **or** `|z_HV| ≥ k`, with **k = 3.0** (`K_ROBUST`).
Optional 3×3 median filter on z (`SPECKLE_FILTER`, default **off**). Unfiltered layers are always written.

Because z is relative to the scene-wide median, a large median offset (|median Δ| > 1 dB, `BACKGROUND_OFFSET_WARN_DB`)
signals a scene-wide difference (calibration, processing, or a genuinely landscape-wide change). It raises a
`background_offset_*` QA warning and is shown in the inspector's Method block.

## 5. Regions

8-connected components of candidate pixels. Components smaller than the **minimum mapping unit** are dropped:
`MMU_HA = 1.0 ha`, converted to pixels with the product's real pixel area (`ceil(1e4·MMU_HA / pixel_area_m²)`; for
example 25 px at 20 m, 100 px at 10 m). IDs `C-001…` by pixel count descending (ties: first pixel in raster order).

- **Area** = pixel count × |pixel width × pixel height| (geotransform) ÷ 10 000 → ha. Exact; never from a nominal resolution.
- **Polygons**: polygonized in the native CRS (`rasterio.features.shapes`, 8-connectivity), reprojected to EPSG:4326 for
  the web. The *web outline* closes interior holes smaller than the MMU (speckle gaps), for legibility only. Area,
  centroid and bounding box come from the exact pixel region.

## 6. Per-candidate statistics

Medians over the region's pixels: `hh_a/b_median_db`, `hv_a/b_median_db`, `delta_hh/hv_median_db`,
`delta_hh_hv_ratio_median_db`, `z_hh_median`, `z_hv_median`, plus the share of region pixels exceeding k per channel.
`valid_pixel_fraction` = valid share of the region dilated by 2 px (does the region border masked/missing data?).
`compactness` = Polsby–Popper 4πA/P² of the hole-filled outline. `fill_fraction` = pixel area ÷ hole-filled area.

## 7. Pattern label (deterministic)

Using the region's median z (`BACKGROUND_Z = 2.0`):

| Condition | Label |
|---|---|
| HV not available in both scenes | `SINGLE_POL_HH_CHANGE` (level B) |
| \|z_HH\| ≥ k and \|z_HV\| ≥ k, same sign | `DUAL_CHANNEL_CHANGE` |
| \|z_HH\| ≥ k and \|z_HV\| ≥ k, opposite sign | `AMBIGUOUS_MIXED` |
| \|z_HH\| ≥ k and \|z_HV\| < 2.0 | `HH_DOMINANT_CHANGE` |
| \|z_HV\| ≥ k and \|z_HH\| < 2.0 | `HV_DOMINANT_CHANGE` |
| anything else | `AMBIGUOUS_MIXED` |

`WATER_LIKE_TRANSITION` exists in the schema but is **never assigned in phase 1**: it needs an independent water or
optical reference. Direction = sign of the dominant channel's median Δ (`mixed` for ambiguous).

## 8. Evidence level (explainable, not a probability)

Reasons, each `pass` / `warn` / `fail`, always listed:

1. Pair QA passed (else `fail`: exploratory result only).
2. HH: exceeds k (pass) · inside background |z| < 2 (pass) · elevated but < k (warn).
3. HV: same (or warn "HV not available").
4. Channel agreement: pattern is HH-dominant, HV-dominant or dual (pass); else warn.
5. Data quality: valid neighbourhood ≥ 90 % (`EVIDENCE_MIN_NEIGHBOURHOOD_VALID`).
6. Size: area ≥ 5 × MMU (`EVIDENCE_STRONG_SIZE_MMU`).
7. Spatial coherence: compactness ≥ 0.2 (`EVIDENCE_MIN_COMPACTNESS`).
8. Always: warn "Independent corroboration not yet available".

Score = number of passes among 4–7.
- Pair failed or exploratory → **LOW**.
- Score 4 → **HIGH**, but capped at **MEDIUM** while `HIGH_REQUIRES_CORROBORATION = True` (adds a reason line saying so).
- Score 2–3 → **MEDIUM**.
- Score 0–1 → **LOW**.

## 9. What the outputs can and cannot support

Every candidate states `interpretation_limit: "Radar-response candidate; cause not established"`. Labels describe the
radar response only. See `CLAUDE.md` §4 for the wording rules.

## 10. Validation in this repo

`tests/test_pipeline.py` (synthetic fixtures only) covers:
- **dB math:** ratio 10 → +10 dB, 0.5 → −3.010 dB, no −inf.
- **Filename decoding** of the public Nagapattinam ID.
- **Pair QA rejections:** direction, track, frame, polarization, band, CRS, HH-only vs HH/HV, date order.
- **Failed pairs:** blocked from deltas; forced runs are exploratory with LOW evidence.
- **Mask codes:** including the not-applied case; huge values on masked pixels are never polygonized.
- **Area:** a known rectangle equals pixel count × pixel area.
- **MMU:** uses the real pixel area.
- **Alignment:** identical grid gives no resampling; a 7 m offset is warped and recorded.
- **Implanted changes:** recovered with IoU > 0.8 and the correct pattern; the 9-pixel change is removed by the MMU.
- **Pure noise:** ≤ 1 candidate.
- **Fallback levels:** level B single-pol and level C single scene.
- **Reproducibility:** byte-identical metrics, GeoJSON and COGs.
- **Manifest contract.**
