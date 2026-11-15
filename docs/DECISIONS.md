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
26. **First real pair (2026-11-15): track 084 / Ascending / frame 007 / mode 3700 / DHNA / CRID P00500.**
    Bhoonidhi search (centre 10.33 N 79.72 E, 20 km, 7 Jul to 15 Nov 2026, NISAR SSAR Level-2 GCOV) returned DH
    scenes on this track every 12 days, from 14 Jul to 11 Nov 2026. Picked the two newest **PR** (standard) products:
    `NISAR_S2_PR_GCOV_032_084_A_007_3700_DHNA_A_20261006T001552_20261006T001629_P00500_M_F_I_001` (Date A) and
    `NISAR_S2_PR_GCOV_033_084_A_007_3700_DHNA_A_20261018T001553_20261018T001629_P00500_M_F_I_001` (Date B).
    The 30 Oct and 11 Nov scenes were **UR** (urgent response, possibly partial), so they were skipped. The orbit-accuracy
    field is `M` (medium), not `P`. A second track (149 D 083, mode 2500, CRNA, compact-pol) also covers the area,
    but it is not dual-pol HH/HV.
27. **Bhoonidhi site bug (observed 2026-11-15):** `bhoonidhi/js/odap.js` has an unbalanced `)` near line 7759
    (`includes("WISP")) &&`). The script fails to parse, so login stops after sending the OTP, and the browse map is
    blank. Workaround: a Chrome DevTools Local Override of `odap.js` with that one `)` removed. See DATA_ACQUISITION §0.
28. **First real S-band run (2026-11-15) facts:** EPSG:32644, 10 m posting, full frame 32400 × 33696, `numberOfLooks` ≈ 16,
    convention string "Normalised Radar Backscatter (NRB)", and `validSamplesSubSwathMaskingApplied = False` (the same
    mask semantics as the NASA sample, so the exception path is exercised on real ISRO data). Each file is about 11.4 GB.
    Reads are windowed (512 × 512 gzip chunks), so memory stays small.
29. **Multilook 5 × 5 on linear power (`MULTILOOK_WINDOW`), same for both dates, before dB.** At native 10 m the per-pixel
    Δ MAD was 2.87 dB (HH) and 2.55 dB (HV). |z| ≥ 3 then needs about 13 dB of change, and only one candidate survived.
    Measured on this pair: 3 × 3 gives MAD 1.65 / 1.16 dB; 5 × 5 gives 1.38 / 0.81 dB; 7 × 7 gives 1.28 / 0.66 dB.
    5 × 5 (about 50 m effective) balances noise against the 1 ha MMU. The filter is valid-weighted, so invalid pixels
    never leak. Geometry tests run with window 1.
30. **AOI seaward edge digitised along the sand spit and the Point Calimere coast.** Open sea (62 % of the original box)
    is excluded because it is low-SNR and wind-driven: ΔHH MAD stayed at 1.3 dB even at 7 × 7. AOI 53 512 ha,
    100 % valid in both scenes. Result: 90 candidates, 283.6 ha. The largest are swamp regions with ΔHH −7 to −9 dB,
    reported as response candidates only.
31. **Delta-wide run `cauvery_delta_20261006_20261018`** (2026-11-15): same two frames, AOI = the Cauvery delta land
    (10,506 km²), read with `--decimate 5` (5 × 5 block mean of linear power while reading = 50 m pixels, constant
    memory) and `--mmu-ha 5`. Result: 392 regions, 8,608 ha. Background ΔHH +0.97 ± 1.15 dB.
32. **Analyst RFI flags** (`data/stories/<id>.json` → `flags`). Diffuse oval HV glows near Thanjavur move between dates:
    a glow on 2026-10-06 near 10.60 N, a bigger one on 2026-10-18 near 10.75 N. There is no field structure. The 31
    HV-dominant regions inside them (3,762 ha) are flagged as likely RFI, shown dashed with a warning, and excluded
    from the Insights totals. This is visual review, not an automatic rule. An automatic RFI screen is future work.
33. **Context:** rainfall from the Open-Meteo archive (ERA5 reanalysis, CC BY 4.0), precomputed by
    `analysis.context` into `context.json`; mean 76.4 mm between passes over 12 towns. Basemap: EOX Sentinel-2
    cloudless 2023 (CC BY-NC-SA 4.0). Colour composites are built per tile from the stored dB layers:
    R = HH, G = HV, B = HH − HV; change: R = A HH, G = B = B HH.
