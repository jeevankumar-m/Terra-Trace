"use client";

import type { FeatureCollection, Geometry } from "geojson";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { API_BASE, PATTERNS, fmtHa, type Analysis, type CandidateProps } from "@/lib/tt";

// Floating cards cover the left edge of the map; keep the AOI and candidates clear of them.
const PAD = { top: 32, bottom: 32, left: 336, right: 32 };
const SEL_PAD = { top: 80, bottom: 80, left: 360, right: 80 };

// OpenFreeMap Positron (MIT styles, OpenMapTiles + OpenStreetMap data; attribution shipped in the style).
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const BLANK: StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef0f3" } }],
};

const patternColor: maplibregl.ExpressionSpecification = [
  "match", ["get", "pattern"],
  ...Object.entries(PATTERNS).flatMap(([k, v]) => [k, v.color]),
  "#8a8984",
] as unknown as maplibregl.ExpressionSpecification;

async function loadStyle(): Promise<StyleSpecification | string> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(BASEMAP, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return BASEMAP;
  } catch {}
  return BLANK; // offline venue: NISAR layers still render on a neutral background
}

export interface MapViewProps {
  analysis: Analysis;
  candidates: FeatureCollection | null;
  layer: string;
  opacity: number;
  showCandidates: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  fitToken: number;
}

export default function MapView(p: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelect = useRef(p.onSelect);
  useEffect(() => { onSelect.current = p.onSelect; });
  const [ready, setReady] = useState(false);
  const { analysis } = p;

  useEffect(() => {
    let map: maplibregl.Map | null = null;
    let cancelled = false;
    loadStyle().then((style) => {
      if (cancelled || !el.current) return;
      map = new maplibregl.Map({
        container: el.current, style, bounds: analysis.bounds_lonlat,
        fitBoundsOptions: { padding: PAD }, attributionControl: { compact: true }, dragRotate: false,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");
      map.on("load", () => {
        const m = map!;
        const beforeSymbols = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
        for (const [k, url] of Object.entries(analysis.tiles)) {
          m.addSource(`r-${k}`, { type: "raster", tiles: [API_BASE + url], tileSize: 256,
            bounds: analysis.bounds_lonlat, maxzoom: 15 });
          m.addLayer({ id: `r-${k}`, type: "raster", source: `r-${k}`, layout: { visibility: "none" },
            paint: { "raster-resampling": "nearest", "raster-fade-duration": 0 } }, beforeSymbols);
        }
        m.addSource("aoi", { type: "geojson", data: { type: "Feature", geometry: analysis.aoi, properties: {} } });
        m.addLayer({ id: "aoi-casing", type: "line", source: "aoi", paint: { "line-color": "#ffffff", "line-width": 3.5, "line-opacity": 0.9 } });
        m.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#14213d", "line-width": 1.5, "line-dasharray": [3, 2] } });

        m.addSource("cand", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "candidate_id" });
        const sel = ["boolean", ["feature-state", "selected"], false];
        const hov = ["boolean", ["feature-state", "hover"], false];
        m.addLayer({ id: "cand-fill", type: "fill", source: "cand", paint: {
          "fill-color": patternColor,
          "fill-opacity": ["case", sel, 0.22, hov, 0.2, 0.1] as unknown as number } });
        m.addLayer({ id: "cand-casing", type: "line", source: "cand", paint: {
          "line-color": "#14213d", "line-opacity": 0.55,
          "line-width": ["case", sel, 5, 2.75] as unknown as number } });
        m.addLayer({ id: "cand-line", type: "line", source: "cand",
          filter: ["!=", ["get", "pattern"], "AMBIGUOUS_MIXED"], paint: {
          "line-color": patternColor, "line-width": ["case", sel, 3, 1.5] as unknown as number } });
        m.addLayer({ id: "cand-line-amb", type: "line", source: "cand",
          filter: ["==", ["get", "pattern"], "AMBIGUOUS_MIXED"], paint: {
          "line-color": "#f2f2f0", "line-width": ["case", sel, 3, 1.5] as unknown as number, "line-dasharray": [2, 1.5] } });

        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        let hovered: string | null = null;
        const setHover = (id: string | null) => {
          if (hovered) m.setFeatureState({ source: "cand", id: hovered }, { hover: false });
          hovered = id;
          if (id) m.setFeatureState({ source: "cand", id }, { hover: true });
        };
        m.on("mousemove", "cand-fill", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const pr = f.properties as CandidateProps;
          m.getCanvas().style.cursor = "pointer";
          setHover(pr.candidate_id);
          popup.setLngLat(e.lngLat).setHTML(
            `<b>${pr.candidate_id}</b> · <span class="tnum">${fmtHa(pr.area_ha)} ha</span>`).addTo(m);
        });
        m.on("mouseleave", "cand-fill", () => {
          m.getCanvas().style.cursor = "";
          setHover(null);
          popup.remove();
        });
        m.on("click", (e) => {
          const f = m.queryRenderedFeatures(e.point, { layers: ["cand-fill"] })[0];
          onSelect.current(f ? (f.properties as CandidateProps).candidate_id : null);
        });
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      setReady(false);
      map?.remove();
      mapRef.current = null;
    };
  }, [analysis]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    for (const k of Object.keys(analysis.tiles))
      m.setLayoutProperty(`r-${k}`, "visibility", k === p.layer ? "visible" : "none");
  }, [ready, p.layer, analysis]);

  useEffect(() => {
    const m = mapRef.current;
    if (ready && m?.getLayer(`r-${p.layer}`)) m.setPaintProperty(`r-${p.layer}`, "raster-opacity", p.opacity);
  }, [ready, p.layer, p.opacity]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource("cand") as maplibregl.GeoJSONSource).setData(
      p.candidates ?? { type: "FeatureCollection", features: [] });
  }, [ready, p.candidates]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    for (const id of ["cand-fill", "cand-casing", "cand-line", "cand-line-amb"])
      m.setLayoutProperty(id, "visibility", p.showCandidates ? "visible" : "none");
  }, [ready, p.showCandidates]);

  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    if (prevSel.current) m.setFeatureState({ source: "cand", id: prevSel.current }, { selected: false });
    prevSel.current = p.selectedId;
    if (!p.selectedId) return;
    m.setFeatureState({ source: "cand", id: p.selectedId }, { selected: true });
    const f = p.candidates?.features.find((x) => x.properties?.candidate_id === p.selectedId);
    if (f) {
      const b = bbox(f.geometry);
      m.fitBounds(b, { padding: SEL_PAD, maxZoom: 15, duration: 600 });
    }
  }, [ready, p.selectedId, p.candidates]);

  useEffect(() => {
    if (p.fitToken && mapRef.current) mapRef.current.fitBounds(analysis.bounds_lonlat, { padding: PAD, duration: 500 });
  }, [p.fitToken, analysis]);

  // maplibre-gl.css sets .maplibregl-map{position:relative}, so the container needs its own sized wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" aria-label="Comparison map" />
    </div>
  );
}

function bbox(g: Geometry): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90];
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    } else (c as unknown[]).forEach(walk);
  };
  if ("coordinates" in g) walk(g.coordinates);
  return b;
}
