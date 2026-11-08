# TerraTrace

*A platform for tracing and understanding changes across Earth's surface.*
Team Dhruva · NASA Space Apps Challenge 2026 · *Dancing with the SARs*

TerraTrace compares two repeat-pass **NISAR S-band L2-GCOV** acquisitions over one coastal/delta study area. It maps
where the HH and HV radar response changed, turns coherent changes into candidate polygons with measured area, and
lets a reviewer inspect the evidence behind each one. It reports **radar-response change candidates**, not causes.

## Quick start

```bash
make setup        # Python venv + pinned deps, frontend deps (pnpm)
make test         # 25 science + API tests (synthetic fixtures)
make synthetic    # SYNTHETIC dev analysis (clearly labelled in the UI)
make sample       # optional: public NASA GCOV sample pair, run as EXPLORATORY
make api          # http://127.0.0.1:8000/docs
make web          # http://localhost:3000
```
Windows without `make`: `powershell -ExecutionPolicy Bypass -File tasks.ps1 <setup|test|synthetic|sample|api|web>`.

Real data: follow **[docs/DATA_ACQUISITION.md](docs/DATA_ACQUISITION.md)**, then
`make analysis SCENE_A=… SCENE_B=… AOI=data/aoi/<area>.geojson ID=<id>`.

## How it works

`analysis/` (Python): inspect product → pair QA → align + joint valid mask → 10·log10 dB → ΔHH, ΔHV, Δ(HH/HV) →
robust median/MAD z-score → connected regions ≥ MMU → per-candidate stats, pattern and evidence reasons. It writes COGs,
GeoJSON, metrics and a manifest to `data/derived/<analysis_id>/`.
`backend/` (FastAPI) serves those files plus map tiles. `frontend/` (Next.js + MapLibre) is the comparison workspace.

Details: [CLAUDE.md](CLAUDE.md) · [Methods](docs/METHODS.md) · [Decisions & sources](docs/DECISIONS.md) ·
[Progress](docs/PROGRESS.md) · [Full blueprint](docs/PROJECT_CONTEXT.md)

## Data and acknowledgements

NISAR is a joint NASA–ISRO mission. S-band products: ISRO / NRSC Bhoonidhi. Sample products and specifications:
NASA / ASF. Basemap: OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors. This project is not an official
NASA or ISRO product.
