"use client";

import type { FeatureCollection } from "geojson";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  COMPOSITE_KEY, LAYERS, LAYER_TITLE, PATTERNS, fmtDb, layerBlockedReason, type Analysis, type CandidateProps, type Pattern,
} from "@/lib/tt";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <MapSkeleton /> });

// rio-tiler colormaps used server-side: greys_r (low = dark) and rdbu_r (low = blue, high = red).
const GREYS = "linear-gradient(90deg,#000,#fff)";
const RDBU_R = "linear-gradient(90deg,#053061,#2166ac,#4393c3,#92c5de,#d1e5f0,#f7f7f7,#fddbc7,#f4a582,#d6604d,#b2182b,#67001f)";

export function MapSkeleton() {
  return <div className="absolute inset-0 animate-pulse bg-[#eceef2]" />;
}

interface Props {
  analysis: Analysis;
  candidates: FeatureCollection | null;
  layer: string;
  setLayer: (k: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function MapPanel({ analysis, candidates, layer, setLayer, selectedId, onSelect }: Props) {
  const [opacity, setOpacity] = useState(0.9);
  const [showCandidates, setShowCandidates] = useState(true);
  const [fitToken, setFitToken] = useState(0);
  const nCand = candidates?.features.length ?? 0;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
      <MapView analysis={analysis} candidates={candidates} layer={layer} opacity={opacity}
        showCandidates={showCandidates} selectedId={selectedId} onSelect={onSelect} fitToken={fitToken} />

      <div className="pointer-events-none absolute left-3 top-3 flex w-[300px] flex-col gap-2">
        <div className="pointer-events-auto rounded-xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
          <div className="label mb-2">Layer</div>
          {(["Colour", "HH", "HV", "Other"] as const).map((g) => (
            <div key={g} className="mb-1.5 flex items-center gap-2 last:mb-0">
              <span className="w-11 shrink-0 text-[12px] font-medium text-muted">{g === "Other" ? "" : g}</span>
              <div className="grid flex-1 grid-cols-3 gap-0.5 rounded-lg bg-canvas p-0.5"
                style={{ gridTemplateColumns: g === "Other" ? "1fr 1fr" : undefined }}>
                {LAYERS.filter((l) => l.group === g).map((l) => {
                  const blocked = layerBlockedReason(analysis, l.key);
                  const active = layer === l.key;
                  return (
                    <button key={l.key} type="button" disabled={!!blocked} aria-pressed={active}
                      title={blocked ?? LAYER_TITLE[l.key]} onClick={() => setLayer(l.key)}
                      className={`h-7 rounded-md px-1.5 text-[12px] font-medium transition-colors duration-150
                        ${active ? "bg-card text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:text-ink"}
                        disabled:cursor-not-allowed disabled:text-ink-2/35 disabled:line-through`}>
                      {l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-ink-2">
              <input type="checkbox" checked={showCandidates} onChange={(e) => setShowCandidates(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
              Candidates <span className="tnum text-muted">({nCand})</span>
            </label>
            <label className="ml-auto flex items-center gap-2 text-[12px] font-medium text-ink-2" title="Raster opacity">
              Opacity
              <input type="range" min={0} max={1} step={0.05} value={opacity}
                onChange={(e) => setOpacity(+e.target.value)} className="w-16 accent-[var(--color-accent)]" />
            </label>
          </div>
        </div>
      </div>

      <button type="button" onClick={() => setFitToken((t) => t + 1)}
        className="absolute right-3 top-3 h-8 rounded-lg border border-line bg-card px-3 text-[12px] font-medium text-ink shadow-sm hover:bg-canvas">
        Zoom to AOI
      </button>

      <Legend analysis={analysis} layer={layer} candidates={candidates} showCandidates={showCandidates} />
    </div>
  );
}

function Legend({ analysis, layer, candidates, showCandidates }: {
  analysis: Analysis; layer: string; candidates: FeatureCollection | null; showCandidates: boolean;
}) {
  const lg = analysis.legend[layer];
  const isDelta = layer.startsWith("delta");
  const patterns = [...new Set((candidates?.features ?? []).map((f) => (f.properties as CandidateProps).pattern))] as Pattern[];
  return (
    <div className="absolute bottom-10 left-3 w-[300px] rounded-xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
      <div className="text-[13px] font-semibold">{LAYER_TITLE[layer]}</div>
      {COMPOSITE_KEY[layer] && (
        <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
          {COMPOSITE_KEY[layer].map((k) => (
            <li key={k.text} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: k.swatch }} />{k.text}
            </li>
          ))}
        </ul>
      )}
      {lg && layer !== "valid_mask" && (
        <>
          <div className="mt-2 h-2.5 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: isDelta ? RDBU_R : GREYS }} />
          <div className="tnum mt-1 flex justify-between text-[12px] text-ink-2">
            <span>{fmtDb(lg.min, isDelta)}</span>
            {isDelta && <span>0 dB</span>}
            <span>{fmtDb(lg.max, isDelta)}</span>
          </div>
          {isDelta ? (
            <div className="mt-0.5 flex justify-between text-[12px] text-muted">
              <span>weaker on Date B</span><span>stronger on Date B</span>
            </div>
          ) : null}
          <div className="mt-1.5 text-[12px] text-muted">
            {isDelta ? `Date B − Date A, symmetric and clipped at ±${lg.max} dB`
              : `Shared stretch for Date A and Date B (2nd–98th percentile). ${analysis.preprocessing.radiometric_convention.split(" ")[0]} power in dB.`}
          </div>
        </>
      )}
      {layer === "valid_mask" && (
        <div className="mt-2 space-y-1 text-[12px] text-ink-2">
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: "rgb(99 107 121 / .6)" }} />
            Excluded inside AOI: fill, invalid mask code, non-finite or ≤ 0 power</div>
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm ring-1 ring-inset ring-line-strong" />
            Analysed (valid in both scenes)</div>
        </div>
      )}
      {showCandidates && patterns.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2">
          {patterns.map((pt) => (
            <span key={pt} className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-[#14213d]/50" style={{ background: PATTERNS[pt].color }} />
              {PATTERNS[pt].short}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
