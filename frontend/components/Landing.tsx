"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";

const BLUE = "#0175fe", YELLOW = "#fac504";
const Arrow = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 ${className}`} aria-hidden><path d="M4 12 12 4M6 4h6v6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
);
const Pill = ({ href, children, tone = "yellow" }: { href: string; children: React.ReactNode; tone?: "yellow" | "outline" | "blue" | "dark" }) => (
  <Link href={href} className={`inline-flex h-12 items-center gap-3 rounded-full px-6 text-[15px] font-bold transition-transform duration-200 hover:-translate-y-0.5 ${
    tone === "yellow" ? "bg-sun text-ink" : tone === "blue" ? "bg-brand text-white" : tone === "dark" ? "bg-ink text-white" : "border border-line-strong bg-white text-ink"}`}>
    {children}<Arrow />
  </Link>
);
const ImgPill = ({ src, alt, className = "" }: { src: string; alt: string; className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt={alt} className={`inline-block h-[0.86em] rounded-full object-cover align-middle ${className}`} />
);

function Badge({ text, dot, ring }: { text: string; dot: string; ring: string }) {
  const chars = text.split("");
  return (
    <div className="relative h-36 w-36">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <path d="M50 2 C56 2 58 8 64 9 C70 10 74 5 79 9 C84 13 81 19 85 24 C89 29 96 29 97 35 C99 41 93 45 94 51 C95 57 100 61 97 67 C94 73 88 72 84 77 C80 82 82 89 76 92 C70 95 66 90 60 92 C54 94 51 100 45 99 C39 98 37 92 31 90 C25 88 20 92 15 88 C10 84 13 77 9 72 C5 67 -1 65 1 58 C3 52 8 49 7 43 C6 37 1 33 4 27 C7 21 14 22 18 17 C22 12 21 5 27 3 C33 1 37 6 43 5 C47 4 46 2 50 2Z" fill="#fff" />
      </svg>
      <div className="absolute inset-0 animate-[spin_18s_linear_infinite]">
        {chars.map((c, i) => (
          <span key={i} className="absolute left-1/2 top-[9%] h-[41%] origin-bottom -translate-x-1/2 text-[13px] font-extrabold" style={{ transform: `rotate(${(360 / chars.length) * i}deg)`, color: ring }}>{c}</span>
        ))}
      </div>
      <span className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: dot }} />
    </div>
  );
}

const FINDINGS = [
  { t: "Paddies went dark", s: "Eastern delta · standing water?", img: "/landing/card_paddies.jpg", bg: "#e8452c" },
  { t: "Vedaranyam swamp", s: "1,717 ha · echo ~4× weaker", img: "/landing/card_swamp.jpg", bg: BLUE },
  { t: "Wetter uplands", s: "+1 dB brighter · damp soil?", img: "/landing/card_uplands.jpg", bg: "#0fb5ae" },
  { t: "Interference caught", s: "3,762 ha flagged, not land", img: "/landing/card_rfi.jpg", bg: "#7b3fe4" },
  { t: "76 mm of rain", s: "Fell between the two passes", img: "/landing/card_optical.jpg", bg: "#1f9d55" },
];

const QUOTES = [
  { who: "Thiruvarur", tag: "Open-Meteo rainfall + NISAR S-band", q: "99.6 mm of rain fell here between 6 and 18 October, the most of any delta town. On the radar the fields around it turned dark, field by field." },
  { who: "Vedaranyam swamp", tag: "NISAR S-band · HH channel", q: "Across 1,717 ha the HH echo fell about 6 dB, four times weaker, while HV barely moved. That is the signature smooth water leaves." },
  { who: "Thanjavur", tag: "TerraTrace quality review", q: "The biggest statistical change in the delta was not land at all: a moving glow of radio interference. TerraTrace flagged it instead of reporting it." },
];

const STEPS = [
  { k: "Gate", d: "Two NISAR passes, checked first", q: "Are these two scenes truly comparable?", out: ["Same track and frame", "Same polarization", "20-point QA checklist"], tint: "#e8f1ff", ic: BLUE },
  { k: "Align", d: "One grid, valid pixels only", q: "Which pixels can we trust on both dates?", out: ["Common valid mask", "5×5 multilook", "Sea and fill excluded"], tint: "#fff6d6", ic: "#e0a800" },
  { k: "Measure", d: "Change in decibels, per pixel", q: "How much did the radar echo change?", out: ["ΔHH and ΔHV", "Robust z-score", "Regions ≥ 5 ha"], tint: "#e6f7ee", ic: "#1f9d55" },
  { k: "Explain", d: "Every region gets its reasons", q: "What could have caused it, and how sure are we?", out: ["Pattern label", "Evidence level", "Hypothesis + limits"], tint: "#e3f6f6", ic: "#0fb5ae" },
  { k: "Share", d: "Story, map and exports", q: "How does someone else use it tomorrow?", out: ["Guided story", "GeoJSON / CSV", "Evidence report"], tint: "#ffece6", ic: "#e8452c" },
];

export default function Landing() {
  const [q, setQ] = useState(0);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setQ((v) => (v + 1) % QUOTES.length), 6000);
    return () => clearInterval(t);
  }, [paused]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white font-sans text-ink">
      {/* nav */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center gap-8 px-6 md:px-10">
          <Link href="/" className="shrink-0"><Logo size={44} /></Link>
          <nav className="hidden flex-1 justify-center gap-9 text-[16px] font-medium lg:flex">
            {[["Findings", "#findings"], ["Features", "#features"], ["How it works", "#process"], ["Data", "#data"]].map(([l, h]) => (
              <a key={l} href={h} className="hover:text-brand">{l}</a>
            ))}
          </nav>
          <Link href="/app" className="ml-auto inline-flex h-11 items-center gap-2.5 rounded-full bg-brand px-5 text-[15px] font-medium text-white hover:brightness-110 lg:ml-0">
            Open the app <Arrow />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 md:px-10">
        {/* hero */}
        <h1 className="mt-6 text-center font-display text-[clamp(52px,8.6vw,136px)] font-semibold leading-[1.02] tracking-[-0.06em]">
          <span className="flex items-center justify-center gap-[0.12em]"><ImgPill src="/landing/optical_delta.jpg" alt="Sentinel-2 view of the Cauvery delta" className="w-[3.4em] max-w-[44vw]" /><span>Clouds hid</span></span>
          <span className="flex items-center justify-center gap-[0.12em]"><span className="text-brand">the rice bowl.</span><ImgPill src="/landing/radar_delta.jpg" alt="NISAR radar colour composite of the delta" className="w-[3em] max-w-[34vw]" /></span>
          <span className="flex items-center justify-center gap-[0.12em]"><ImgPill src="/landing/change_paddies.jpg" alt="Radar change map: red fields got darker" className="w-[3.2em] max-w-[44vw]" /><span>Radar didn&apos;t.</span></span>
        </h1>

        <div className="mt-10 flex flex-col gap-6 border-t border-line pt-10 md:flex-row md:items-center">
          <p className="max-w-[460px] text-[17px] font-medium leading-relaxed text-ink-2">
            TerraTrace turns NISAR S-band radar into a story anyone can read: where the Cauvery delta changed between two passes, how sure we are, and why.
          </p>
          <div className="flex flex-wrap gap-3">
            <Pill href="/app">Open the app</Pill>
            <Pill href="#findings" tone="outline">See what changed</Pill>
          </div>
        </div>

        {/* bento */}
        <section className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-[1.05fr_2fr_0.8fr_0.85fr_1.2fr] md:grid-rows-[208px_224px]">
          <div className="flex flex-col items-start justify-center gap-3 rounded-[24px] bg-brand p-6">
            <div className="flex items-center gap-2"><Link href="/app" className="whitespace-nowrap rounded-full border-2 border-white/80 px-3.5 py-1.5 text-[14px] font-bold text-white">Start the story</Link><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-bold text-brand">+</span></div>
            <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-bold text-brand">+</span><Link href="/app" className="whitespace-nowrap rounded-full border-2 border-white/80 px-3.5 py-1.5 text-[14px] font-bold text-white">Swipe the dates</Link></div>
            <span className="whitespace-nowrap rounded-full border-2 border-white bg-ink px-3.5 py-1.5 text-[13px] font-bold text-white">10,506 km² analysed</span>
          </div>
          <div className="relative overflow-hidden rounded-[24px] bg-[#f4f4f4] md:row-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/app_story.png" alt="TerraTrace story view" className="h-full w-full object-cover object-left-top" />
            <Link href="/app" aria-label="Open the app" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink shadow"><Arrow /></Link>
          </div>
          <div className="flex flex-col justify-between rounded-[24px] bg-cream p-5">
            <div className="font-display text-[46px] font-semibold leading-none tracking-[-0.04em] text-brand">76<span className="text-[22px]"> mm</span></div>
            <div className="text-[13px] font-semibold leading-snug">of rain fell between the two radar passes</div>
          </div>
          <div className="flex items-center justify-center rounded-[24px] bg-brand"><Badge text="• NISAR • S-BAND • RADAR " dot={YELLOW} ring={BLUE} /></div>
          <div className="relative flex flex-col justify-between overflow-hidden rounded-[24px] bg-ink p-6 text-white md:row-span-2">
            <p className="relative z-10 text-[19px] font-bold leading-snug">
              Built for <span className="text-brand">agriculture officers</span>, disaster teams and wetland managers who need answers <span className="text-brand">when the sky is closed</span>.
            </p>
            <div className="relative z-10 mt-3 text-[11px] font-bold tracking-wide text-white/60">NASA SPACE APPS 2026 · ISRO NISAR · TEAM DHRUVA</div>
            <svg viewBox="0 0 300 200" className="absolute -bottom-6 left-0 w-full" aria-hidden>
              <path d="M-20 170 C60 60 140 220 210 120 S320 40 330 90" stroke={BLUE} strokeWidth="46" fill="none" strokeLinecap="round" />
              <path d="M-20 220 C80 130 150 250 230 170 S320 120 340 150" stroke={YELLOW} strokeWidth="46" fill="none" strokeLinecap="round" />
            </svg>
            <Link href="#findings" className="relative z-10 mt-auto inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-bold text-ink">See the findings <Arrow /></Link>
          </div>
          <div className="relative overflow-hidden rounded-[24px] bg-sun">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/nisar_in_space.jpg" alt="NISAR satellite in orbit (NASA/JPL-Caltech)" className="h-full w-full object-cover" />
          </div>
          <div className="flex items-center justify-center rounded-[24px] bg-sun"><Badge text="• EVERY • 12 • DAYS • ANY • WEATHER " dot={BLUE} ring="#d39f00" /></div>
          <div className="relative flex flex-col justify-between rounded-[24px] bg-sun p-5">
            <div className="font-display text-[19px] font-semibold leading-[1.15] tracking-[-0.02em]">Gate.<br />Measure.<br />Explain.<br />Delivered.</div>
            <Link href="/app" aria-label="Open the app" className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white"><Arrow /></Link>
          </div>
        </section>

        {/* features */}
        <section id="features" className="scroll-mt-24 pt-28">
          <h2 className="font-display text-[clamp(32px,3.4vw,46px)] font-semibold leading-[1.1] tracking-[-0.04em]">
            Built to read radar.<br />Designed to <span className="text-brand">explain it.</span>
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Link href="/app" className="group relative flex min-h-[300px] overflow-hidden rounded-[24px] bg-brand p-7 text-white">
              <div className="relative z-10 max-w-[52%]">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand">◎</span>
                <h3 className="mt-5 text-[22px] font-bold">Guided story</h3>
                <p className="mt-2 text-[14px] font-medium leading-snug text-white/85">Seven chapters walk anyone from &ldquo;what is radar?&rdquo; to what changed and why.</p>
                <span className="mt-6 inline-block text-[14px] font-bold">Start the story →</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/card_paddies.jpg" alt="" className="absolute -right-10 -bottom-6 h-[64%] rotate-6 rounded-2xl object-cover shadow-xl transition-transform duration-300 group-hover:rotate-3" />
            </Link>
            <Link href="/app" className="group relative flex min-h-[300px] overflow-hidden rounded-[24px] bg-lavender p-7">
              <div className="relative z-10 max-w-[52%]">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#7b3fe4]">⇆</span>
                <h3 className="mt-5 text-[22px] font-bold">Before / after swipe</h3>
                <p className="mt-2 text-[14px] font-medium leading-snug text-ink-2">Drag or press play to sweep from 6 to 18 October in true radar colour.</p>
                <span className="mt-6 inline-block text-[14px] font-bold">Compare dates →</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/card_radar.jpg" alt="" className="absolute -right-10 -bottom-6 h-[64%] -rotate-6 rounded-2xl object-cover shadow-xl transition-transform duration-300 group-hover:-rotate-3" />
            </Link>
            <div className="grid grid-rows-2 gap-4">
              <Link href="/app" className="relative overflow-hidden rounded-[24px] border border-line-strong bg-white p-6">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sun font-bold">▮▮</span><h3 className="text-[19px] font-bold">Insights</h3></div>
                <p className="mt-2 max-w-[70%] text-[13px] font-medium leading-snug text-ink-2">Rainfall, changed area by type, histograms and the top regions.</p>
                <div className="absolute bottom-0 right-5 flex h-20 items-end gap-1.5" aria-hidden>
                  {[18, 30, 22, 46, 38, 64, 80, 52].map((h, i) => <span key={i} className="w-3 rounded-t-md bg-brand" style={{ height: h }} />)}
                </div>
              </Link>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-[24px] bg-sun p-5">
                  <h3 className="text-[17px] font-bold leading-tight">Evidence, not guesses</h3>
                  <p className="mt-2 text-[12px] font-medium leading-snug">Every region lists its reasons and what radar cannot prove.</p>
                </div>
                <div className="flex flex-col justify-center rounded-[24px] bg-ink p-5 text-white">
                  <div className="font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em]">Honest<br />by design</div>
                  <div className="mt-2 text-[11px] font-semibold text-white/55">QA gate · artifact flags · provenance</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* findings */}
        <section id="findings" className="scroll-mt-24 pt-28">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-[clamp(32px,3.4vw,46px)] font-semibold leading-[1.1] tracking-[-0.04em]">What the radar <span className="text-brand">found.</span></h2>
            <Link href="/app" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-line-strong px-5 text-[14px] font-bold">See it on the map <Arrow /></Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-5">
            {FINDINGS.map((f) => (
              <Link key={f.t} href="/app" className="group relative flex aspect-[4/5] flex-col overflow-hidden rounded-[24px] p-5 text-white" style={{ background: f.bg }}>
                <div className="relative z-10 text-[18px] font-extrabold uppercase leading-tight tracking-tight">{f.t}</div>
                <div className="relative z-10 mt-1 text-[13px] font-medium text-white/90">{f.s}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.img} alt="" className="absolute bottom-4 left-1/2 h-[62%] w-[78%] -translate-x-1/2 rotate-[-4deg] rounded-2xl object-cover shadow-2xl ring-4 ring-white/90 transition-transform duration-300 group-hover:rotate-0 group-hover:scale-105" />
                <span className="absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white"><Arrow /></span>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-muted">Radar change composites from the 6 → 18 October 2026 NISAR passes. Causes are hypotheses until independently confirmed.</p>
        </section>
      </main>

      {/* marquee */}
      <section className="mt-24 -rotate-2 overflow-hidden py-6" aria-label="Through cloud, day or night, every 12 days">
        <div className="flex w-max animate-[marquee_28s_linear_infinite] gap-10 whitespace-nowrap font-display text-[clamp(44px,6vw,92px)] font-bold uppercase leading-none tracking-[-0.03em] text-brand">
          {[0, 1].map((k) => <span key={k} className="flex gap-10">Through cloud <span className="text-sun">✦</span> Day or night <span className="text-sun">✦</span> Every 12 days <span className="text-sun">✦</span></span>)}
        </div>
        <div className="mt-2 flex w-max animate-[marquee_34s_linear_infinite_reverse] gap-10 whitespace-nowrap font-display text-[clamp(44px,6vw,92px)] font-bold uppercase leading-none tracking-[-0.03em] text-transparent [-webkit-text-stroke:2px_#0e0e0e]">
          {[0, 1].map((k) => <span key={k} className="flex gap-10">From radar echoes to evidence ✧ From radar echoes to evidence ✧</span>)}
        </div>
      </section>

      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        {/* data says */}
        <section className="grid grid-cols-1 items-center gap-12 py-24 md:grid-cols-2">
          <div className="md:pl-14">
            <h2 className="font-display text-[clamp(34px,3.6vw,52px)] font-semibold leading-[1.08] tracking-[-0.04em]">Don&apos;t take our word<br />for it. Take <span className="text-brand">the radar&apos;s.</span></h2>
            <div className="mt-6 flex items-center gap-4">
              <div className="tnum font-display text-[44px] font-semibold tracking-tight">0{q + 1}<span className="text-[22px] text-[#bdbdbd]"> / 0{QUOTES.length}</span></div>
              <div className="flex flex-1 gap-2">{QUOTES.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i === q ? "bg-brand" : "bg-line"}`} />)}</div>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setQ((q + 1) % QUOTES.length)} className="h-12 rounded-full bg-ink px-6 text-[14px] font-bold text-white">Next fact →</button>
              <button type="button" onClick={() => setPaused((p) => !p)} className="h-12 rounded-full border border-line-strong px-6 text-[14px] font-bold">{paused ? "Play" : "Pause"}</button>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[560px]">
            <div className="absolute -right-3 -top-3 h-full w-full rounded-[24px] border border-line bg-white" />
            <div className="absolute -right-1.5 -top-1.5 h-full w-full rounded-[24px] border border-line bg-white" />
            <article key={q} className="relative min-h-[300px] animate-[rise_.4s_ease-out] rounded-[24px] border border-line bg-white p-7 shadow-[0_20px_50px_-20px_rgb(14_14_14/.25)]">
              <div className="absolute left-7 top-0 h-1 w-12 rounded-b bg-brand" />
              <div className="flex items-center gap-3 border-b border-line pb-4">
                <Logo size={40} mark />
                <div><div className="text-[16px] font-bold">{QUOTES[q].who}</div><div className="text-[12px] text-muted">{QUOTES[q].tag}</div></div>
              </div>
              <p className="mt-5 text-[18px] font-medium leading-relaxed text-ink-2">{QUOTES[q].q}</p>
            </article>
          </div>
        </section>

        {/* process */}
        <section id="process" className="scroll-mt-24 pb-24">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-[clamp(32px,3.4vw,46px)] font-semibold leading-[1.1] tracking-[-0.04em]">The same five steps. <span className="text-brand">Every single pass.</span></h2>
            <Link href="/app" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-bold text-white">See the method <Arrow /></Link>
          </div>
          <div className="mt-8 flex h-[300px] gap-3">
            {STEPS.map((s, i) => (
              <button key={s.k} type="button" onClick={() => setStep(i)} onMouseEnter={() => setStep(i)}
                className={`relative overflow-hidden rounded-[24px] p-5 text-left transition-all duration-500 ${i === step ? "flex-[5] text-white" : "flex-[0.9]"}`}
                style={{ background: i === step ? BLUE : s.tint }}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: i === step ? "rgb(255 255 255 / .2)" : s.ic }}>{i + 1}</span>
                {i === step ? (
                  <div className="mt-4 animate-[rise_.35s_ease-out]">
                    <div className="text-[12px] font-bold text-white/75">0{i + 1} / 0{STEPS.length}</div>
                    <div className="mt-1 font-display text-[48px] font-semibold leading-none tracking-[-0.04em]">{s.k}</div>
                    <div className="mt-3 text-[16px] font-bold">{s.d}</div>
                    <div className="mt-1 text-[13px] font-medium text-white/80">The question it answers: {s.q}</div>
                    <div className="mt-4 text-[11px] font-bold tracking-wider text-white/70">YOU GET</div>
                    <div className="mt-2 flex flex-wrap gap-2">{s.out.map((o) => <span key={o} className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-brand">{o}</span>)}</div>
                  </div>
                ) : (
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 whitespace-nowrap text-[18px] font-bold">{s.k}</span>
                )}
                {i !== step && <span className="absolute bottom-4 left-5 text-[12px] font-bold" style={{ color: s.ic }}>0{i + 1}</span>}
              </button>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-3 rounded-[24px] bg-brand px-8 py-5 text-[15px] font-bold text-white">
            <span>✦ Through monsoon cloud</span><span>✦ Day or night</span><span>✦ A new look every 12 days</span>
            <Link href="/app" className="ml-auto underline decoration-sun decoration-2 underline-offset-4">Open the app ↗</Link>
          </div>
        </section>
      </div>

      {/* footer */}
      <footer id="data" className="bg-ink text-white">
        <div className="mx-auto max-w-[1440px] px-6 py-14 md:px-10">
          <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/10 pb-8">
            <Logo size={52} dark />
            <div className="text-right text-[15px]"><div className="font-bold">Team Dhruva</div><div className="text-white/70">NASA Space Apps Challenge 2026 · Dancing with the SARs</div></div>
          </div>
          <div className="grid grid-cols-1 gap-10 py-10 md:grid-cols-[1.4fr_0.8fr_1.2fr]">
            <div>
              <div className="font-display text-[clamp(32px,3.2vw,48px)] font-semibold leading-[1.1] tracking-[-0.03em]">Good data deserves<br /><span className="text-sun">a clear story.</span></div>
              <Link href="/app" className="mt-7 inline-flex h-12 items-center gap-3 rounded-full bg-sun px-6 text-[15px] font-bold text-ink">Open TerraTrace <Arrow /></Link>
              <p className="mt-6 text-[13px] text-white/60">Cauvery delta, Tamil Nadu, India.<br />Tracing change across Earth&apos;s surface.</p>
            </div>
            <div>
              <div className="text-[12px] font-bold tracking-[0.15em] text-white/60">EXPLORE</div>
              <ul className="mt-4 space-y-3 text-[15px]">
                {["Story", "Explore", "Compare", "Insights", "Method"].map((l) => <li key={l}><Link href="/app" className="hover:text-sun">{l}</Link></li>)}
              </ul>
            </div>
            <div>
              <div className="text-[12px] font-bold tracking-[0.15em] text-white/60">DATA &amp; CREDITS</div>
              <ul className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-white/80">
                <li>NISAR S-band L2-GCOV · ISRO / NRSC via Bhoonidhi (open data)</li>
                <li>NISAR spacecraft image · NASA/JPL-Caltech</li>
                <li>Sentinel-2 cloudless 2023 · EOX (CC BY-NC-SA 4.0)</li>
                <li>Rainfall · Open-Meteo, ERA5 reanalysis (CC BY 4.0)</li>
                <li>Map labels · © OpenStreetMap contributors</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 text-[12px] text-white/50">© 2026 Team Dhruva · TerraTrace. Change regions are radar-response candidates; causes are hypotheses.</div>
        </div>
        <div className="flex h-2"><span className="flex-[3] bg-brand" /><span className="flex-1 bg-sun" /></div>
      </footer>
    </div>
  );
}
