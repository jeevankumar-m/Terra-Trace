# TerraTrace task runner. On Windows without make, use: powershell -File tasks.ps1 <target>
PY ?= $(if $(wildcard .venv/Scripts/python.exe),.venv/Scripts/python,.venv/bin/python)
API_HOST ?= 127.0.0.1
API_PORT ?= 8000

# Real analysis: make analysis SCENE_A=data/raw/<area>/A.h5 SCENE_B=data/raw/<area>/B.h5 AOI=data/aoi/<area>.geojson ID=<id>
SCENE_A ?=
SCENE_B ?=
AOI ?=
ID ?=
EXTRA ?=

SAMPLE_DIR := data/raw/nasa_sample_lband
SAMPLE_BASE := https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/GCOV
SAMPLE_A := NISAR_L2_PR_GCOV_001_030_A_019_2800_SHNA_A_20081012T060911_20081012T060925_D00404_N_F_J_001
SAMPLE_B := NISAR_L2_PR_GCOV_002_030_A_019_2800_SHNA_A_20081127T061000_20081127T061014_D00404_N_F_J_001

.PHONY: setup synthetic analysis sample api web test demo

setup:
	python -m venv .venv
	$(PY) -m pip install -r requirements.txt
	cd frontend && pnpm install

synthetic:  ## SYNTHETIC dev/test data only (labelled in the UI)
	$(PY) -m tests.fixtures.synthetic --out tests/fixtures/synthetic_dev --aoi data/aoi/synthetic_dev.geojson
	$(PY) -m analysis.run_analysis --scene-a tests/fixtures/synthetic_dev/SYNTHETIC_DEV_SCENE_A.h5 \
		--scene-b tests/fixtures/synthetic_dev/SYNTHETIC_DEV_SCENE_B.h5 --aoi data/aoi/synthetic_dev.geojson \
		--analysis-id synthetic_dev

analysis:
ifeq ($(SCENE_A),)
	$(MAKE) synthetic
else
	$(PY) -m analysis.run_analysis --scene-a $(SCENE_A) $(if $(SCENE_B),--scene-b $(SCENE_B)) \
		--aoi $(AOI) --analysis-id $(ID) $(EXTRA)
endif

sample:  ## public NASA GCOV sample (L-band, ALOS-derived): reader validation, fails the S-band gate by design
	mkdir -p $(SAMPLE_DIR)
	test -f $(SAMPLE_DIR)/$(SAMPLE_A).h5 || curl -L -o $(SAMPLE_DIR)/$(SAMPLE_A).h5 $(SAMPLE_BASE)/$(SAMPLE_A)/$(SAMPLE_A).h5
	test -f $(SAMPLE_DIR)/$(SAMPLE_B).h5 || curl -L -o $(SAMPLE_DIR)/$(SAMPLE_B).h5 $(SAMPLE_BASE)/$(SAMPLE_B)/$(SAMPLE_B).h5
	$(PY) -m analysis.run_analysis --scene-a $(SAMPLE_DIR)/$(SAMPLE_A).h5 --scene-b $(SAMPLE_DIR)/$(SAMPLE_B).h5 \
		--aoi data/aoi/nasa_sample_lband.geojson --analysis-id nasa_sample_lband_exploratory --force-exploratory

api:
	$(PY) -m uvicorn backend.main:app --host $(API_HOST) --port $(API_PORT) --reload --reload-dir backend

web:
	cd frontend && pnpm dev

test:
	$(PY) -m pytest -q

demo: test analysis
	@echo "Now run 'make api' and 'make web' in two terminals, open http://localhost:3000"
