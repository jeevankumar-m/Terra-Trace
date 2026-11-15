// Shared types, API access, number formatting and interpretation copy for the TerraTrace workspace.

import type { Geometry } from "geojson";

// Static mode (default): the app reads the frozen API in public/data, written by `python -m analysis.export_static`,
// so it deploys anywhere (Vercel) with no backend. Set NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000 for the live API.
const LIVE = process.env.NEXT_PUBLIC_API_BASE;
export const STATIC = !LIVE;
export const API_BASE = LIVE ?? "/data";

export type Status = "pass" | "warn" | "fail";
export type Pattern =
  | "HH_DOMINANT_CHANGE"
  | "HV_DOMINANT_CHANGE"
  | "DUAL_CHANNEL_CHANGE"
  | "AMBIGUOUS_MIXED"
  | "SINGLE_POL_HH_CHANGE"
  | "WATER_LIKE_TRANSITION";
export type Level = "HIGH" | "MEDIUM" | "LOW";

export interface Scene {
  scene_id: string;
  band: string | null;
  product_type: string | null;
  mission_id?: string | null;
  start_utc: string;
  end_utc: string;
  orbit_direction: string;
  relative_track: number | null;
  frame: number | null;
  polarization_code: string | null;
  bandwidth_mode: string | null;
  crid: string | null;
  crs_epsg: number | null;
  pixel_spacing_m: number[];
  has_hh: boolean;
  has_hv: boolean;
  backscatter_convention?: string | null;
  warnings: string[];
}
export interface QACheck { name: string; status: Status; value_a: unknown; value_b: unknown; reason: string }
export interface PairQA {
  scene_a: string; scene_b: string; passed: boolean; fallback_level: string | null;
  failed_reasons: string[]; checks: QACheck[];
}
export interface LegendEntry { min: number; max: number; unit: string; colormap: string; stretch: string }
export interface AnalysisListItem {
  analysis_id: string; area_name: string; status: string; fallback_level: string | null;
  synthetic: boolean; exploratory: boolean; date_a: string; date_b: string | null; n_candidates: number;
}
export interface Analysis {
  analysis_id: string; area_id: string; area_name: string; status: string;
  fallback_level: "A" | "B" | "C" | null; exploratory: boolean; synthetic: boolean; data_label: string | null;
  method: string; scene_a: Scene; scene_b: Scene | null; pair_qa: PairQA | null;
  layers: Record<string, string>; legend: Record<string, LegendEntry>; tiles: Record<string, string>;
  threshold: { k: number; mmu_ha: number; background_z: number; method: string; speckle_filter: string; multilook?: string; rule: string };
  background: Record<string, { median: number | null; mad: number | null; n: number }>;
  quality: { common_valid_pixel_fraction: number; aoi_area_ha: number; analysed_area_ha: number };
  summary: { n_candidates: number; total_candidate_area_ha: number; analysed_area_ha: number;
    common_valid_pixel_fraction: number };
  aoi: Geometry; bounds_lonlat: [number, number, number, number]; tiles_maxzoom?: number;
  provenance: { code_version: string; created_utc: string };
  preprocessing: { radiometric_convention: string; scene_b_resampled: boolean };
  corroboration: { status: string };
}
export interface Candidate {
  candidate_id: string; area_ha: number; pixel_count: number; pattern: Pattern;
  direction: "increase" | "decrease" | "mixed"; evidence_level: Level;
  centroid_lonlat: [number, number]; bbox_lonlat: [number, number, number, number];
  statistics: Record<string, number | string | null>;
  evidence: { status: Status; text: string }[];
  interpretation_limit: string; geometry: Geometry;
}
export type CandidateProps = {
  candidate_id: string; area_ha: number; pattern: Pattern; evidence_level: Level; direction: string;
};

export async function api<T>(path: string): Promise<T> {
  const r = await fetch(API_BASE + path + (STATIC ? ".json" : ""), { cache: STATIC ? "force-cache" : "no-store" });
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${path}`);
  return r.json();
}
export class ApiError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

// ---- formatting: units always shown, real minus sign, tabular numerals in CSS -------------------
const MINUS = "−";
/** Rounds first, so −0.04 prints as 0.0 (never "−0.0"); real minus sign for negatives. */
const num = (v: number, d: number) => {
  const r = Number(v.toFixed(d)) || 0;
  return r.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", MINUS);
};
const sign = (v: number, d: number) => (Number(v.toFixed(d)) > 0 ? "+" : "");
export const fmtDb = (v: number | null | undefined, signed = true) =>
  v == null ? "—" : `${signed ? sign(v, 1) : ""}${num(v, 1)} dB`;
export const fmtDbNum = (v: number | null | undefined, signed = true) =>
  v == null ? "—" : `${signed ? sign(v, 1) : ""}${num(v, 1)}`;
export const fmtHa = (v: number | null | undefined) => (v == null ? "—" : num(v, 1));
export const fmtPct = (f: number | null | undefined) => (f == null ? "—" : num(f * 100, 1));
export const fmtCoord = (v: number) => num(v, 4);
export const fmtLonLat = ([lon, lat]: number[]) =>
  `${fmtCoord(Math.abs(lat))}° ${lat >= 0 ? "N" : "S"}, ${fmtCoord(Math.abs(lon))}° ${lon >= 0 ? "E" : "W"}`;
export const fmtUtc = (iso: string | null | undefined) =>
  iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—";
export const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

// ---- patterns: one colour per pattern, shared by map, chips and inspector ---------------------------
// Violet / aqua / amber validated all-pairs for CVD (dataviz validator); ambiguous = neutral grey + dashed.
export const PATTERNS: Record<Pattern, { label: string; short: string; color: string; means: string; notProof: string }> = {
  HH_DOMINANT_CHANGE: {
    label: "HH-dominant response change", short: "HH-dominant", color: "#6250d6",
    means: "HH changed beyond the configured robust threshold while HV did not show a comparable change.",
    notProof: "Not automatically water expansion, erosion or construction. An independent reference is needed to tell inundation, surface wetness, roughness change or another process apart.",
  },
  HV_DOMINANT_CHANGE: {
    label: "HV-dominant response change", short: "HV-dominant", color: "#1baf7a",
    means: "HV changed more strongly than HH. This may merit inspection of vegetation or structural scattering context.",
    notProof: "Not a direct biomass or mangrove-health measurement.",
  },
  DUAL_CHANNEL_CHANGE: {
    label: "Dual-channel coherent change", short: "Dual-channel", color: "#eda100",
    means: "Both HH and HV exhibit a spatially coherent change in the same direction.",
    notProof: "Not a confirmed flood or land-cover conversion without independent corroboration.",
  },
  AMBIGUOUS_MIXED: {
    label: "Ambiguous / mixed response", short: "Ambiguous", color: "#8a8984",
    means: "The channels disagree, quality is weak, or multiple explanations remain plausible.",
    notProof: "No confident category is assigned. Do not read a cause into this region.",
  },
  SINGLE_POL_HH_CHANGE: {
    label: "HH response change (single-pol)", short: "HH (single-pol)", color: "#6250d6",
    means: "HH changed beyond the configured robust threshold. HV was not available in both scenes.",
    notProof: "Cannot tell HH-dominant from dual-channel change without HV. No cause is established.",
  },
  WATER_LIKE_TRANSITION: {
    label: "Water-like transition candidate", short: "Water-like", color: "#2a78d6",
    means: "Low-backscatter, open-water-like signature supported by channel evidence and an independent water reference.",
    notProof: "Not a flood alert: tide, wind, wet soil and vegetation–water interaction alter returns.",
  },
};

export const LEVEL_STYLE: Record<Level, string> = {
  HIGH: "bg-ink text-white",
  MEDIUM: "bg-ink/10 text-ink",
  LOW: "bg-white text-ink-2 ring-1 ring-inset ring-line-strong",
};

export const LAYERS: { key: string; label: string; group: "Colour" | "HH" | "HV" | "Other" }[] = [
  { key: "rgb_a", label: "Date A", group: "Colour" },
  { key: "rgb_b", label: "Date B", group: "Colour" },
  { key: "change_hh", label: "Change", group: "Colour" },
  { key: "a_hh_db", label: "Date A", group: "HH" },
  { key: "b_hh_db", label: "Date B", group: "HH" },
  { key: "delta_hh_db", label: "ΔHH", group: "HH" },
  { key: "a_hv_db", label: "Date A", group: "HV" },
  { key: "b_hv_db", label: "Date B", group: "HV" },
  { key: "delta_hv_db", label: "ΔHV", group: "HV" },
  { key: "delta_ratio_db", label: "Δ(HH/HV)", group: "Other" },
  { key: "valid_mask", label: "Valid mask", group: "Other" },
];
export const LAYER_TITLE: Record<string, string> = {
  a_hh_db: "Date A HH backscatter", b_hh_db: "Date B HH backscatter", delta_hh_db: "ΔHH (Date B − Date A)",
  a_hv_db: "Date A HV backscatter", b_hv_db: "Date B HV backscatter", delta_hv_db: "ΔHV (Date B − Date A)",
  delta_ratio_db: "Δ(HH/HV) ratio change", valid_mask: "Valid-data mask",
  rgb_a: "Date A colour composite", rgb_b: "Date B colour composite", change_hh: "HH change composite",
};
export const COMPOSITE_KEY: Record<string, { swatch: string; text: string }[]> = {
  rgb_a: [{ swatch: "#e04040", text: "Red: HH (rough ground, buildings)" }, { swatch: "#40c040", text: "Green: HV (vegetation volume)" },
    { swatch: "#4060e0", text: "Blue: HH/HV ratio" }, { swatch: "#000", text: "Black: smooth water" }],
  change_hh: [{ swatch: "#d03030", text: "Red: darker on Date B (e.g. standing water)" },
    { swatch: "#30d0d0", text: "Cyan: brighter on Date B (e.g. wetter soil)" }, { swatch: "#9a9a9a", text: "Grey: little change" }],
};
COMPOSITE_KEY.rgb_b = COMPOSITE_KEY.rgb_a;

// ---- story + ancillary context (precomputed server-side) -----------------------------------------
export interface Chapter {
  id: string; kicker: string; title: string; body: string[]; hypothesis?: string; caveat?: string;
  layer: string; bounds: [number, number, number, number]; candidate?: string; rain?: boolean;
}
export interface Story { title?: string; subtitle?: string; chapters: Chapter[]; flags?: { ids: string[]; label: string; note: string }[] }
export interface RainTown { name: string; lon: number; lat: number; mm_between_passes: number; days: string[]; mm: number[] }
export interface Rainfall { source: string; date_a: string; date_b: string; mean_mm_between_passes: number; towns: RainTown[] }
export type Flag = { label: string; note: string };
export const flagMap = (s: Story | null): Record<string, Flag> =>
  Object.fromEntries((s?.flags ?? []).flatMap((f) => f.ids.map((id) => [id, { label: f.label, note: f.note }])));

// Free colour basemap: Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0) + EOX label overlay.
export const SAT_STYLE: import("maplibre-gl").StyleSpecification = {
  version: 8,
  sources: {
    s2: { type: "raster", tileSize: 256, maxzoom: 15, tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"],
      attribution: "Sentinel-2 cloudless 2023 by <a href=\"https://s2maps.eu\">EOX</a> (modified Copernicus Sentinel data)" },
    labels: { type: "raster", tileSize: 256, maxzoom: 15, tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/overlay_bright_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.png"],
      attribution: "Labels © OpenStreetMap contributors, EOX" },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#1d2733" } },
    { id: "s2", type: "raster", source: "s2" },
    { id: "labels", type: "raster", source: "labels" },
  ],
};

/** Why a layer is unavailable, from the manifest only (never hard-coded per analysis). */
export function layerBlockedReason(a: Analysis, key: string): string | null {
  if (a.layers[key] || a.tiles?.[key]) return null;
  if (a.fallback_level === "C") return "Single scene (level C): no Date B or temporal change";
  if (key.includes("hv") || key === "delta_ratio_db") {
    if (!a.scene_a.has_hv || (a.scene_b && !a.scene_b.has_hv)) return "HV not available in both scenes (level B)";
  }
  if (a.status === "qa_failed" && key.startsWith("delta")) return "Blocked: pair failed QA";
  return "Not produced for this analysis";
}

/** Plain-language sentence in the blueprint's safe-wording style, built from measured values only. */
export function safeSentence(c: Candidate): string {
  const s = c.statistics as Record<string, number | null>;
  const dir = (v: number | null) => (v == null ? "" : v < 0 ? "decrease" : "increase");
  const hh = `HH backscatter ${dir(s.delta_hh_median_db)} (median ${fmtDb(s.delta_hh_median_db)})`;
  const hv = s.delta_hv_median_db == null ? null : `HV ${dir(s.delta_hv_median_db)} (median ${fmtDb(s.delta_hv_median_db)})`;
  const head = `This ${fmtHa(c.area_ha)} ha region exhibits`;
  switch (c.pattern) {
    case "HH_DOMINANT_CHANGE":
      return `${head} a coherent ${hh} between the two selected acquisitions. HV remains near its background range (${fmtDb(s.delta_hv_median_db)}).`;
    case "HV_DOMINANT_CHANGE":
      return `${head} a coherent ${hv} between the two selected acquisitions. HH remains near its background range (${fmtDb(s.delta_hh_median_db)}).`;
    case "DUAL_CHANNEL_CHANGE":
      return `${head} a coherent ${hh} together with an ${hv}.`;
    case "SINGLE_POL_HH_CHANGE":
      return `${head} a coherent ${hh}. HV is not available for this pair.`;
    default:
      return `${head} a radar-response change in which ${hh}${hv ? ` and ${hv}` : ""} do not form a consistent pattern.`;
  }
}
