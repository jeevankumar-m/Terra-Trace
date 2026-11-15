"use client";

import type { FeatureCollection } from "geojson";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  API_BASE, LEVEL_STYLE, PATTERNS, api, fmtDate, fmtDb, fmtDbNum, fmtHa, fmtLonLat, fmtPct, fmtUtc, safeSentence,
  type Analysis, type Candidate, type CandidateProps, type Flag, type Level, type Pattern, type Status,
} from "@/lib/tt";

const LEVEL_RANK: Record<Level, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function PatternChip({ pattern }: { pattern: Pattern }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2 py-0.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-line">
      <span className="h-2 w-2 rounded-full ring-1 ring-[#14213d]/40" style={{ background: PATTERNS[pattern].color }} />
      {PATTERNS[pattern].short}
    </span>
  );
}
export function LevelChip({ level }: { level: Level }) {
  return <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${LEVEL_STYLE[level]}`}>{level[0] + level.slice(1).toLowerCase()}</span>;
}
export function StatusIcon({ s }: { s: Status }) {
  const m = { pass: ["✓", "text-pass bg-pass-soft"], warn: ["!", "text-warn bg-warn-soft"], fail: ["✕", "text-fail bg-fail-soft"] }[s];
  return <span aria-label={s} className={`mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${m[1]}`}>{m[0]}</span>;
}

function Kpi({ value, unit, label, hint }: { value: string; unit?: string; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="tnum flex items-baseline gap-1">
        <span className="text-[28px] font-semibold leading-none tracking-tight">{value}</span>
        {unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}
      </div>
      <div className="mt-2 text-[12px] font-medium text-ink-2">{label}</div>
      {hint && <div className="text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-t border-line px-5 py-4 ${className}`}>
      <h3 className="label mb-2.5 uppercase">{title}</h3>
      {children}
    </section>
  );
}

export default function Inspector({ analysis, candidates, selectedId, onSelect, flags = {} }: {
  analysis: Analysis; candidates: FeatureCollection | null;
  selectedId: string | null; onSelect: (id: string | null) => void; flags?: Record<string, Flag>;
}) {
  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedId
          ? <CandidateDetail key={selectedId} analysis={analysis} id={selectedId} onBack={() => onSelect(null)} flag={flags[selectedId]} />
          : <Summary analysis={analysis} candidates={candidates} onSelect={onSelect} />}
      </div>
    </aside>
  );
}

function Summary({ analysis: a, candidates, onSelect }: {
  analysis: Analysis; candidates: FeatureCollection | null; onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<"id" | "ha" | "level">("ha");
  const rows = useMemo(() => {
    const r = (candidates?.features ?? []).map((f) => f.properties as CandidateProps);
    return [...r].sort((x, y) => sort === "id" ? x.candidate_id.localeCompare(y.candidate_id)
      : sort === "ha" ? y.area_ha - x.area_ha
      : LEVEL_RANK[x.evidence_level] - LEVEL_RANK[y.evidence_level] || y.area_ha - x.area_ha);
  }, [candidates, sort]);
  const s = a.summary;
  const hasDeltas = !!a.layers.delta_hh_db;

  return (
    <div>
      <div className="px-5 pb-4 pt-5">
        <h2 className="text-[16px] font-semibold">Analysis summary</h2>
        <p className="mt-0.5 text-[12px] text-muted">Select a candidate on the map or in the list to inspect its evidence.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Kpi value={hasDeltas ? String(s.n_candidates) : "—"} label="Candidates found" />
          <Kpi value={hasDeltas ? fmtHa(s.total_candidate_area_ha) : "—"} unit="ha" label="Total candidate area" />
          <Kpi value={fmtPct(s.common_valid_pixel_fraction)} unit="%" label="Common valid coverage"
            hint={`${fmtHa(s.analysed_area_ha)} ha analysed`} />
          <Kpi value={`k = ${a.threshold.k.toFixed(1)}`} label="Robust threshold" hint={`MMU ${a.threshold.mmu_ha.toFixed(1)} ha`} />
        </div>
      </div>

      <Section title="Candidates">
        {!hasDeltas ? (
          <p className="text-[13px] text-ink-2">
            {a.fallback_level === "C" ? "Single-scene view (fallback level C): no temporal comparison, so no change candidates."
              : "Change detection is blocked because the pair failed QA. See the pair checklist in the top bar."}
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg bg-canvas p-3 text-[13px] text-ink-2">
            No region exceeded |z| ≥ {a.threshold.k.toFixed(1)} on ΔHH or ΔHV with an area of at least {a.threshold.mmu_ha.toFixed(1)} ha
            across the {fmtHa(s.analysed_area_ha)} ha analysed. This is a valid result, not an error.
          </div>
        ) : (
          <table className="tnum w-full whitespace-nowrap text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                {([["id", "ID"], [null, "Pattern"], ["ha", "Area"], ["level", "Evidence"]] as const).map(([k, l]) => (
                  <th key={l} className={`pb-1.5 font-medium ${l === "Area" ? "text-right" : l === "Evidence" ? "pl-3" : ""}`}>
                    {k ? <button type="button" onClick={() => setSort(k)} className={sort === k ? "text-ink" : "hover:text-ink"}>
                      {l}{sort === k ? " ↓" : ""}</button> : l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.candidate_id} onClick={() => onSelect(r.candidate_id)}
                  className="cursor-pointer border-t border-line transition-colors duration-150 hover:bg-canvas">
                  <td className="py-2 font-semibold">{r.candidate_id}{(r as CandidateProps & { flagged?: boolean }).flagged && <span title="Flagged: likely artifact" className="ml-1 rounded bg-warn-soft px-1 text-[10px] font-semibold text-warn">RFI?</span>}</td>
                  <td className="py-2"><PatternChip pattern={r.pattern} /></td>
                  <td className="py-2 text-right">{fmtHa(r.area_ha)} <span className="text-muted">ha</span></td>
                  <td className="py-2 pl-3"><LevelChip level={r.evidence_level} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Method">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Rule</dt><dd>|z<sub>robust</sub>| ≥ {a.threshold.k.toFixed(1)} on ΔHH or ΔHV</dd>
          <dt className="text-muted">Score</dt><dd>0.6745 · (Δ − median) / MAD</dd>
          {Object.entries(a.background ?? {}).filter(([k]) => k !== "delta_ratio_db").map(([k, b]) => (
            <Fragment key={k}>
              <dt className="text-muted">Background {k === "delta_hh_db" ? "ΔHH" : "ΔHV"}</dt>
              <dd className="tnum">median {fmtDb(b.median)} · MAD {fmtDb(b.mad, false)}</dd>
            </Fragment>
          ))}
          <dt className="text-muted">Multilook</dt><dd>{a.threshold.multilook ?? "none"}</dd>
          <dt className="text-muted">Radiometry</dt><dd>{a.preprocessing.radiometric_convention}</dd>
          <dt className="text-muted">Corroboration</dt><dd className="text-ink-2">Not available</dd>
        </dl>
      </Section>

      <Section title="Export">
        <div className="flex flex-wrap gap-2">
          {([["candidates.geojson", "GeoJSON"], ["candidates.csv", "CSV"], ["report.html", "Evidence report"]] as const).map(([f, l]) => (
            <a key={f} href={`${API_BASE}/api/analyses/${encodeURIComponent(a.analysis_id)}/export/${f}`}
              target={f === "report.html" ? "_blank" : undefined} rel="noreferrer"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 hover:bg-canvas">
              {l}
            </a>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">Every export carries the data label and the interpretation limit.</p>
      </Section>
    </div>
  );
}

function CandidateDetail({ analysis: a, id, onBack, flag }: { analysis: Analysis; id: string; onBack: () => void; flag?: Flag }) {
  const [c, setC] = useState<Candidate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Candidate>(`/api/candidates/${a.analysis_id}/${id}`).then(setC, (e) => setErr(String(e)));
  }, [a.analysis_id, id]);

  const back = (
    <button type="button" onClick={onBack} className="text-[12px] font-medium text-accent hover:underline">← All candidates</button>
  );
  if (err) return <div className="p-5">{back}<p className="mt-3 text-[13px] text-fail">Could not load {id}: {err}</p></div>;
  if (!c) return <div className="space-y-3 p-5">{back}{[60, 120, 90, 140].map((h) => <div key={h} className="animate-pulse rounded-lg bg-canvas" style={{ height: h }} />)}</div>;

  const st = c.statistics as Record<string, number | null>;
  const p = PATTERNS[c.pattern];
  const hasHv = st.hv_a_median_db != null;

  return (
    <div>
      <div className="px-5 pb-4 pt-5">
        {back}
        {flag && <p className="mt-3 rounded-lg bg-warn-soft p-3 text-[13px] text-warn"><b>Analyst flag: {flag.label}.</b> {flag.note}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[20px] font-semibold tracking-tight">{c.candidate_id}</h2>
          <PatternChip pattern={c.pattern} />
          <LevelChip level={c.evidence_level} />
        </div>
        <div className="text-[13px] text-ink-2">{p.label}</div>
        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="tnum text-[32px] font-semibold leading-none tracking-tight">{fmtHa(c.area_ha)}</span>
          <span className="text-[14px] font-medium text-muted">ha</span>
        </div>
        <div className="tnum mt-1 text-[12px] text-muted">{c.pixel_count.toLocaleString("en-US")} pixels × {fmtHa(c.area_ha * 1e4 / c.pixel_count)} m² ÷ 10 000 · area from the real geotransform</div>
        <dl className="tnum mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          <dt className="text-muted">Centroid</dt><dd>{fmtLonLat(c.centroid_lonlat)}</dd>
          <dt className="text-muted">Bounding box</dt>
          <dd>{fmtLonLat([c.bbox_lonlat[0], c.bbox_lonlat[1]])} → {fmtLonLat([c.bbox_lonlat[2], c.bbox_lonlat[3]])}</dd>
        </dl>
        <p className="mt-3 rounded-lg bg-canvas p-3 text-[13px] leading-relaxed text-ink">{safeSentence(c)}</p>
      </div>

      <Section title="Channel evidence">
        <table className="tnum w-full whitespace-nowrap text-[13px]">
          <thead>
            <tr className="text-right text-[12px] text-muted">
              <th className="pb-1.5 text-left font-medium">Channel</th>
              <th className="pb-1.5 font-medium">Date A</th><th className="pb-1.5 font-medium">Date B</th>
              <th className="pb-1.5 font-medium">Δ</th><th className="pb-1.5 font-medium">Pixels</th>
            </tr>
          </thead>
          <tbody>
            {[["HH", st.hh_a_median_db, st.hh_b_median_db, st.delta_hh_median_db],
              ...(hasHv ? [["HV", st.hv_a_median_db, st.hv_b_median_db, st.delta_hv_median_db]] : [])].map(([ch, va, vb, d]) => (
              <tr key={ch as string} className="border-t border-line text-right">
                <td className="py-2 text-left font-semibold">{ch}</td>
                <td className="py-2">{fmtDbNum(va as number, false)}</td>
                <td className="py-2">{fmtDbNum(vb as number, false)}</td>
                <td className="py-2 font-semibold"><Delta v={d as number} /></td>
                <td className="py-2 text-ink-2">{c.pixel_count.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1.5 text-[12px] text-muted">Medians over the region, dB. {hasHv ? `Δ(HH/HV) ${fmtDb(st.delta_hh_hv_ratio_median_db)}.` : "HV not available for this pair."}</div>
        <SlopeChart a={a} st={st} hasHv={hasHv} />
      </Section>

      <Section title="Evidence">
        <ul className="space-y-1.5">
          {c.evidence.map((e, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug"><StatusIcon s={e.status} /><span>{e.text}</span></li>
          ))}
        </ul>
        <div className="tnum mt-2.5 text-[12px] text-muted">
          Valid neighbourhood {fmtPct(st.valid_pixel_fraction)} % · compactness {Number(st.compactness).toFixed(2)} · fill {fmtPct(st.fill_fraction)} %
        </div>
      </Section>

      <Section title="Interpretation">
        <div className="space-y-2.5 text-[13px] leading-relaxed">
          <div><div className="font-semibold">What this means</div><p className="text-ink-2">{p.means}</p></div>
          <div><div className="font-semibold">What it does not prove</div><p className="text-ink-2">{p.notProof}</p></div>
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] font-medium text-warn">{c.interpretation_limit}.</p>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[13px]">
          <span className="text-muted">Corroboration</span><span className="text-ink-2">Not available</span>
        </div>
      </Section>

      <section className="border-t border-line px-5 py-4">
        <details className="group">
          <summary className="label cursor-pointer list-none uppercase">Provenance <span className="text-muted group-open:hidden">+</span></summary>
          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            {[a.scene_a, a.scene_b].map((s, i) => s && (
              <Prov key={i} label={`Scene ${i ? "B" : "A"}`}>
                <div className="break-all font-mono text-[11px]">{s.scene_id}</div>
                <div className="tnum text-ink-2">{fmtUtc(s.start_utc)} · track {s.relative_track} · frame {s.frame} · {s.orbit_direction === "A" ? "ascending" : "descending"} · {s.polarization_code} · CRID {s.crid}</div>
              </Prov>
            ))}
            <Prov label="Method"><span className="font-mono text-[11px]">{a.method}</span></Prov>
            <Prov label="Threshold">{a.threshold.rule}, k = {a.threshold.k.toFixed(1)}, MMU {a.threshold.mmu_ha.toFixed(1)} ha</Prov>
            <Prov label="Code"><span className="font-mono text-[11px]">{a.provenance.code_version}</span> · run {fmtUtc(a.provenance.created_utc)}</Prov>
          </dl>
        </details>
      </section>
    </div>
  );
}

function Prov({ label, children }: { label: string; children: React.ReactNode }) {
  return <><dt className="text-muted">{label}</dt><dd className="min-w-0">{children}</dd></>;
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return <>—</>;
  const flat = Math.abs(v) < 0.05;
  const dec = v < 0;
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span aria-hidden className={flat ? "text-muted" : dec ? "text-dec" : "text-inc"}>{flat ? "·" : dec ? "▼" : "▲"}</span>{fmtDbNum(v)}
    </span>
  );
}

/** Two dates only: paired dots joined by a segment. No fabricated trend line. */
function SlopeChart({ a, st, hasHv }: { a: Analysis; st: Record<string, number | null>; hasHv: boolean }) {
  const series = [
    { ch: "HH", color: "#2a78d6", va: st.hh_a_median_db, vb: st.hh_b_median_db },
    ...(hasHv ? [{ ch: "HV", color: "#eb6834", va: st.hv_a_median_db, vb: st.hv_b_median_db }] : []),
  ].filter((s) => s.va != null && s.vb != null) as { ch: string; color: string; va: number; vb: number }[];
  if (!series.length) return null;
  const vals = series.flatMap((s) => [s.va, s.vb]);
  const span = Math.max(...vals) - Math.min(...vals);
  const step = [1, 2, 5, 10].find((st) => span / st <= 4) ?? 10;
  const lo = Math.floor(Math.min(...vals) / step) * step - step, hi = Math.ceil(Math.max(...vals) / step) * step + step;
  const W = 340, H = 176, L = 40, R = 48, T = 22, B = 30;
  const x = (i: number) => L + i * (W - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  // direct labels at Date B, pushed apart when closer than 13 px
  const labelY = series.map((s) => y(s.vb) + 4);
  if (labelY.length === 2 && Math.abs(labelY[0] - labelY[1]) < 13) {
    const mid = (labelY[0] + labelY[1]) / 2, up = series[0].vb >= series[1].vb ? 0 : 1;
    labelY[up] = mid - 6.5; labelY[1 - up] = mid + 6.5;
  }
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Median backscatter on Date A and Date B">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e6e8ec" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5f6878" className="tnum">{fmtDbNum(t, false)}</text>
          </g>
        ))}
        <text x={L - 6} y={10} fontSize={11} fill="#5f6878" textAnchor="end">dB</text>
        {[0, 1].map((i) => (
          <text key={i} x={x(i) + (i ? 6 : -6)} y={H - 8} fontSize={11} fill="#4a5263" textAnchor={i ? "end" : "start"} className="tnum">
            {i ? "Date B" : "Date A"} {fmtDate(i ? a.scene_b?.start_utc : a.scene_a.start_utc)}
          </text>
        ))}
        {[0, 1].map((i) => <line key={i} x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="#d3d7de" />)}
        {series.map((s, si) => (
          <g key={s.ch}>
            <line x1={x(0)} x2={x(1)} y1={y(s.va)} y2={y(s.vb)} stroke={s.color} strokeWidth={2} />
            {[[0, s.va], [1, s.vb]].map(([i, v]) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2}>
                <title>{`${s.ch} ${i ? "Date B" : "Date A"}: ${fmtDb(v, false)}`}</title>
              </circle>
            ))}
            <text x={x(1) + 10} y={labelY[si]} fontSize={12} fontWeight={600} fill="#14213d">{s.ch}</text>
          </g>
        ))}
      </svg>
      <figcaption className="flex gap-4 text-[12px] text-muted">
        {series.map((s) => (
          <span key={s.ch} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.ch} median</span>
        ))}
        <span className="ml-auto">Two dates only, no trend line</span>
      </figcaption>
    </figure>
  );
}
