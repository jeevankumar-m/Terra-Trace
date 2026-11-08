# Decisions log

Newest last. Each entry: decision · why · source (when something we looked up changed the decision).

## 2026-11-08 (session 1)

1. **Product name TerraTrace; the blueprint's working title is never used.** Per Jeevan.
2. **Repo layout:** Next.js app moved into `frontend/`. Python `analysis/` + `backend/` at the root, one venv `.venv`.
3. **Read NISAR HDF5 with h5py, not GDAL's NISAR driver.** GDAL support arrived in 3.13 (older stacks need the `.nc`
   rename trick), so it is version-sensitive. Source: https://nisar-docs.asf.alaska.edu/data-format/
4. **Band group discovered from the file** (`/science/SSAR` or `/science/LSAR`). The ISRO S-band doc and the JPL L-band spec
   share field names. Sources: ISRO Product Format Doc v1.2.1 (Ch. 7 GCOV); JPL D-102274 Rev D.
5. **Mask codes 0 = invalid / partially focused, 1–5 = valid sub-swath, 255 = fill.** Verified in both specs and in real
   file attributes (`_FillValue = 255`, description text). Sources: ISRO doc v1.2.1 `/science/SSAR/GCOV/grids/frequencyA/mask`;
   JPL D-102274 §4.3.3 (https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/DOCS/NISAR_D-102274_RevD_NASA_SDS_Product_Specification_L2_GCOV_w-sigs.pdf).
6. **DISCREPANCY (spec vs real data): `validSamplesSubSwathMaskingApplied = False`.** In the NASA public GCOV samples the
   mask is 0 for every imaged pixel and 255 outside, so applying the spec literally discards 100 % of the data.
   Decision: honour the product's own flag. When masking was not applied, 0 is not "invalid"; validity comes from 255 +
   finite positive power. Recorded per scene in the manifest and raised as a QA warning. Re-check on the first real
   ISRO S-band product: if its flag is True, the strict rule applies automatically.
7. **xCoordinates/yCoordinates are pixel centres** (JPL D-102274: "grid-mapping location at the center of the
   georeferenced array pixels"). The transform corner is shifted by half a pixel. Verified: sample x0 = 365490 with 20 m spacing.
8. **Filename convention** from ISRO doc §2.2.1 (S-band MODE codes 75/37/25/10 + "00" for the absent band B; LOC I/J).
   The ASF table lists only LOC=J; the ISRO doc adds I (the Nagapattinam ID ends `_I_001`). Source: ISRO doc v1.2.1 §2.2.1;
   https://hyp3-docs.asf.alaska.edu/nisar-docs/gcov/
9. **Products whose names don't parse** (e.g. sliced exports) fall back to internal metadata for POLE
   (`listOfPolarizations` → DH/SH…) and MODE (`acquiredRangeBandwidth` → "3700").
10. **Pair QA severity:** bandwidth-mode mismatch = fail (posting/resolution differ); sub-pixel grid offset = warn +
    recorded bilinear warp; CRID differs = warn; convention differs = warn; common valid coverage < 30 % = fail;
    |median Δ| > 1 dB = warn.
11. **Evidence HIGH is reserved** until independent corroboration exists (blueprint example shows MEDIUM with
    "corroboration not yet available"). `HIGH_REQUIRES_CORROBORATION = True`.
12. **Level B pattern label `SINGLE_POL_HH_CHANGE`.** Calling a single-pol change "HH-dominant" would claim HV did
    not change, which we cannot know. Added to the enum.
13. **Compactness measured on the hole-filled outline.** Speckle holes inside a true change region otherwise collapse
    Polsby–Popper to ~0.01.
14. **Web polygons close holes < MMU** for legibility. Area stays the exact pixel count. Documented in METHODS §5.
15. **Raster serving: rio-tiler inside the FastAPI process** (`/api/tiles/...png`), server-side colormap + rescale
    from the manifest legend. One process, ~5–30 ms per tile locally. Fallback if it gets fragile: pre-rendered PNG
    overlays as a MapLibre `image` source.
16. **API base `http://127.0.0.1:8000`, not `localhost`.** On this Windows machine `localhost` added ~2 s per request
    (IPv6 first, then IPv4 fallback); measured 0.20 s vs 0.002 s for `/api/health`.
17. **Basemap: OpenFreeMap Positron** (`https://tiles.openfreemap.org/styles/positron`), no key needed, attribution
    shipped in the style (OpenFreeMap © OpenMapTiles, data © OpenStreetMap). If the style is unreachable within 4 s the
    map falls back to a blank neutral background, so NISAR layers still render offline.
    Source: https://openfreemap.org
18. **Colours.**
    - Backscatter: `greys_r` with a shared joint p2–p98 stretch for Date A/B.
    - Deltas: `rdbu_r`, symmetric ±6 dB (blue = weaker on B, red = stronger).
    - Patterns: violet/aqua/amber + neutral grey (dashed) for ambiguous. Validated with the dataviz CVD validator
      across all pairs (worst CVD ΔE 9.1, normal-vision 22.9). The contrast warning is offset by text-labelled chips
      and dark casing on outlines.
    - Pattern hues avoid the blue/red delta poles.
19. **Design references:** the "Fit4U admin" and "Popcone admin" Dribbble shots could not be found by search. Designed
    to the described family instead: light, soft-neutral SaaS admin with white cards, hairline borders, one ink-blue
    accent and big tabular KPIs.
20. **Real-data validation without Bhoonidhi:** NASA's public GCOV sample pair (track 030, frame 019, 2008-10-12 and
    2008-11-27, ~172 MB each, no login). Metadata says `missionId=ALOS, instrumentName=PALSAR, radarBand=L`, so it is
    L-band ALOS PALSAR data in NISAR format, not NISAR S-band. It is used only as an exploratory, QA-failed analysis
    to prove the reader on a real product structure. Source: https://science.nasa.gov/mission/nisar/sample-data/
21. **The real sample shows a +4.39 dB scene-wide ΔHH median** between its two dates (likely calibration/processing).
    This motivated decision 10's background-offset warning.
22. **Bhoonidhi HDF-to-GeoTIFF utility v7.0 can export a spatially sliced HDF5** (AOI by centre + radius or shapefile).
    Recommended input route because it keeps the HDF5 structure our reader expects. GeoTIFF/COG exports are also
    supported via a sidecar JSON. Source: https://bhoonidhi.nrsc.gov.in/bhoonidhi_resources/tools/HDF_to_GeoTIFF_Manual.pdf
23. **ISRO release facts:** systematic S-band production from Cycle 25 (8 Jul 2026), baseline v1.4.0 / CRID P00500.
    Known issues: residual radiometric banding in low-SNR areas (ocean, deserts) and residual RFI. Calibration may
    change between baselines, so a CRID mismatch is a QA warning.
    Source: https://www.isro.gov.in/NISARS_Band_SAR_Data_Products_Release.html
24. **No `make` on Jeevan's Windows machine:** `tasks.ps1` mirrors every Makefile target. `.gitattributes` keeps the
    Makefile LF.
25. **Python 3.13** used (3.11+ required). Deps pinned in `requirements.txt` after a clean install. Playwright is a
    dev-only tool for screenshots and is not pinned.
