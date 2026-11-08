"""API contract against a SYNTHETIC analysis in a temp data dir."""
import pytest
from fastapi.testclient import TestClient

from analysis.run_analysis import run
from backend import main
from tests.fixtures import synthetic as syn


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    a, b, _ = syn.make_pair(d / "raw")
    aoi = syn.write_aoi(d / "aoi" / "synthetic_dev.geojson")
    run(str(a), str(b), str(aoi), "synthetic_dev", out_root=d / "derived", hash_files=False)
    main.DERIVED, main.AOI = d / "derived", d / "aoi"
    return TestClient(main.app)


def test_endpoints(client):
    assert client.get("/api/health").json()["analyses"] == 1
    assert client.get("/api/areas").json()[0]["synthetic"] is True
    assert len(client.get("/api/scenes", params={"area_id": "synthetic_dev"}).json()) == 2
    pairs = client.get("/api/pairs", params={"area_id": "synthetic_dev"}).json()
    assert pairs[0]["passed"] and all({"name", "status", "reason"} <= set(c) for c in pairs[0]["checks"])
    lst = client.get("/api/analyses").json()
    assert lst["default_analysis_id"] == "synthetic_dev"
    m = client.get("/api/analyses/synthetic_dev").json()
    assert m["synthetic"] and m["method"] == "paired_gcov_temporal_backscatter_v1"
    assert set(m["tiles"]) == set(m["layers"])
    fc = client.get("/api/analyses/synthetic_dev/candidates").json()
    cid = fc["features"][0]["properties"]["candidate_id"]
    c = client.get(f"/api/candidates/synthetic_dev/{cid}").json()
    assert c["interpretation_limit"] == "Radar-response candidate; cause not established"
    assert c["geometry"]["type"] in ("Polygon", "MultiPolygon")


def test_tiles_and_errors(client):
    m = client.get("/api/analyses/synthetic_dev").json()
    lon = (m["bounds_lonlat"][0] + m["bounds_lonlat"][2]) / 2
    lat = (m["bounds_lonlat"][1] + m["bounds_lonlat"][3]) / 2
    import morecantile
    t = morecantile.tms.get("WebMercatorQuad").tile(lon, lat, 12)
    for layer in m["layers"]:
        r = client.get(f"/api/tiles/synthetic_dev/{layer}/12/{t.x}/{t.y}.png")
        assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    assert client.get("/api/tiles/synthetic_dev/a_hh_db/3/0/0.png").status_code == 200  # outside -> blank
    assert client.get("/api/tiles/synthetic_dev/nope/3/0/0.png").status_code == 404
    assert client.get("/api/analyses/missing").status_code == 404
    assert client.get("/api/candidates/synthetic_dev/C-999").status_code == 404
