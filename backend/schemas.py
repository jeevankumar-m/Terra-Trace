"""Pydantic v2 response models. Large metadata blocks allow extra keys so new manifest fields flow through."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

Status = Literal["pass", "warn", "fail"]
Pattern = Literal["HH_DOMINANT_CHANGE", "HV_DOMINANT_CHANGE", "DUAL_CHANNEL_CHANGE", "AMBIGUOUS_MIXED",
                  "SINGLE_POL_HH_CHANGE", "WATER_LIKE_TRANSITION"]
Evidence = Literal["HIGH", "MEDIUM", "LOW"]


class Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class Health(BaseModel):
    status: Literal["ok"]
    analyses: int
    data_dir: str


class Area(BaseModel):
    area_id: str
    name: str
    why: str | None = None
    status: str | None = None
    synthetic: bool = False
    geometry: dict[str, Any]


class Scene(Open):
    scene_id: str
    band: str | None
    product_type: str | None
    start_utc: str
    end_utc: str
    orbit_direction: str
    relative_track: int | None
    frame: int | None
    polarization_code: str | None
    bandwidth_mode: str | None
    crid: str | None
    crs_epsg: int | None
    pixel_spacing_m: list[float]
    has_hh: bool
    has_hv: bool
    warnings: list[str] = []


class QACheck(BaseModel):
    name: str
    status: Status
    value_a: Any = None
    value_b: Any = None
    reason: str


class PairQA(BaseModel):
    scene_a: str
    scene_b: str
    passed: bool
    fallback_level: str | None
    failed_reasons: list[str]
    checks: list[QACheck]
    analysis_id: str | None = None


class LegendEntry(BaseModel):
    min: float
    max: float
    unit: str
    colormap: str
    stretch: str


class AnalysisListItem(BaseModel):
    analysis_id: str
    area_id: str
    area_name: str
    status: str
    fallback_level: str | None
    synthetic: bool
    exploratory: bool
    date_a: str
    date_b: str | None
    n_candidates: int
    created_utc: str


class AnalysisList(BaseModel):
    default_analysis_id: str | None
    analyses: list[AnalysisListItem]


class Analysis(Open):
    analysis_id: str
    area_id: str
    area_name: str
    status: str
    fallback_level: str | None
    exploratory: bool
    synthetic: bool
    data_label: str | None
    method: str
    scene_a: Scene
    scene_b: Scene | None
    pair_qa: PairQA | None
    layers: dict[str, str]
    legend: dict[str, LegendEntry]
    tiles: dict[str, str]
    threshold: dict[str, Any]
    quality: dict[str, Any]
    summary: dict[str, Any]
    aoi: dict[str, Any]
    bounds_lonlat: list[float]
    provenance: dict[str, Any]
    corroboration: dict[str, Any]
    exports: dict[str, Any]


class EvidenceReason(BaseModel):
    status: Status
    text: str


class Candidate(BaseModel):
    analysis_id: str
    candidate_id: str
    area_ha: float
    pixel_count: int
    pattern: Pattern
    direction: Literal["increase", "decrease", "mixed"]
    evidence_level: Evidence
    centroid_lonlat: list[float]
    bbox_lonlat: list[float]
    statistics: dict[str, Any]
    evidence: list[EvidenceReason]
    corroboration: dict[str, Any]
    interpretation_limit: str
    geometry: dict[str, Any]


class FeatureCollection(Open):
    type: Literal["FeatureCollection"]
    features: list[dict[str, Any]]
