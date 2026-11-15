"use client";

import { useState } from "react";
import type { Rainfall } from "@/lib/tt";

const AXIS = "#5f6878";
const GRID = "#e6e8ec";

/** Daily rainfall (mean of the towns inside the AOI) with the two radar passes marked. Single series: no legend. */
export function RainChart({ rain, height = 180, width = 560 }: { rain: Rainfall; height?: number; width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = rain.towns[0].days;
  const mean = days.map((_, i) => rain.towns.reduce((s, t) => s + t.mm[i], 0) / rain.towns.length);
  const W = width, H = height, L = 34, R = 8, T = 18, B = 24;
  const max = Math.max(10, Math.ceil(Math.max(...mean) / 10) * 10);
  const bw = (W - L - R) / days.length;
  const x = (i: number) => L + i * bw;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ia = days.indexOf(rain.date_a), ib = days.indexOf(rain.date_b);
  const ticks = [0, max / 2, max];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Daily rainfall, mean of ${rain.towns.length} towns; ${rain.mean_mm_between_passes} mm fell between the passes`}
        onMouseLeave={() => setHover(null)}>
        {ia >= 0 && ib >= 0 && <rect x={x(ia) + bw / 2} y={T} width={x(ib) - x(ia)} height={H - T - B} fill="#e9eff6" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={AXIS}>{t}</text>
          </g>
        ))}
        <text x={2} y={10} fontSize="11" fill={AXIS}>mm/day</text>
        {mean.map((v, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x(i)} y={T} width={bw} height={H - T - B} fill="transparent" />
            <rect x={x(i) + 1} y={y(v)} width={Math.max(1, bw - 2)} height={Math.max(0, y(0) - y(v))} rx={Math.min(2, bw / 3)}
              fill={hover === i ? "#14213d" : "#1f4e79"} />
          </g>
        ))}
        {[[ia, "Date A"], [ib, "Date B"]].map(([i, l]) => (i as number) >= 0 && (
          <g key={l as string}>
            <line x1={x(i as number) + bw / 2} x2={x(i as number) + bw / 2} y1={T - 4} y2={H - B} stroke="#14213d" strokeWidth="2" />
            <text x={x(i as number) + bw / 2} y={T - 7} textAnchor="middle" fontSize="11" fontWeight="600" fill="#14213d">{l} pass</text>
          </g>
        ))}
        {days.map((d, i) => (i % 7 === 0) && (
          <text key={d} x={x(i) + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={AXIS}>{d.slice(5)}</text>
        ))}
      </svg>
      {hover != null && (
        <div className="tnum pointer-events-none absolute top-0 rounded-md bg-ink px-2 py-1 text-[12px] text-white shadow"
          style={{ left: `${((x(hover) + bw / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
          {days[hover]} · {mean[hover].toFixed(1)} mm
        </div>
      )}
    </div>
  );
}

/** Distribution of a delta layer with the robust threshold marked. */
export function Histogram({ edges, counts, lo, hi, label }: { edges: number[]; counts: number[]; lo: number; hi: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 420, H = 150, L = 8, R = 8, T = 10, B = 24;
  const max = Math.max(...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const x = (v: number) => L + ((v - edges[0]) / (edges[edges.length - 1] - edges[0])) * (W - L - R);
  const y = (c: number) => T + (H - T - B) * (1 - c / max);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Distribution of ${label}`} onMouseLeave={() => setHover(null)}>
        {counts.map((c, i) => {
          const outside = edges[i + 1] <= lo || edges[i] >= hi;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x(edges[i])} y={T} width={x(edges[i + 1]) - x(edges[i])} height={H - T - B} fill="transparent" />
              <rect x={x(edges[i]) + 0.5} y={y(c)} width={Math.max(1, x(edges[i + 1]) - x(edges[i]) - 1)} height={y(0) - y(c)}
                fill={hover === i ? "#14213d" : outside ? (edges[i] < 0 ? "#2166ac" : "#b2182b") : "#aeb5c0"} />
            </g>
          );
        })}
        {[lo, hi].map((v) => <line key={v} x1={x(v)} x2={x(v)} y1={T} y2={H - B} stroke="#14213d" strokeDasharray="3 2" />)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={AXIS} />
        {[-12, -6, 0, 6, 12].map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="11" fill={AXIS}>{t > 0 ? `+${t}` : t === 0 ? "0" : `−${-t}`}</text>
        ))}
      </svg>
      {hover != null && (
        <div className="tnum pointer-events-none absolute top-0 rounded-md bg-ink px-2 py-1 text-[12px] text-white shadow"
          style={{ left: `${(x((edges[hover] + edges[hover + 1]) / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
          {edges[hover]} to {edges[hover + 1]} dB · {((counts[hover] / total) * 100).toFixed(1)}% of pixels
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a handful of categories; values are direct-labelled, colour carries identity only. */
export function HBars({ rows, unit }: { rows: { label: string; value: number; color: string; dashed?: boolean }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[180px_1fr_84px] items-center gap-3 text-[13px]" title={`${r.label}: ${r.value.toFixed(1)} ${unit}`}>
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="h-3 rounded-r" style={{
            width: `${(r.value / max) * 100}%`, minWidth: 2,
            background: r.dashed ? `repeating-linear-gradient(135deg, ${r.color} 0 4px, transparent 4px 7px)` : r.color,
            boxShadow: r.dashed ? `inset 0 0 0 1px ${r.color}` : undefined,
          }} />
          <span className="tnum text-right font-medium">{r.value.toLocaleString("en-US", { maximumFractionDigits: 0 })} {unit}</span>
        </li>
      ))}
    </ul>
  );
}
