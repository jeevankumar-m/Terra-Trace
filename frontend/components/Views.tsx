"use client";

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HBars, Histogram, RainChart } from "./Charts";
import { MapSkeleton } from "./MapPanel";
import {
  API_BASE, COMPOSITE_KEY, LAYER_TITLE, PATTERNS, api, fmtDb, fmtHa, fmtUtc,
  type Analysis, type CandidateProps, type Flag, type Rainfall, type Story,
} from "@/lib/tt";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <MapSkeleton /> });
const noop = () => {};
const Card = ({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-[var(--radius-card)] border border-line bg-card p-5 ${className}`}>
    {title && <h2 className="label mb-3 uppercase">{title}</h2>}
    {children}
  </section>
);
const props = (c: FeatureCollection | null) => (c?.features ?? []).map((f) => f.properties as CandidateProps);
const dateLabel = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

function MapKey({ layer }: { layer: string }) {
  const k = COMPOSITE_KEY[layer];
  return (
    <div className="absolute bottom-10 left-3 max-w-[300px] rounded-xl border border-line bg-card/95 p-3 text-[12px] shadow-sm backdrop-blur-sm">
      <div className="mb-1.5 text-[13px] font-semibold">{LAYER_TITLE[layer]}</div>
      {k ? k.map((x) => (
        <div key={x.text} className="flex items-center gap-2 text-ink-2">
          <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: x.swatch }} />{x.text}
        </div>
      )) : <div className="text-ink-2">Radar backscatter, dB</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
export function StoryView({ analysis, candidates, story, rain, flags }: {
  analysis: Analysis; candidates: FeatureCollection | null; story: Story; rain: Rainfall | null; flags: Record<string, Flag>;
}) {
  const [i, setI] = useState(0);
  const n = story.chapters.length;
  const ch = story.chapters[i];
  const go = useCallback((d: number) => setI((v) => Math.min(n - 1, Math.max(0, v + d))), [n]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go]);
  const focus = useMemo(() => ({ bounds: ch.bounds, token: i }), [ch, i]);
  const cand = ch.candidate ? props(candidates).find((c) => c.candidate_id === ch.candidate) : null;
  const flag = ch.candidate ? flags[ch.candidate] : null;

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <article className="flex w-[440px] shrink-0 flex-col rounded-[var(--radius-card)] border border-line bg-card">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {i === 0 && story.title && (
            <div className="mb-5 border-b border-line pb-5">
              <h2 className="text-[24px] font-semibold leading-tight tracking-tight">{story.title}</h2>
              <p className="mt-1.5 text-[13px] text-ink-2">{story.subtitle}</p>
            </div>
          )}
          <div className="label uppercase">{ch.kicker}</div>
          <h3 className="mt-1 text-[22px] font-semibold leading-snug tracking-tight">{ch.title}</h3>
          {ch.body.map((p) => <p key={p.slice(0, 24)} className="mt-3 text-[14px] leading-relaxed text-ink-2">{p}</p>)}
          {ch.rain && rain && (
            <div className="mt-4 rounded-xl border border-line p-3">
              <div className="text-[13px] font-semibold">Rain between the passes: {rain.mean_mm_between_passes} mm on average</div>
              <div className="text-[12px] text-muted">Daily mean of {rain.towns.length} delta towns</div>
              <RainChart rain={rain} height={170} width={380} />
            </div>
          )}
          {cand && (
            <div className="tnum mt-4 grid grid-cols-3 gap-2 rounded-xl bg-canvas p-3 text-[13px]">
              <div><div className="text-muted">Region</div><div className="font-semibold">{cand.candidate_id}</div></div>
              <div><div className="text-muted">Area</div><div className="font-semibold">{fmtHa(cand.area_ha)} ha</div></div>
              <div><div className="text-muted">Pattern</div><div className="font-semibold">{PATTERNS[cand.pattern].short}</div></div>
            </div>
          )}
          {flag && <p className="mt-3 rounded-xl bg-warn-soft p-3 text-[13px] text-warn"><b>{flag.label}.</b> {flag.note}</p>}
          {ch.hypothesis && (
            <div className="mt-4 rounded-xl bg-accent-soft p-3.5">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-accent">Hypothesis</div>
              <p className="mt-1 text-[14px] leading-relaxed">{ch.hypothesis}</p>
            </div>
          )}
          {ch.caveat && (
            <div className="mt-3 rounded-xl border border-line p-3.5">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">What radar cannot tell us yet</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{ch.caveat}</p>
            </div>
          )}
        </div>
        <footer className="flex items-center gap-3 border-t border-line px-6 py-3">
          <button type="button" onClick={() => go(-1)} disabled={i === 0}
            className="h-9 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-canvas disabled:opacity-40">← Back</button>
          <div className="flex flex-1 justify-center gap-1.5">
            {story.chapters.map((c, j) => (
              <button key={c.id} type="button" aria-label={c.title} onClick={() => setI(j)}
                className={`h-2 rounded-full transition-all duration-200 ${j === i ? "w-6 bg-ink" : "w-2 bg-line-strong hover:bg-muted"}`} />
            ))}
          </div>
          <button type="button" onClick={() => go(1)} disabled={i === n - 1}
            className="h-9 rounded-lg bg-ink px-4 text-[13px] font-medium text-white hover:bg-accent disabled:opacity-40">Next →</button>
        </footer>
      </article>
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
        <MapView analysis={analysis} candidates={candidates} layer={ch.layer} opacity={0.85} showCandidates={!!ch.candidate}
          selectedId={null} onSelect={noop} fitToken={0} focus={focus} />
        <MapKey layer={ch.layer} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
const MODES = [
  { id: "rgb", label: "Colour", a: "rgb_a", b: "rgb_b" },
  { id: "hh", label: "HH", a: "a_hh_db", b: "b_hh_db" },
  { id: "hv", label: "HV", a: "a_hv_db", b: "b_hv_db" },
];

export function CompareView({ analysis, story }: { analysis: Analysis; story: Story | null }) {
  const [mode, setMode] = useState("rgb");
  const [pos, setPos] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [place, setPlace] = useState<{ bounds: [number, number, number, number]; token: number } | undefined>();
  const box = useRef<HTMLDivElement>(null);
  const maps = useRef<(maplibregl.Map | null)[]>([null, null]);
  const m = MODES.filter((x) => analysis.tiles[x.a] && analysis.tiles[x.b]).find((x) => x.id === mode) ?? MODES[1];
  useEffect(() => { maps.current = [null, null]; }, [m.id]);

  const link = useCallback((idx: number) => (map: maplibregl.Map) => {
    maps.current[idx] = map;
    const [a, b] = maps.current;
    if (!a || !b) return;
    let lock = false;
    const sync = (src: maplibregl.Map, dst: maplibregl.Map) => () => {
      if (lock) return;
      lock = true;
      dst.jumpTo({ center: src.getCenter(), zoom: src.getZoom() });
      lock = false;
    };
    a.on("move", sync(a, b));
    b.on("move", sync(b, a));
    b.jumpTo({ center: a.getCenter(), zoom: a.getZoom() });
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, t0 = 0;
    const step = (t: number) => {
      t0 ||= t;
      const p = Math.min(1, (t - t0) / 2600);
      setPos(100 - 100 * (0.5 - Math.cos(Math.PI * p) / 2));
      if (p < 1) raf = requestAnimationFrame(step); else setPlaying(false);
    };
    setPos(100);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const drag = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
  const places = [{ title: "Whole area", bounds: analysis.bounds_lonlat }, ...(story?.chapters ?? [])
    .filter((c) => c.id !== "delta" && c.id !== "why").map((c) => ({ title: c.title, bounds: c.bounds }))];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-card px-4 py-2.5">
        <div className="flex gap-0.5 rounded-lg bg-canvas p-0.5">
          {MODES.filter((x) => analysis.tiles[x.a] && analysis.tiles[x.b]).map((x) => (
            <button key={x.id} type="button" aria-pressed={mode === x.id} onClick={() => setMode(x.id)}
              className={`h-8 rounded-md px-3 text-[13px] font-medium ${mode === x.id ? "bg-card shadow-sm ring-1 ring-line" : "text-ink-2 hover:text-ink"}`}>{x.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {places.map((p, j) => (
            <button key={p.title} type="button" onClick={() => setPlace({ bounds: p.bounds, token: j + Date.now() })}
              className="h-8 rounded-full border border-line px-3 text-[12px] font-medium text-ink-2 hover:bg-canvas hover:text-ink">{p.title}</button>
          ))}
        </div>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 select-none overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
        <MapView key={`a-${m.a}`} analysis={analysis} candidates={null} layer={m.a} opacity={1} showCandidates={false}
          selectedId={null} onSelect={noop} fitToken={0} focus={place} onMap={link(0)} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          <MapView key={`b-${m.b}`} analysis={analysis} candidates={null} layer={m.b} opacity={1} showCandidates={false}
            selectedId={null} onSelect={noop} fitToken={0} focus={place} onMap={link(1)} />
        </div>
        <div className="absolute inset-y-0 z-10 w-0" style={{ left: `${pos}%` }}>
          <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_0_1px_rgb(20_33_61/0.4)]" />
          <button type="button" aria-label="Drag to compare dates" onPointerDown={(e) => (e.target as HTMLElement).setPointerCapture(e.pointerId)}
            onPointerMove={(e) => e.buttons && drag(e)}
            className="absolute top-1/2 -left-5 flex h-10 w-10 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-[15px] font-semibold text-ink shadow-lg ring-1 ring-line">⇆</button>
        </div>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-ink/85 px-3 py-1.5 text-[13px] font-semibold text-white">Before · {dateLabel(analysis.scene_a.start_utc)}</div>
        <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-ink/85 px-3 py-1.5 text-[13px] font-semibold text-white">After · {dateLabel(analysis.scene_b?.start_utc)}</div>
        <MapKey layer={m.b} />
        <div className="absolute bottom-10 right-14 flex items-center gap-3 rounded-xl border border-line bg-card/95 px-3 py-2 shadow-sm">
          <button type="button" onClick={() => setPlaying(true)} disabled={playing}
            className="h-8 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-accent disabled:opacity-50">▶ Play</button>
          <div className="tnum flex items-center gap-2 text-[12px]">
            <button type="button" onClick={() => setPos(100)} className="font-semibold hover:underline">{dateLabel(analysis.scene_a.start_utc)}</button>
            <input type="range" min={0} max={100} value={100 - pos} onChange={(e) => setPos(100 - +e.target.value)}
              aria-label="Timeline" className="w-40 accent-[var(--color-accent)]" />
            <button type="button" onClick={() => setPos(0)} className="font-semibold hover:underline">{dateLabel(analysis.scene_b?.start_utc)}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
function Kpi({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="tnum text-[28px] font-semibold leading-none tracking-tight">{value}{unit && <span className="ml-1 text-[14px] font-medium text-muted">{unit}</span>}</div>
      <div className="mt-1.5 text-[12px] text-ink-2">{label}</div>
    </div>
  );
}

type Hist = { edges: number[]; counts: number[]; median: number | null };

export function InsightsView({ analysis, candidates, rain, flags, onOpen }: {
  analysis: Analysis; candidates: FeatureCollection | null; rain: Rainfall | null; flags: Record<string, Flag>; onOpen: (id: string) => void;
}) {
  const [hist, setHist] = useState<Record<string, Hist>>({});
  useEffect(() => {
    for (const k of ["delta_hh_db", "delta_hv_db"]) if (analysis.layers[k])
      api<Hist>(`/api/analyses/${encodeURIComponent(analysis.analysis_id)}/histogram/${k}`).then((h) => setHist((s) => ({ ...s, [k]: h }))).catch(noop);
  }, [analysis]);
  const all = props(candidates);
  const real = all.filter((c) => !flags[c.candidate_id]);
  const flagged = all.filter((c) => flags[c.candidate_id]);
  const sum = (xs: CandidateProps[]) => xs.reduce((s, c) => s + c.area_ha, 0);
  const groups = new Map<string, { label: string; value: number; color: string; dashed?: boolean }>();
  for (const c of real) {
    const dir = c.direction === "decrease" ? "darker" : c.direction === "increase" ? "brighter" : "mixed";
    const key = `${c.pattern}-${dir}`;
    const g = groups.get(key) ?? { label: `${PATTERNS[c.pattern].short}${dir === "mixed" ? "" : `, ${dir}`}`, value: 0, color: PATTERNS[c.pattern].color };
    g.value += c.area_ha;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.value - a.value);
  if (flagged.length) rows.push({ label: "Flagged artifact (RFI)", value: sum(flagged), color: "#8a8984", dashed: true });
  const thr = (k: string) => {
    const b = analysis.background[k];
    const w = analysis.threshold.k * (b?.mad ?? 0) / 0.6745;
    return [(b?.median ?? 0) - w, (b?.median ?? 0) + w];
  };
  const top = [...real].sort((a, b) => b.area_ha - a.area_ha).slice(0, 8);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi value={(analysis.summary.analysed_area_ha / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} unit="km²" label="Analysed, valid in both passes" />
        <Kpi value={String(real.length)} label="Change regions (artifacts excluded)" />
        <Kpi value={fmtHa(sum(real.filter((c) => c.direction === "decrease")))} unit="ha" label="Got darker (HH/HV fell)" />
        <Kpi value={fmtHa(sum(real.filter((c) => c.direction === "increase")))} unit="ha" label="Got brighter" />
        <Kpi value={fmtHa(sum(flagged))} unit="ha" label={`Flagged as artifacts (${flagged.length} regions)`} />
        <Kpi value={rain ? String(rain.mean_mm_between_passes) : "—"} unit="mm" label="Mean rain between passes" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rain && (
          <Card title="Rainfall around the two passes">
            <RainChart rain={rain} />
            <p className="mt-2 text-[12px] text-muted">Daily mean of {rain.towns.length} towns inside the study area. Shaded: the 12 days between the radar passes. {rain.source}.</p>
          </Card>
        )}
        <Card title="Changed area by response type">
          <HBars rows={rows} unit="ha" />
          <p className="mt-3 text-[12px] text-muted">Darker usually means smoother or wetter-and-flooded surfaces; brighter means rougher, wetter soil or more vegetation volume. These are hypotheses, not causes.</p>
        </Card>
        {rain && (
          <Card title="Rain between the passes, by town">
            <HBars rows={[...rain.towns].sort((a, b) => b.mm_between_passes - a.mm_between_passes)
              .map((t) => ({ label: t.name, value: t.mm_between_passes, color: "#1f4e79" }))} unit="mm" />
          </Card>
        )}
        <Card title="How much did each pixel change?">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(["delta_hh_db", "delta_hv_db"] as const).filter((k) => hist[k]).map((k) => {
              const [lo, hi] = thr(k);
              return (
                <div key={k}>
                  <div className="text-[13px] font-semibold">{k === "delta_hh_db" ? "ΔHH" : "ΔHV"} (dB)</div>
                  <Histogram edges={hist[k].edges} counts={hist[k].counts} lo={lo} hi={hi} label={k} />
                  <div className="tnum text-[12px] text-muted">Dashed: robust threshold {fmtDb(lo)} / {fmtDb(hi)}</div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-muted">Grey bars sit inside the normal range. Blue and red tails are pixels that changed beyond the robust threshold.</p>
        </Card>
        <Card title="Largest change regions" className="xl:col-span-2">
          <table className="tnum w-full text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-medium">Region</th><th className="pb-2 font-medium">Type</th><th className="pb-2 text-right font-medium">Area</th>
              <th className="pb-2 text-right font-medium">Direction</th><th className="pb-2 pl-6 font-medium">Evidence</th><th />
            </tr></thead>
            <tbody>
              {top.map((c) => (
                <tr key={c.candidate_id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => onOpen(c.candidate_id)}>
                  <td className="py-2 font-semibold">{c.candidate_id}</td>
                  <td className="py-2"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PATTERNS[c.pattern].color }} />{PATTERNS[c.pattern].short}</td>
                  <td className="py-2 text-right">{fmtHa(c.area_ha)} ha</td>
                  <td className="py-2 text-right">{c.direction === "decrease" ? "Darker" : c.direction === "increase" ? "Brighter" : "Mixed"}</td>
                  <td className="py-2 pl-6">{c.evidence_level.charAt(0) + c.evidence_level.slice(1).toLowerCase()}</td>
                  <td className="py-2 text-right text-accent">Open on map →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
export function MethodView({ analysis: a, rain, flags }: { analysis: Analysis; rain: Rainfall | null; flags: Record<string, Flag> }) {
  const checks = a.pair_qa?.checks ?? [];
  const pass = checks.filter((c) => c.status === "pass").length;
  const px = Math.sqrt(Math.abs((a.preprocessing as unknown as { pixel_area_m2: number }).pixel_area_m2 ?? 0));
  const bg = a.background;
  const steps = [
    { n: "01", t: "Two NISAR passes", d: `S-band L2-GCOV, track ${a.scene_a.relative_track}, frame ${a.scene_a.frame}, ${a.scene_a.orbit_direction === "A" ? "ascending" : "descending"}, dual-pol HH/HV. ${fmtUtc(a.scene_a.start_utc)} and ${fmtUtc(a.scene_b?.start_utc)}.` },
    { n: "02", t: "Pair QA gate", d: `${pass} of ${checks.length} checks passed (same band, track, frame, direction, mode, polarization, CRS, coverage). A failed pair is never compared.` },
    { n: "03", t: "Align, mask, multilook", d: `One reference grid, ${px ? `${px.toFixed(0)} m pixels, ` : ""}${a.threshold.multilook ?? "no multilook"}. ${(a.summary.common_valid_pixel_fraction * 100).toFixed(1)}% of the study area valid in both passes.` },
    { n: "04", t: "Measure change", d: `dB = 10·log10(power). ΔHH and ΔHV per pixel. Robust z = 0.6745·(Δ − median)/MAD; background ΔHH ${fmtDb(bg.delta_hh_db?.median)} ± ${fmtDb(bg.delta_hh_db?.mad, false)}.` },
    { n: "05", t: "Regions and evidence", d: `|z| ≥ ${a.threshold.k} on ΔHH or ΔHV, regions ≥ ${a.threshold.mmu_ha} ha. Each region gets a pattern, an evidence level with reasons, and its limits.${Object.keys(flags).length ? ` ${Object.keys(flags).length} regions flagged as artifacts after review.` : ""}` },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Card title="How TerraTrace turns two radar passes into evidence">
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {steps.map((s) => (
            <li key={s.n} className="rounded-xl bg-canvas p-4">
              <div className="tnum text-[13px] font-semibold text-accent">{s.n}</div>
              <div className="mt-1 text-[15px] font-semibold">{s.t}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>
      </Card>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Why radar sees change: roughness and moisture">
          <dl className="space-y-3 text-[13px] leading-relaxed">
            {[
              ["HH (same polarisation)", "Strong from rough ground and from buildings, where walls and ground make corner reflectors. Falls sharply when a surface turns smooth, like calm standing water."],
              ["HV (cross polarisation)", "Created when the wave scatters around inside a canopy, so it tracks vegetation volume: crops, mangroves, trees."],
              ["Darker between dates", "Smoother surface: flooding, ponding, a calm water sheet. It can also come from harvest (less canopy) or a change in tillage."],
              ["Brighter between dates", "Wetter soil (water raises the dielectric constant), rougher ground, or growing vegetation."],
              ["Why S-band and cloud", "At about 9.4 cm wavelength the radar passes through monsoon cloud and works at night. Optical satellites see nothing on these days."],
            ].map(([k, v]) => (
              <div key={k}><dt className="font-semibold">{k}</dt><dd className="text-ink-2">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Data sources">
          <ul className="space-y-3 text-[13px] leading-relaxed">
            <li><b>NISAR S-band L2-GCOV</b> (ISRO/NRSC via Bhoonidhi, open data)
              <div className="break-all font-mono text-[11px] text-muted">{a.scene_a.scene_id}<br />{a.scene_b?.scene_id}</div></li>
            {rain && <li><b>Rainfall</b>: {rain.source}, daily totals at {rain.towns.length} towns.</li>}
            <li><b>Basemap</b>: Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0); labels © OpenStreetMap contributors.</li>
            <li><b>Method</b> <span className="font-mono text-[12px]">{a.method}</span>, code {a.provenance.code_version}, run {fmtUtc(a.provenance.created_utc)}.</li>
            <li><a className="font-medium text-accent hover:underline" href={`${API_BASE}/api/analyses/${encodeURIComponent(a.analysis_id)}/export/report.html`} target="_blank" rel="noreferrer">Open the full evidence report →</a></li>
          </ul>
        </Card>
        <Card title="What this does not prove" className="xl:col-span-2">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] leading-relaxed text-ink-2 md:grid-cols-2">
            <li>• A change region is a radar-response candidate. Its cause is a hypothesis until an independent source confirms it.</li>
            <li>• Two dates show a difference, not a trend. More passes (every 12 days) would separate flooding from crop stage.</li>
            <li>• Tide and wind change how water and wet mud scatter; open sea is excluded for this reason.</li>
            <li>• Residual radio interference and banding exist in this product baseline; suspicious regions are flagged, not hidden.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
