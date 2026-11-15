"use client";

import type { FeatureCollection } from "geojson";
import { useCallback, useEffect, useState } from "react";
import Inspector, { StatusIcon } from "./Inspector";
import MapPanel, { MapSkeleton } from "./MapPanel";
import {
  API_BASE, ApiError, api, fmtUtc, type Analysis, type AnalysisListItem, type Scene,
} from "@/lib/tt";

type Load =
  | { kind: "loading" }
  | { kind: "api_down" }
  | { kind: "no_analysis" }
  | { kind: "error"; msg: string }
  | { kind: "ready"; list: AnalysisListItem[]; analysis: Analysis; candidates: FeatureCollection };

async function fetchState(wanted?: string): Promise<Load> {
  try {
    const list = await api<{ default_analysis_id: string | null; analyses: AnalysisListItem[] }>("/api/analyses");
    const id = wanted ?? new URLSearchParams(location.search).get("analysis") ?? list.default_analysis_id;
    if (!id) return { kind: "no_analysis" };
    const [analysis, candidates] = await Promise.all([
      api<Analysis>(`/api/analyses/${encodeURIComponent(id)}`),
      api<FeatureCollection>(`/api/analyses/${encodeURIComponent(id)}/candidates`),
    ]);
    return { kind: "ready", list: list.analyses, analysis, candidates };
  } catch (e) {
    if (e instanceof ApiError) return e.status === 404 ? { kind: "no_analysis" } : { kind: "error", msg: e.message };
    return { kind: "api_down" };
  }
}

export default function Workspace() {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [layer, setLayer] = useState("a_hh_db");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qaOpen, setQaOpen] = useState(false);

  const apply = useCallback((s: Load) => {
    if (s.kind === "ready") setLayer(s.analysis.layers.delta_hh_db ? "delta_hh_db" : "a_hh_db");
    setState(s);
  }, []);
  const load = useCallback((wanted?: string) => {
    setState({ kind: "loading" });
    setSelectedId(null);
    fetchState(wanted).then(apply);
  }, [apply]);

  useEffect(() => {
    let live = true;
    fetchState().then((s) => live && apply(s));
    return () => { live = false; };
  }, [apply]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (qaOpen) setQaOpen(false); else setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qaOpen]);

  const switchAnalysis = (id: string) => {
    history.replaceState(null, "", `?analysis=${encodeURIComponent(id)}`);
    load(id);
  };

  const a = state.kind === "ready" ? state.analysis : null;
  return (
    <div className="flex h-full flex-col">
      {a?.synthetic && (
        <div role="alert" className="flex h-9 shrink-0 items-center justify-center gap-3 bg-fail text-[13px] font-semibold tracking-wide text-white">
          {a.data_label ?? "SYNTHETIC DEV DATA — not NISAR observations"}
          <span className="font-normal opacity-85">Generated test grid. Never use in the demo.</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3 pl-0">
          {state.kind === "ready" ? (
            <>
              <TopBar analysis={state.analysis} list={state.list} onSwitch={switchAnalysis} onOpenQa={() => setQaOpen(true)} />
              <StatusBanner analysis={state.analysis} />
              <div className="flex min-h-0 flex-1 gap-3">
                <div className="min-w-0 flex-1">
                  <MapPanel analysis={state.analysis} candidates={state.candidates} layer={layer} setLayer={setLayer}
                    selectedId={selectedId} onSelect={setSelectedId} />
                </div>
                <Inspector analysis={state.analysis} candidates={state.candidates} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
              {qaOpen && <QaDrawer analysis={state.analysis} onClose={() => setQaOpen(false)} />}
            </>
          ) : state.kind === "loading" ? (
            <LoadingShell />
          ) : (
            <EmptyState state={state} onRetry={() => load()} />
          )}
        </main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="8" fill="#14213d" />
      <path d="M5 17c3-5 6-5 9 0s6 5 9 0" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M5 12c3-5 6-5 9 0s6 5 9 0" stroke="#8fb3d9" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Sidebar() {
  const nav = [
    { label: "Workspace", active: true, hint: "" },
  ];
  return (
    <nav className="flex w-[208px] shrink-0 flex-col px-3 py-4" aria-label="Main">
      <div className="flex items-center gap-2.5 px-2">
        <Logo />
        <span className="text-[17px] font-semibold tracking-tight">TerraTrace</span>
      </div>
      <p className="mt-2 px-2 text-[12px] leading-snug text-muted">
        A platform for tracing and understanding changes across Earth&apos;s surface.
      </p>
      <ul className="mt-6 space-y-0.5">
        {nav.map((n) => (
          <li key={n.label}>
            <span aria-current={n.active ? "page" : undefined} aria-disabled={!n.active}
              className={`flex h-9 items-center justify-between rounded-lg px-2.5 text-[13px] font-medium
                ${n.active ? "bg-card text-ink shadow-sm ring-1 ring-line" : "cursor-not-allowed text-ink-2/60"}`}>
              {n.label}{n.hint && <span className="text-[11px] font-normal">{n.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto px-2 text-[12px] leading-relaxed text-muted">
        NISAR S-band L2-GCOV<br />Team Dhruva · NASA Space Apps 2026<br />Dancing with the SARs
      </div>
    </nav>
  );
}

function TopBar({ analysis: a, list, onSwitch, onOpenQa }: {
  analysis: Analysis; list: AnalysisListItem[]; onSwitch: (id: string) => void; onOpenQa: () => void;
}) {
  const qa = a.pair_qa;
  const badge = !qa
    ? { cls: "bg-canvas text-ink-2 ring-line", text: "Single scene: no pair QA" }
    : qa.passed
      ? { cls: "bg-pass-soft text-pass ring-pass/20", text: "Pair passed QA" }
      : { cls: "bg-fail-soft text-fail ring-fail/20", text: `Pair failed QA: ${qa.failed_reasons[0]}` };
  const tag = (x: AnalysisListItem) => x.synthetic ? " · SYNTHETIC" : x.exploratory ? " · exploratory" : x.status === "qa_failed" ? " · QA failed" : "";
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-6 rounded-[var(--radius-card)] border border-line bg-card px-5 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-[20px] font-semibold tracking-tight">{a.area_name}</h1>
        <label className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
          Analysis
          <select value={a.analysis_id} onChange={(e) => onSwitch(e.target.value)}
            className="max-w-[260px] truncate rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[12px] text-ink">
            {list.map((x) => <option key={x.analysis_id} value={x.analysis_id}>{x.analysis_id}{tag(x)}</option>)}
          </select>
        </label>
      </div>
      <div className="tnum flex shrink-0 items-center gap-3 text-[13px]">
        <DateCell label="Date A" iso={a.scene_a.start_utc} />
        <span className="text-muted" aria-hidden>→</span>
        <DateCell label="Date B" iso={a.scene_b?.start_utc} />
      </div>
      <button type="button" onClick={onOpenQa} title="Open scenes and the full pair QA checklist"
        className={`ml-auto max-w-[420px] truncate rounded-full px-3 py-1.5 text-[13px] font-semibold ring-1 ring-inset hover:brightness-95 ${badge.cls}`}>
        {qa?.passed ? "✓ " : qa ? "✕ " : ""}{badge.text}
      </button>
    </header>
  );
}

function DateCell({ label, iso }: { label: string; iso?: string | null }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="font-semibold">{fmtUtc(iso)}</div>
    </div>
  );
}

function StatusBanner({ analysis: a }: { analysis: Analysis }) {
  const reasons = a.pair_qa?.failed_reasons.join("; ");
  const msg =
    a.status === "qa_failed" ? { cls: "bg-fail-soft text-fail", t: `Pair failed QA. Delta layers and change candidates are blocked: ${reasons}.` }
    : a.status === "exploratory" ? { cls: "bg-warn-soft text-warn", t: `EXPLORATORY: pair failed QA (${reasons}). Shown only for inspection; every candidate is Low evidence and this is not a valid temporal comparison.` }
    : a.fallback_level === "B" ? { cls: "bg-accent-soft text-accent", t: "Single-polarization comparison (fallback level B). HV layers and HV claims are removed." }
    : a.fallback_level === "C" ? { cls: "bg-accent-soft text-accent", t: "Single scene (fallback level C). No temporal change claim is made." }
    : null;
  const levelB = a.status === "exploratory" && a.fallback_level === "B" ? " Single-polarization (HH only)." : "";
  return msg ? <div role="status" className={`shrink-0 rounded-xl px-4 py-2.5 text-[13px] font-medium ${msg.cls}`}>{msg.t}{levelB}</div> : null;
}

function QaDrawer({ analysis: a, onClose }: { analysis: Analysis; onClose: () => void }) {
  const rows: [string, (s: Scene) => string][] = [
    ["Scene ID", (s) => s.scene_id], ["Acquired (start)", (s) => fmtUtc(s.start_utc)],
    ["Band / product", (s) => `${s.band ?? "?"} · ${s.product_type ?? "?"}`],
    ["Orbit direction", (s) => (s.orbit_direction === "A" ? "Ascending" : s.orbit_direction === "D" ? "Descending" : s.orbit_direction)],
    ["Relative track / frame", (s) => `${s.relative_track ?? "?"} / ${s.frame ?? "?"}`],
    ["Bandwidth mode", (s) => s.bandwidth_mode ?? "—"], ["Polarization", (s) => s.polarization_code ?? "—"],
    ["Channels", (s) => [s.has_hh && "HHHH", s.has_hv && "HVHV"].filter(Boolean).join(", ")],
    ["CRID", (s) => s.crid ?? "—"], ["CRS / spacing", (s) => `EPSG:${s.crs_epsg} · ${s.pixel_spacing_m.join(" × ")} m`],
    ["Convention", (s) => s.backscatter_convention ?? "—"],
  ];
  const scenes = [a.scene_a, a.scene_b].filter(Boolean) as Scene[];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <div role="dialog" aria-label="Scenes and pair QA" onClick={(e) => e.stopPropagation()}
        className="h-full w-[640px] max-w-full overflow-y-auto bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold">Scenes and pair QA</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[13px] text-ink-2 hover:bg-canvas">Close ✕</button>
        </div>
        <table className="tnum mt-4 w-full text-[12px]">
          <thead><tr className="text-left text-muted"><th className="w-40 pb-1.5 font-medium" />{scenes.map((_, i) => <th key={i} className="pb-1.5 font-medium">Scene {i ? "B" : "A"}</th>)}</tr></thead>
          <tbody>
            {rows.map(([l, f]) => (
              <tr key={l} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 text-muted">{l}</td>
                {scenes.map((s, i) => <td key={i} className={`py-1.5 pr-3 ${l === "Scene ID" ? "break-all font-mono text-[11px]" : ""}`}>{f(s)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {scenes.some((s) => s.warnings.length) && (
          <ul className="mt-3 space-y-1">
            {scenes.flatMap((s, i) => s.warnings.map((w) => (
              <li key={i + w} className="flex gap-2 text-[12px] text-warn"><StatusIcon s="warn" />Scene {i ? "B" : "A"}: {w}</li>)))}
          </ul>
        )}
        <h3 className="label mb-2 mt-6 uppercase">Pair checklist</h3>
        {a.pair_qa ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {a.pair_qa.checks.map((c) => (
              <li key={c.name} className="flex gap-3 px-3 py-2.5 text-[13px]">
                <StatusIcon s={c.status} />
                <div className="min-w-0 flex-1">
                  <div>{c.reason}</div>
                  <div className="tnum mt-0.5 break-all font-mono text-[11px] text-muted">{c.name}: A = {JSON.stringify(c.value_a)} · B = {JSON.stringify(c.value_b)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-ink-2">Single-scene analysis: no pair to validate.</p>}
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <>
      <div className="h-16 shrink-0 animate-pulse rounded-[var(--radius-card)] bg-card" />
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative flex-1 overflow-hidden rounded-[var(--radius-card)]"><MapSkeleton /></div>
        <div className="w-[380px] animate-pulse rounded-[var(--radius-card)] bg-card" />
      </div>
    </>
  );
}

function EmptyState({ state, onRetry }: { state: Exclude<Load, { kind: "ready" | "loading" }>; onRetry: () => void }) {
  const body =
    state.kind === "api_down" ? {
      t: "Can't reach the TerraTrace API", d: `Nothing answered at ${API_BASE}. Start the API in another terminal:`,
      cmd: "make api        # Windows: powershell -File tasks.ps1 api",
    } : state.kind === "no_analysis" ? {
      t: "No analysis yet", d: "The API is running but no analysis folder exists in data/derived/. Run one:",
      cmd: "make analysis SCENE_A=data/raw/<area>/A.h5 SCENE_B=data/raw/<area>/B.h5 AOI=data/aoi/<area>.geojson ID=<id>\n# synthetic dev data only:  make synthetic",
    } : { t: "Something went wrong", d: state.msg, cmd: "" };
  return (
    <div className="flex flex-1 items-center justify-center rounded-[var(--radius-card)] border border-line bg-card">
      <div className="max-w-xl p-8">
        <h2 className="text-[20px] font-semibold">{body.t}</h2>
        <p className="mt-2 text-ink-2">{body.d}</p>
        {body.cmd && <pre className="mt-3 overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-[12px]">{body.cmd}</pre>}
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent">Retry</button>
      </div>
    </div>
  );
}
