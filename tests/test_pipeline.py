"""Blueprint section 11 tests. All rasters here are SYNTHETIC (tests/fixtures/synthetic.py)."""
import json
import math

import numpy as np
import pytest
from rasterio.transform import Affine
from shapely.geometry import box

from analysis import config
from analysis.compare_pair import power_to_db
from analysis.detect_candidates import detect
from analysis.inspect_product import open_scene, parse_product_name, scene_manifest
from analysis.prepare_gcov import load_aoi, prepare, scene_valid
from analysis.run_analysis import run
from analysis.validate_pair import validate_pair
from tests.fixtures import synthetic as syn

NAGAPATTINAM = "NISAR_S2_PR_GCOV_024_084_A_007_3700_DHNA_A_20260702T001555_20260702T001631_P00500_P_F_I_001"


@pytest.fixture(scope="session")
def pair(tmp_path_factory):
    d = tmp_path_factory.mktemp("syn")
    a, b, truth = syn.make_pair(d)
    aoi = syn.write_aoi(d / "aoi.geojson")
    return a, b, aoi, truth


@pytest.fixture(scope="session")
def result(pair, tmp_path_factory):
    a, b, aoi, _ = pair
    out = tmp_path_factory.mktemp("derived")
    run(str(a), str(b), str(aoi), "t1", out_root=out, hash_files=False)
    return out / "t1"


# --- dB math -------------------------------------------------------------------------------
def test_db_math():
    db = power_to_db(np.array([10.0, 0.5, 1.0, 0.0, -1.0, np.nan, np.inf]))
    assert db[0] == pytest.approx(10.000, abs=1e-6)
    assert db[1] == pytest.approx(-3.010, abs=1e-3)
    assert db[2] == pytest.approx(0.0, abs=1e-9)
    assert np.isnan(db[3:]).all() and not np.isinf(db).any()  # zero/negative/non-finite excluded, never -inf


def test_delta_of_power_ratio():
    a, b = power_to_db(np.array([0.02])), power_to_db(np.array([0.2]))
    assert (b - a)[0] == pytest.approx(10.0, abs=1e-5)  # ratio 10 -> +10 dB (10*log10, not 20*log10)


# --- filename decoding -----------------------------------------------------------------------
def test_parse_public_nagapattinam_id():
    p = parse_product_name(NAGAPATTINAM)
    assert (p["band"], p["level"], p["product"], p["cycle"], p["track"], p["direction"], p["frame"]) == \
        ("S", "2", "GCOV", 24, 84, "A", 7)
    assert (p["mode"], p["pole"], p["crid"], p["location"]) == ("3700", "DHNA", "P00500", "I")
    assert p["polarizations_primary"] == ["HH", "HV"]
    assert p["start_utc"] == "2026-07-02T00:15:55Z"
    assert parse_product_name("SYNTHETIC_DEV_SCENE_A") is None


# --- pair QA -----------------------------------------------------------------------------------
@pytest.fixture(scope="session")
def manifests(pair):
    a, b, _, _ = pair
    return scene_manifest(a, False), scene_manifest(b, False)


@pytest.mark.parametrize("field,value,check", [
    ("orbit_direction", "D", "orbit_direction"),
    ("relative_track", 99, "relative_track"),
    ("frame", 42, "frame"),
    ("polarization_code", "SHNA", "polarization_mode"),
    ("band", "L", "band_contract"),
    ("crs_epsg", 32632, "crs"),
])
def test_pair_qa_rejects_mismatch(manifests, field, value, check):
    a, b = manifests
    qa = validate_pair(a, {**b, field: value})
    assert not qa["passed"]
    c = next(x for x in qa["checks"] if x["name"] == check)
    assert c["status"] == "fail" and len(c["reason"]) > 10  # human-readable reason
    assert c["reason"] in qa["failed_reasons"]


def test_pair_qa_passes_and_rejects_mixed_channels(manifests):
    a, b = manifests
    assert validate_pair(a, b)["passed"]
    assert not validate_pair(a, {**b, "has_hv": False})["passed"]  # HH-only vs HH/HV
    assert not validate_pair(b, a)["passed"]  # Date B must be after Date A


def test_failed_pair_blocks_deltas(pair, tmp_path):
    a, b, aoi, _ = pair
    m = run(str(b), str(a), str(aoi), "swapped", out_root=tmp_path, hash_files=False)  # date order fails
    assert m["status"] == "qa_failed" and not any(k.startswith("delta") for k in m["layers"])
    assert json.loads((tmp_path / "swapped" / "candidates.geojson").read_text())["features"] == []
    m = run(str(b), str(a), str(aoi), "forced", force_exploratory=True, out_root=tmp_path, hash_files=False)
    assert m["status"] == "exploratory" and m["exploratory"]
    cands = json.loads((tmp_path / "forced" / "metrics.json").read_text())["candidates"]
    assert cands and all(c["evidence_level"] == "LOW" for c in cands)


# --- masks ---------------------------------------------------------------------------------------
def test_scene_valid_codes():
    mask = np.array([0, 1, 5, 255, 7, 1, 1], np.uint8)
    p = np.array([1, 1, 1, 1, 1, np.nan, -1], np.float32)
    v, counts = scene_valid([p], mask)
    assert v.tolist() == [False, True, True, False, False, False, False]
    assert counts == {"mask_fill_255": 1, "mask_invalid_0": 1, "mask_unexpected_code": 1,
                      "power_nonfinite": 1, "power_nonpositive": 1}
    v2, _ = scene_valid([p], mask, zero_invalid=False)  # product did not apply sub-swath masking
    assert v2.tolist() == [True, True, True, False, False, False, False]


def test_masked_pixels_never_counted(pair, result):
    a, b, aoi, _ = pair
    sa, sb = open_scene(a), open_scene(b)
    prep = prepare(sa, sb, load_aoi(aoi)[0], use_hv=True)
    win = prep["record"]["window_rows_cols"]
    ma, mb = sa.read("mask", tuple(win)), sb.read("mask", tuple(win))
    bad = (ma != 1) & (ma != 2) | (mb != 1) & (mb != 2) | ~np.isfinite(sb.read("HHHH", tuple(win)))
    assert bad.any()
    assert not (prep["valid"] & bad).any()
    det = detect({"delta_hh_db": np.where(bad, 50.0, 0.0).astype(np.float32) + np.random.default_rng(0).normal(
        0, 1, bad.shape).astype(np.float32)}, prep["valid"], prep["transform"], prep["record"]["pixel_area_m2"])
    assert not (det["labels"] > 0)[bad].any()  # huge values on invalid pixels are never polygonized


# --- area -------------------------------------------------------------------------------------------
def test_area_known_rectangle():
    spacing = 20.0
    t = Affine(spacing, 0, 500000, 0, -spacing, 1000000)
    valid = np.ones((200, 200), bool)
    delta = np.random.default_rng(1).normal(0, 1, (200, 200)).astype(np.float32)
    delta[50:80, 60:110] = 20.0  # 30 x 50 px rectangle
    det = detect({"delta_hh_db": delta}, valid, t, spacing * spacing)
    r = det["regions"][0]
    assert r["pixel_count"] == 1500
    assert r["pixel_count"] * 400 / 1e4 == pytest.approx(60.0)  # ha = px * m2 / 10 000
    assert r["geometry_native"].area == pytest.approx(1500 * 400)
    assert r["geometry_native"].bounds == pytest.approx((500000 + 60 * 20, 1000000 - 80 * 20,
                                                         500000 + 110 * 20, 1000000 - 50 * 20))


def test_mmu_uses_real_pixel_area():
    valid = np.ones((100, 100), bool)
    delta = np.zeros((100, 100), np.float32) + np.random.default_rng(2).normal(0, 1, (100, 100)).astype(np.float32)
    delta[10:14, 10:14] = 30  # 16 px
    for spacing, kept in ((20.0, True), (10.0, False)):  # 16*400 m2 = 0.64 ha; 16*100 m2 = 0.16 ha
        t = Affine(spacing, 0, 0, 0, -spacing, 0)
        det = detect({"delta_hh_db": delta}, valid, t, spacing * spacing, mmu_ha=0.5)
        assert any(r["pixel_count"] >= 16 for r in det["regions"]) is kept


# --- alignment ---------------------------------------------------------------------------------------
def test_alignment_identical_grid(pair):
    a, b, aoi, _ = pair
    prep = prepare(open_scene(a), open_scene(b), load_aoi(aoi)[0], use_hv=True)
    assert prep["record"]["scene_b_resampled"] is False
    for k in ("HHHH", "HVHV"):
        assert prep["a"][k].shape == prep["b"][k].shape == prep["valid"].shape == tuple(prep["shape"])


def test_alignment_offset_grid_is_warped_and_recorded(tmp_path, pair):
    a, _, aoi, _ = pair
    rng = np.random.default_rng(3)
    hh = rng.gamma(16, 0.1 / 16, syn.SHAPE).astype(np.float32)
    b = syn.write_gcov(tmp_path / "SYNTHETIC_DEV_SHIFTED.h5", granule_id="SYNTHETIC_DEV_SHIFTED",
                       start="2000-01-13T00:00:00", end="2000-01-13T00:00:30", hh=hh, hv=hh.copy(),
                       mask=np.ones(syn.SHAPE, np.uint8), x0=syn.X0 + 7.0)  # 7 m sub-pixel shift
    sa, sb = open_scene(a), open_scene(b)
    prep = prepare(sa, sb, load_aoi(aoi)[0], use_hv=True)
    rec = prep["record"]
    assert rec["scene_b_resampled"] and rec["resampling_power"] == "bilinear" and rec["resampling_mask"] == "nearest"
    assert prep["b"]["HHHH"].shape == prep["a"]["HHHH"].shape
    assert rec["transform"][2] == pytest.approx(sa.transform.c + rec["window_rows_cols"][2] * 20)
    qa = validate_pair(scene_manifest(a, False), scene_manifest(b, False))
    assert next(c for c in qa["checks"] if c["name"] == "grid")["status"] == "warn"


# --- implanted changes / noise -----------------------------------------------------------------------------
def test_implanted_changes_recovered(pair, result):
    _, _, _, truth = pair
    m = json.loads((result / "metrics.json").read_text(encoding="utf-8"))
    man = json.loads((result / "manifest.json").read_text(encoding="utf-8"))
    t = Affine(*man["preprocessing"]["transform"][:6])
    full = Affine(syn.SPACING, 0, syn.X0, 0, -syn.SPACING, syn.Y0)
    gj = json.loads((result / "candidates.geojson").read_text())
    assert m["summary"]["n_candidates"] == 3  # tiny 9 px change removed by MMU, noise suppressed
    from analysis.prepare_gcov import to_crs
    from shapely.geometry import shape
    for name, (r0, r1), (c0, c1), _, _, pattern in truth:
        if pattern is None:
            continue
        x0, y0 = full @ (c0, r0)
        x1, y1 = full @ (c1, r1)
        tb = box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        best = max(gj["features"], key=lambda f: to_crs(shape(f["geometry"]), syn.EPSG).intersection(tb).area)
        g = to_crs(shape(best["geometry"]), syn.EPSG)
        filled_bbox = box(*g.bounds)
        iou = filled_bbox.intersection(tb).area / filled_bbox.union(tb).area
        assert iou > 0.8, (name, iou)
        c = next(c for c in m["candidates"] if c["candidate_id"] == best["properties"]["candidate_id"])
        assert c["pattern"] == pattern, name
        true_ha = (r1 - r0) * (c1 - c0) * 400 / 1e4
        assert 0.6 * true_ha <= c["area_ha"] <= 1.1 * true_ha, (name, c["area_ha"], true_ha)
        assert c["pattern"] != "WATER_LIKE_TRANSITION"
        assert c["interpretation_limit"] == config.INTERPRETATION_LIMIT
        assert any("Independent corroboration not yet available" in e["text"] for e in c["evidence"])
    ids = [c["candidate_id"] for c in m["candidates"]]
    areas = [c["area_ha"] for c in m["candidates"]]
    assert ids == ["C-001", "C-002", "C-003"] and areas == sorted(areas, reverse=True)
    assert t.a == syn.SPACING


def test_pure_noise_gives_no_candidates(tmp_path):
    a, b, _ = syn.make_pair(tmp_path, seed=11, with_changes=False)
    aoi = syn.write_aoi(tmp_path / "aoi.geojson")
    m = run(str(a), str(b), str(aoi), "noise", out_root=tmp_path / "d", hash_files=False)
    assert m["summary"]["n_candidates"] <= 1


def test_single_pol_is_level_b_without_hv_claims(tmp_path):
    a, b, _ = syn.make_pair(tmp_path, seed=5, with_hv=False)
    aoi = syn.write_aoi(tmp_path / "aoi.geojson")
    m = run(str(a), str(b), str(aoi), "sp", out_root=tmp_path / "d", hash_files=False)
    assert m["status"] == "ok" and m["fallback_level"] == "B"
    assert not any("hv" in k for k in m["layers"])
    cands = json.loads((tmp_path / "d" / "sp" / "metrics.json").read_text(encoding="utf-8"))["candidates"]
    assert cands and all(c["pattern"] == "SINGLE_POL_HH_CHANGE" for c in cands)


def test_single_scene_is_level_c(pair, tmp_path):
    a, _, aoi, _ = pair
    m = run(str(a), None, str(aoi), "one", out_root=tmp_path, hash_files=False)
    assert m["fallback_level"] == "C" and m["pair_qa"] is None
    assert set(m["layers"]) == {"a_hh_db", "a_hv_db", "valid_mask"}


# --- reproducibility ------------------------------------------------------------------------------------------
def test_reproducible(pair, result, tmp_path):
    a, b, aoi, _ = pair
    run(str(a), str(b), str(aoi), "t1", out_root=tmp_path, hash_files=False)
    for f in ("metrics.json", "candidates.geojson", "pair_qa.json", "scene_a.json"):
        assert (tmp_path / "t1" / f).read_bytes() == (result / f).read_bytes(), f
    m1 = json.loads((result / "manifest.json").read_text(encoding="utf-8"))
    m2 = json.loads((tmp_path / "t1" / "manifest.json").read_text(encoding="utf-8"))
    for m in (m1, m2):
        m["provenance"].pop("created_utc"), m["provenance"].pop("command")
    assert m1 == m2
    for k in m1["layers"]:
        assert (tmp_path / "t1" / m1["layers"][k]).read_bytes() == (result / m1["layers"][k]).read_bytes(), k


def test_manifest_contract(result):
    m = json.loads((result / "manifest.json").read_text(encoding="utf-8"))
    assert m["method"] == "paired_gcov_temporal_backscatter_v1"
    assert m["synthetic"] and m["data_label"].startswith("SYNTHETIC DEV DATA")
    assert {"scene_a", "scene_b", "layers", "threshold", "quality", "provenance", "exports"} <= set(m)
    lg = m["legend"]
    assert lg["a_hh_db"]["min"] == lg["b_hh_db"]["min"] and lg["a_hh_db"]["max"] == lg["b_hh_db"]["max"]
    assert lg["delta_hh_db"]["min"] == -lg["delta_hh_db"]["max"]
    assert math.isfinite(m["quality"]["common_valid_pixel_fraction"])
