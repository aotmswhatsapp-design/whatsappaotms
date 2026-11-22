"use client";

/**
 * WhatsApp dashboard charts.
 *
 * Four self-contained cards — a delivery trend line, an inbound/outbound wave
 * pair, a template-category treemap and a monthly volume radar. Hand-rolled
 * SVG with no chart library: the only things they read from the theme are the
 * surface tokens, so every number colour is a prop.
 *
 * Each card measures itself with a ResizeObserver and fills whatever cell the
 * draggable grid hands it.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Point = { label: string; value: number };

/* ---------------- shared ---------------- */

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

const FONT_MONO = "var(--font-geist-mono)";

export const CHART_COLORS = {
  /* Series draw on white cards, so the first one is the brand teal itself. */
  brand: "var(--brand)",
  blue: "var(--blue)",
  lime: "var(--lime)",
} as const;

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reads the motion preference through an external store, so the first render
 * is deterministic and a change re-renders without a setState-in-effect.
 */
function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(MOTION_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}

function useSize() {
  const ref = useRef(null as HTMLDivElement | null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize((was) => (was.w === w && was.h === h ? was : { w, h }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Smooth path through points (catmull-rom as cubic beziers). */
function smooth(points: [number, number][]) {
  const n = points.length;
  if (n < 2) return "";
  const at = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const k = 0.18;
    d += `C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function CountUp({
  value,
  prefix = "",
  duration = 1100,
}: {
  value: number;
  prefix?: string;
  duration?: number;
}) {
  const ref = useRef(null as HTMLSpanElement | null);
  const from = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.textContent = prefix + fmt(value);
      from.current = value;
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const v = start + (value - start) * ease(t);
      el.textContent = prefix + fmt(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, prefix, duration, reduced]);

  return <span ref={ref}>{prefix}0</span>;
}

/* ---------------- tooltip ---------------- */

type Tip = {
  title: string;
  rows: { label: string; value: string; color?: string }[];
};
type TipApi = { show: (x: number, y: number, tip: Tip) => void; hide: () => void };

function useTip() {
  const api = useRef(null as TipApi | null);
  const [tip, setTip] = useState(null as (Tip & { x: number; y: number }) | null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const box = useRef(null as HTMLDivElement | null);

  useEffect(() => {
    api.current = {
      show: (x, y, next) => setTip({ ...next, x, y }),
      hide: () => setTip(null),
    };
    return () => {
      api.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    let left = tip.x + 14;
    let top = tip.y - rect.height - 12;
    if (left + rect.width > window.innerWidth - 8) left = tip.x - rect.width - 14;
    if (top < 8) top = tip.y + 16;
    setPos({ left, top });
  }, [tip]);

  const node = (
    <div
      ref={box}
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-50 whitespace-nowrap rounded-xl border border-border bg-popover/95 px-2.5 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-md transition-opacity duration-150",
        tip ? "opacity-100" : "opacity-0",
      )}
      style={{ left: pos.left, top: pos.top }}
    >
      {tip ? (
        <>
          <div className="mb-1 text-muted-foreground">{tip.title}</div>
          {tip.rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3"
            >
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                {row.color ? (
                  <i
                    className="inline-block size-2 rounded-[2px]"
                    style={{ background: row.color }}
                  />
                ) : null}
                {row.label}
              </span>
              <b
                className="font-medium tabular-nums"
                style={{ fontFamily: FONT_MONO }}
              >
                {row.value}
              </b>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );

  return { api, node };
}

/* ---------------- card chrome ---------------- */

export function ChartCard({
  title,
  meta,
  children,
  footer,
  className,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3 p-4", className)}>
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h2>
        {meta}
      </div>
      {children}
      {footer}
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 12 12" className="size-[11px]" aria-hidden="true">
      <path
        d="M6 10.5V1.5M2 5.5l4-4 4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Delta({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[3px] text-[11px] font-semibold tracking-[-0.02em] text-lime">
      <Arrow />
      {children}
    </span>
  );
}

/* ---------------- A: delivery trend ---------------- */

export function TrendCard({
  label,
  value,
  delta,
  note,
  caption,
  series,
  color = CHART_COLORS.brand,
}: {
  label: string;
  value: number;
  /** Omitted when Meta gave no comparable previous window. */
  delta?: string;
  note?: string;
  caption?: string;
  series: Point[];
  color?: string;
}) {
  const [ref, { w: W, h: H }] = useSize();
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState(null as number | null);
  const id = useId().replace(/:/g, "");
  const { api, node } = useTip();

  useEffect(() => {
    if (!W || !H) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setDrawn(true)),
    );
    return () => cancelAnimationFrame(raf);
  }, [W, H]);

  const values = series.map((point) => point.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const raw = span / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .find((candidate) => candidate >= raw) || raw;

  const padLeft = 12;
  const padRight = 44;
  const top = 20;
  const bottom = 8;
  const min = lo - span * 0.45;
  const max = hi + span * 0.08;
  const y = (v: number) =>
    top + (1 - (v - min) / (max - min)) * Math.max(1, H - top - bottom);
  const x = (i: number) =>
    padLeft + (i / Math.max(1, values.length - 1)) * Math.max(1, W - padLeft - padRight);

  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);

  const points = values.map((v, i) => [x(i), y(v)] as [number, number]);
  const path = W && H ? smooth(points) : "";
  const last = points[points.length - 1];
  const compact = (v: number) =>
    v >= 1000 ? (v / 1000).toFixed(step < 1000 ? 1 : 0) + "K" : String(v);

  const move = (event: ReactPointerEvent) => {
    const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const i = Math.max(
      0,
      Math.min(
        values.length - 1,
        Math.round(
          ((event.clientX - rect.left - padLeft) / Math.max(1, W - padLeft - padRight)) *
            (values.length - 1),
        ),
      ),
    );
    setHover(i);
    api.current?.show(rect.left + points[i][0], rect.top + points[i][1], {
      title: series[i].label,
      rows: [{ label, value: fmt(values[i]), color }],
    });
  };

  return (
    <ChartCard
      title={label}
      className="gap-2"
    >
      <div className="shrink-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums"
            style={{ fontFamily: FONT_MONO }}
          >
            <CountUp value={value} />
          </span>
          {delta ? <Delta>{delta}</Delta> : null}
        </div>
        {note ? (
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        ) : null}
      </div>

      <div
        ref={ref}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-secondary/40"
      >
        {caption ? (
          <div className="pointer-events-none absolute top-2 left-2.5 text-[10px] tracking-[-0.01em] text-muted-foreground">
            {caption}
          </div>
        ) : null}
        {W > 0 && H > 0 ? (
          <svg
            width={W}
            height={H}
            className="block"
            role="img"
            aria-label={`${label}: from ${fmt(values[0])} to ${fmt(values[values.length - 1])}`}
          >
            <defs>
              <linearGradient id={`${id}l`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor={color} stopOpacity="0.55" />
                <stop offset="1" stopColor={color} />
              </linearGradient>
              <linearGradient id={`${id}a`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity="0.2" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={0}
                  x2={W}
                  y1={y(v)}
                  y2={y(v)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={W - 8}
                  y={y(v) - 4}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-muted-foreground"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {compact(v)}
                </text>
              </g>
            ))}
            <path d={`${path}L${last[0]},${H}L${points[0][0]},${H}Z`} fill={`url(#${id}a)`} />
            <path
              d={path}
              pathLength={1}
              fill="none"
              stroke={`url(#${id}l)`}
              strokeWidth={2.5}
              strokeLinecap="round"
              style={{
                strokeDasharray: 1,
                strokeDashoffset: drawn || reduced ? 0 : 1,
                transition: reduced
                  ? "none"
                  : "stroke-dashoffset 1.4s cubic-bezier(.3,.8,.2,1) .2s",
              }}
            />
            <circle
              cx={last[0]}
              cy={last[1]}
              r={4}
              fill={color}
              className="stroke-card"
              strokeWidth={2}
            />
            {hover !== null ? (
              <>
                <line
                  x1={points[hover][0]}
                  x2={points[hover][0]}
                  y1={0}
                  y2={H}
                  className="stroke-muted-foreground/40"
                  strokeWidth={1}
                />
                <circle
                  cx={points[hover][0]}
                  cy={points[hover][1]}
                  r={4}
                  fill={color}
                  className="stroke-card"
                  strokeWidth={2}
                />
              </>
            ) : null}
            <rect
              width={W}
              height={H}
              fill="transparent"
              onPointerMove={move}
              onPointerLeave={() => {
                setHover(null);
                api.current?.hide();
              }}
            />
          </svg>
        ) : null}
      </div>
      {node}
    </ChartCard>
  );
}

/* ---------------- B: inbound vs outbound ---------------- */

export function FlowCard({
  title,
  total,
  note,
  inbound,
  outbound,
  priorInbound,
  priorOutbound,
  labels = { inbound: "Inbound", outbound: "Outbound", prior: "Prior week" },
}: {
  title: string;
  total: number;
  note?: string;
  inbound: number[];
  outbound: number[];
  priorInbound?: number[];
  priorOutbound?: number[];
  labels?: { inbound: string; outbound: string; prior: string };
}) {
  const [ref, { w: W, h: H }] = useSize();
  const reduced = useReducedMotion();
  const paths = useRef([] as (SVGPathElement | null)[]);
  const [hover, setHover] = useState(null as number | null);
  const { api, node } = useTip();

  const n = inbound.length;
  const max = Math.max(1, ...inbound, ...outbound, ...(priorInbound ?? []), ...(priorOutbound ?? []));
  const pad = 6;
  const mid = H / 2;
  const amp = Math.max(4, H / 2 - 10);
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);

  const sets = [
    { values: priorInbound, dir: -1, key: "pi" },
    { values: priorOutbound, dir: 1, key: "po" },
    { values: inbound, dir: -1, key: "i" },
    { values: outbound, dir: 1, key: "o" },
  ].filter((set) => set.values && set.values.length === n) as {
    values: number[];
    dir: number;
    key: string;
  }[];

  useEffect(() => {
    if (!W || !H) return;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const grow = reduced ? 1 : ease(Math.min(1, t / 1.3));
      sets.forEach((set, index) => {
        const breathe = reduced ? 1 : 1 + Math.sin(t * 1.2 + index * 0.9) * 0.03;
        const points = set.values.map(
          (v, i) =>
            [x(i), mid + set.dir * (2 + (v / max) * amp * grow * breathe)] as [
              number,
              number,
            ],
        );
        paths.current[index]?.setAttribute("d", smooth(points));
      });
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, reduced, max, n, inbound, outbound, priorInbound, priorOutbound]);

  const move = (event: ReactPointerEvent) => {
    const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const i = Math.max(
      0,
      Math.min(n - 1, Math.round(((event.clientX - rect.left - pad) / Math.max(1, W - 2 * pad)) * (n - 1))),
    );
    setHover(i);
    api.current?.show(rect.left + x(i), rect.top + 10, {
      title: `${String(i % 24).padStart(2, "0")}:00`,
      rows: [
        { label: labels.inbound, value: fmt(inbound[i]), color: CHART_COLORS.blue },
        { label: labels.outbound, value: fmt(outbound[i]), color: CHART_COLORS.brand },
      ],
    });
  };

  const stroke = (key: string) => {
    if (key === "i") return CHART_COLORS.blue;
    if (key === "o") return CHART_COLORS.brand;
    return "var(--muted-foreground)";
  };
  const opacity = (key: string) =>
    key === "i" || key === "o" ? 1 : key === "pi" || key === "po" ? 0.35 : 0.3;
  const width = (key: string) => (key === "i" || key === "o" ? 2.4 : 1.4);

  return (
    <ChartCard title={title} className="gap-2">
      <div className="shrink-0">
        <span
          className="text-2xl leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums"
          style={{ fontFamily: FONT_MONO }}
        >
          <CountUp value={total} />
        </span>
        {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      </div>

      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-secondary/40">
        {W > 0 && H > 0 ? (
          <svg
            width={W}
            height={H}
            className="block"
            role="img"
            aria-label={`${labels.inbound} and ${labels.outbound} by hour`}
          >
            {Array.from({ length: 7 }, (_, i) => 8 + ((H - 16) * i) / 6).map((yy) => (
              <g key={yy} className="stroke-muted-foreground/30">
                <line x1={4} x2={10} y1={yy} y2={yy} strokeWidth={1} />
                <line x1={W - 10} x2={W - 4} y1={yy} y2={yy} strokeWidth={1} />
              </g>
            ))}
            <line x1={pad} x2={W - pad} y1={mid} y2={mid} className="stroke-border" strokeWidth={1} />
            {sets.map((set, index) => (
              <path
                key={set.key}
                ref={(el) => {
                  paths.current[index] = el;
                }}
                fill="none"
                stroke={stroke(set.key)}
                strokeWidth={width(set.key)}
                strokeLinecap="round"
                opacity={opacity(set.key)}
              />
            ))}
            {hover !== null ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={2}
                y2={H - 2}
                className="stroke-muted-foreground/50"
                strokeWidth={1}
              />
            ) : null}
            <rect
              width={W}
              height={H}
              fill="transparent"
              onPointerMove={move}
              onPointerLeave={() => {
                setHover(null);
                api.current?.hide();
              }}
            />
          </svg>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0.5 w-3 rounded-sm" style={{ background: CHART_COLORS.blue }} />
          {labels.inbound}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0.5 w-3 rounded-sm" style={{ background: CHART_COLORS.brand }} />
          {labels.outbound}
        </span>
        {priorInbound ? (
          <span className="inline-flex items-center gap-1.5">
            <i className="h-0.5 w-3 rounded-sm bg-muted-foreground/40" />
            {labels.prior}
          </span>
        ) : null}
      </div>
      {node}
    </ChartCard>
  );
}

/* ---------------- D: monthly volume (radar) ---------------- */

export function SeasonalityCard({
  title,
  months,
  current,
  previous,
  previousLabel,
}: {
  title: string;
  months: string[];
  current: number[];
  previous?: number[];
  previousLabel?: string;
}) {
  const [ref, { w: W, h: H }] = useSize();
  const reduced = useReducedMotion();
  const line = useRef(null as SVGPathElement | null);
  const drawn = useRef(null as number[] | null);
  const [hover, setHover] = useState(null as number | null);
  const { api, node } = useTip();

  const N = current.length;
  const S = Math.max(0, Math.min(W, H));
  // A card can be measured mid-resize; never let the radius go negative.
  const R = Math.max(0, S / 2 - 26);
  const C = S / 2;
  const angle = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  /** A low-order Fourier fit keeps the lobes round and even. */
  const normalise = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.map((v) => 0.42 + ((v - lo) / (hi - lo || 1)) * 0.58);
  };
  const fit = (values: number[]) => {
    const K = Math.min(5, Math.floor(N / 2));
    const coefficients: [number, number][] = [];
    for (let k = 0; k <= K; k++) {
      let a = 0;
      let b = 0;
      values.forEach((v, i) => {
        const theta = (i / N) * Math.PI * 2;
        a += v * Math.cos(k * theta);
        b += v * Math.sin(k * theta);
      });
      coefficients.push([(a * (k ? 2 : 1)) / N, (b * (k ? 2 : 1)) / N]);
    }
    return (theta: number) =>
      coefficients.reduce(
        (acc, [a, b], k) => acc + a * Math.cos(k * theta) + b * Math.sin(k * theta),
        0,
      );
  };
  const at = (f: (t: number) => number, theta: number): [number, number] => {
    const v = Math.max(0.05, f(theta));
    const a = -Math.PI / 2 + theta;
    return [
      C + Math.cos(a) * (R * 0.2 + v * R * 0.8),
      C + Math.sin(a) * (R * 0.2 + v * R * 0.8),
    ];
  };
  const shape = (values: number[]) => {
    const f = fit(normalise(values));
    let d = "";
    for (let j = 0; j <= 180; j++) {
      const p = at(f, (j / 180) * Math.PI * 2);
      d += (j ? "L" : "M") + p[0].toFixed(2) + "," + p[1].toFixed(2);
    }
    return d + "Z";
  };
  const point = (values: number[], i: number) =>
    at(fit(normalise(values)), (i / N) * Math.PI * 2);

  useEffect(() => {
    if (!S) return;
    const from = drawn.current ?? current.map(() => 1);
    const to = current;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = reduced ? 1 : ease(Math.min(1, (now - t0) / 900));
      drawn.current = from.map((v, i) => v + (to[i] - v) * t);
      line.current?.setAttribute("d", shape(drawn.current));
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, S, reduced]);

  const move = (event: ReactPointerEvent) => {
    const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = event.clientX - rect.left - C;
    const dy = event.clientY - rect.top - C;
    if (Math.hypot(dx, dy) < R * 0.2) {
      setHover(null);
      api.current?.hide();
      return;
    }
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    const i = Math.round((a / (Math.PI * 2)) * N) % N;
    const p = point(current, i);
    setHover(i);
    api.current?.show(rect.left + p[0], rect.top + p[1], {
      title: months[i],
      rows: [{ label: "Messages", value: fmt(current[i]), color: CHART_COLORS.lime }],
    });
  };

  const peak = current.indexOf(Math.max(...current));
  const hovered = hover !== null ? point(current, hover) : null;

  return (
    <ChartCard title={title} className="gap-2">
      <div ref={ref} className="relative min-h-0 flex-1">
        {R > 0 ? (
          <svg
            width={S}
            height={S}
            className="mx-auto block"
            role="img"
            aria-label={`${title}, peak in ${months[peak]}`}
          >
            {[0.33, 0.66, 1].map((k) => (
              <circle
                key={k}
                cx={C}
                cy={C}
                r={R * k}
                fill="none"
                className="stroke-border"
                strokeWidth={1}
              />
            ))}
            {months.map((month, i) => (
              <g key={month}>
                <line
                  x1={C + Math.cos(angle(i)) * R * 0.2}
                  y1={C + Math.sin(angle(i)) * R * 0.2}
                  x2={C + Math.cos(angle(i)) * R}
                  y2={C + Math.sin(angle(i)) * R}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={C + Math.cos(angle(i)) * (R + 15)}
                  y={C + Math.sin(angle(i)) * (R + 15)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  className="fill-muted-foreground"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {month}
                </text>
              </g>
            ))}
            {previous ? (
              <path
                d={shape(previous)}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth={1.2}
                strokeDasharray="3 3"
                opacity={0.5}
              />
            ) : null}
            <path
              ref={line}
              fill="none"
              strokeWidth={2.4}
              strokeLinejoin="round"
              style={{ stroke: CHART_COLORS.lime }}
            />
            <circle
              cx={C}
              cy={C}
              r={R * 0.2}
              className="fill-card stroke-border"
              strokeWidth={1}
            />
            <text
              x={C}
              y={C}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10.5}
              fontWeight={600}
              className="fill-muted-foreground"
              style={{ fontFamily: FONT_MONO }}
            >
              {fmt(current[peak])}
            </text>
            {hovered ? (
              <circle
                cx={hovered[0]}
                cy={hovered[1]}
                r={4}
                fill={CHART_COLORS.lime}
                className="stroke-card"
                strokeWidth={2}
              />
            ) : null}
            <rect
              width={S}
              height={S}
              fill="transparent"
              onPointerMove={move}
              onPointerLeave={() => {
                setHover(null);
                api.current?.hide();
              }}
            />
          </svg>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="size-1.5 rounded-full" style={{ background: CHART_COLORS.lime }} />
          This year
        </span>
        {previousLabel ? (
          <span className="inline-flex items-center gap-1.5">
            <i className="h-px w-3 bg-muted-foreground/60" />
            {previousLabel}
          </span>
        ) : null}
      </div>
      {node}
    </ChartCard>
  );
}

/* ---------------- multi-series trend ---------------- */

/**
 * Several lines sharing one axis and one x scale.
 *
 * The single-series `TrendCard` answers "how many"; this answers "which of
 * these is moving", which is what a template's sent/delivered/read curves are
 * for. The top of the axis is rounded up to a readable step so the gridlines
 * name numbers a human would have chosen.
 */
export function MultiTrendCard({
  title,
  meta,
  note,
  series,
  className,
}: {
  title: string;
  meta?: ReactNode;
  note?: string;
  /** One entry per line. Every line is drawn against the same x positions. */
  series: { label: string; color: string; points: Point[] }[];
  className?: string;
}) {
  const [ref, { w: W, h: H }] = useSize();
  const [hover, setHover] = useState(null as number | null);
  const { api, node } = useTip();

  const count = series.reduce((most, line) => Math.max(most, line.points.length), 0);
  const peak = series.reduce(
    (most, line) => Math.max(most, ...line.points.map((point) => point.value)),
    0,
  );
  const max = niceMax(peak);

  const padLeft = 38;
  const padRight = 14;
  const top = 10;
  const bottom = 22;
  const wide = Math.max(1, W - padLeft - padRight);
  const tall = Math.max(1, H - top - bottom);
  const x = (index: number) => padLeft + (index / Math.max(1, count - 1)) * wide;
  const y = (value: number) => top + (1 - value / max) * tall;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => Math.round(max * share));

  const move = (event: ReactPointerEvent) => {
    const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
    if (!svg || count === 0) return;

    const rect = svg.getBoundingClientRect();
    const index = Math.max(
      0,
      Math.min(
        count - 1,
        Math.round(((event.clientX - rect.left - padLeft) / wide) * (count - 1)),
      ),
    );

    setHover(index);
    api.current?.show(rect.left + x(index), rect.top + 12, {
      title: series[0]?.points[index]?.label ?? "",
      rows: series.map((line) => ({
        label: line.label,
        value: fmt(line.points[index]?.value ?? 0),
        color: line.color,
      })),
    });
  };

  return (
    <ChartCard title={title} meta={meta} className={cn("gap-2", className)}>
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-secondary/40">
        {W > 0 && H > 0 ? (
          <svg
            width={W}
            height={H}
            className="block"
            role="img"
            aria-label={`${title}: ${series.map((line) => line.label).join(", ")}`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={padLeft}
                  x2={W - padRight}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={padLeft - 8}
                  y={y(tick) + 3}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-muted-foreground"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {tick >= 1000 ? `${(tick / 1000).toFixed(tick % 1000 === 0 ? 0 : 1)}K` : tick}
                </text>
              </g>
            ))}

            {series.map((line) => {
              const points = line.points.map(
                (point, index) => [x(index), y(point.value)] as [number, number],
              );
              const last = points[points.length - 1];

              if (!last) return null;

              return (
                <g key={line.label}>
                  {/* Two or more points curve; a single day is a dot, not a path. */}
                  {points.length > 1 ? (
                    <path
                      d={smooth(points)}
                      fill="none"
                      stroke={line.color}
                      strokeWidth={2.2}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <circle
                    cx={last[0]}
                    cy={last[1]}
                    r={3}
                    fill={line.color}
                    className="stroke-card"
                    strokeWidth={1.5}
                  />
                </g>
              );
            })}

            {hover !== null ? (
              <g>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={top}
                  y2={H - bottom}
                  className="stroke-muted-foreground/40"
                  strokeWidth={1}
                />
                {series.map((line) => {
                  const point = line.points[hover];

                  return point ? (
                    <circle
                      key={line.label}
                      cx={x(hover)}
                      cy={y(point.value)}
                      r={3.5}
                      fill={line.color}
                      className="stroke-card"
                      strokeWidth={1.5}
                    />
                  ) : null;
                })}
              </g>
            ) : null}

            {/* Three date labels: the ends and the middle, so the window reads. */}
            {[0, Math.floor((count - 1) / 2), count - 1]
              .filter((index, at, all) => index >= 0 && all.indexOf(index) === at)
              .map((index) => (
                <text
                  key={index}
                  x={x(index)}
                  y={H - 6}
                  textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
                  fontSize={10}
                  className="fill-muted-foreground"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {series[0]?.points[index]?.label ?? ""}
                </text>
              ))}

            <rect
              width={W}
              height={H}
              fill="transparent"
              onPointerMove={move}
              onPointerLeave={() => {
                setHover(null);
                api.current?.hide();
              }}
            />
          </svg>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {series.map((line) => (
          <span key={line.label} className="inline-flex items-center gap-1.5">
            <i className="h-0.5 w-3 rounded-sm" style={{ background: line.color }} />
            {line.label}
          </span>
        ))}
        {note ? <span className="ml-auto">{note}</span> : null}
      </div>
      {node}
    </ChartCard>
  );
}

/** Rounds an axis top up to 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const step =
    [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value) ?? 10;

  return step * magnitude;
}

/* ---------------- KPI tile ---------------- */

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  accent = "brand",
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  accent?: "brand" | "blue" | "lime" | "muted";
}) {
  const tints: CSSProperties =
    accent === "brand"
      ? { background: "var(--brand-soft)", color: "var(--brand)" }
      : accent === "blue"
        ? { background: "var(--blue-soft)", color: "var(--blue)" }
        : accent === "lime"
          ? { background: "var(--lime-soft)", color: "var(--lime)" }
          : { background: "var(--secondary)", color: "var(--muted-foreground)" };

  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          {label}
        </p>
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg"
          style={tints}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <div>
        <p
          className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums"
          style={{ fontFamily: FONT_MONO }}
        >
          {value}
        </p>
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}
