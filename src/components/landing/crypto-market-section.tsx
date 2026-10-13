"use client";

import { Activity, ArrowDownRight, ArrowUpRight, ChartBar, Clock3, Layers, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Interactive crypto market board for the landing page (`/#market`).
 *
 * IMPORTANT: the candles, the order book and every statistic on this board are
 * generated locally as an illustration of the product surface. No exchange feed
 * is contacted, so the numbers are never presented as real market prices and no
 * figure here is a projection of program rewards. The section says so in plain
 * Indonesian right next to the chart.
 *
 * The component is a client component because it animates the price ticks, but
 * the first render is fully deterministic (seeded PRNG, no `Date.now()` and no
 * locale-dependent formatting), so the server-rendered HTML and the client
 * hydration produce byte-identical markup.
 */

/* ------------------------------------------------------------------ */
/* Market model                                                        */
/* ------------------------------------------------------------------ */

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface MarketPair {
  symbol: string;
  name: string;
  /** Base price the seeded series starts from. */
  base: number;
  /** Per-candle maximum swing as a fraction of the price. */
  volatility: number;
  /** Fixed decimal places so both server and client format identically. */
  digits: number;
  seed: number;
}

/**
 * The first entry is declared separately so `PAIRS[active] ?? FALLBACK_PAIR`
 * never needs a non-null assertion (`noUncheckedIndexedAccess` is enabled).
 */
const FALLBACK_PAIR: MarketPair = {
  symbol: "BTC/USDT",
  name: "Bitcoin",
  base: 96850,
  volatility: 0.0085,
  digits: 1,
  seed: 11,
};

const PAIRS: MarketPair[] = [
  FALLBACK_PAIR,
  { symbol: "ETH/USDT", name: "Ethereum", base: 3428.5, volatility: 0.0125, digits: 2, seed: 29 },
  { symbol: "BNB/USDT", name: "BNB", base: 712.4, volatility: 0.0115, digits: 2, seed: 47 },
  { symbol: "SOL/USDT", name: "Solana", base: 198.6, volatility: 0.0185, digits: 3, seed: 83 },
];

const CANDLE_COUNT = 72;
const MA_FAST = 7;
const MA_SLOW = 25;


/* ------------------------------------------------------------------ */
/* Deterministic generators                                            */
/* ------------------------------------------------------------------ */

/** Small, fast, seeded PRNG so the same pair always yields the same series. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeries(pair: MarketPair, count: number): Candle[] {
  const random = mulberry32(pair.seed);
  const candles: Candle[] = [];
  let last = pair.base;

  for (let index = 0; index < count; index += 1) {
    const open = last;
    const swing = (random() - 0.47) * pair.volatility * 2;
    const close = open * (1 + swing);
    const high = Math.max(open, close) * (1 + random() * pair.volatility * 0.5);
    const low = Math.min(open, close) * (1 - random() * pair.volatility * 0.5);
    candles.push({ o: open, h: high, l: low, c: close, v: 28 + random() * 78 });
    last = close;
  }

  return candles;
}

function buildMarket(): Record<string, Candle[]> {
  const market: Record<string, Candle[]> = {};
  for (const pair of PAIRS) {
    market[pair.symbol] = buildSeries(pair, CANDLE_COUNT);
  }
  return market;
}

/**
 * Nudges the newest candle on every tick and occasionally scrolls a fresh
 * candle in from the right. Only runs after mount, so `Math.random()` here can
 * never desynchronise server and client markup.
 */
function advanceSeries(series: Candle[], pair: MarketPair): Candle[] {
  const last = series.at(-1);
  if (!last) {
    return series;
  }

  const close = last.c * (1 + (Math.random() - 0.5) * pair.volatility * 0.7);

  if (Math.random() < 0.16) {
    const next = series.slice(1);
    next.push({ o: close, c: close, h: close, l: close, v: 14 + Math.random() * 26 });
    return next;
  }

  const next = series.slice();
  next[next.length - 1] = {
    o: last.o,
    c: close,
    h: Math.max(last.h, close),
    l: Math.min(last.l, close),
    v: last.v + Math.random() * 3,
  };
  return next;
}

/* ------------------------------------------------------------------ */
/* Formatting (locale-free so SSR and CSR always agree)                */
/* ------------------------------------------------------------------ */

function formatPrice(value: number, digits: number): string {
  const [whole = "0", fraction] = value.toFixed(digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(1);
}

/** 15-minute candles seeded from a fixed UTC minute, formatted as HH:MM. */
function candleLabel(index: number): string {
  const minutes = (9 * 60 + index * 15) % (24 * 60);
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

/** Mirrors the palette in `globals.css`; SVG gradients need literal colours. */
const COLOR_UP = "#2bff9c";
const COLOR_DOWN = "#ff5470";
const COLOR_GOLD = "#f6c453";
const COLOR_SLOW = "#7cc7ff";
const COLOR_INK = "#0b1118";
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/* ------------------------------------------------------------------ */
/* SVG canvas constants & geometry helpers                             */
/* ------------------------------------------------------------------ */

const VIEW_W = 1000;
const VIEW_H = 470;
const PAD_LEFT = 8;
const PAD_RIGHT = 78;
const PAD_TOP = 16;
const PRICE_H = 292;
const PRICE_GAP = 16;
const VOL_H = 60;

const PLOT_LEFT = PAD_LEFT;
const PLOT_RIGHT = VIEW_W - PAD_RIGHT;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PRICE_TOP = PAD_TOP;
const PRICE_BOTTOM = PRICE_TOP + PRICE_H;
const VOL_TOP = PRICE_BOTTOM + PRICE_GAP;
const VOL_BOTTOM = VOL_TOP + VOL_H;

interface Point {
  x: number;
  y: number;
}

function linePath(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function areaPath(points: Point[], baseline: number): string {
  const head = points[0];
  const tail = points.at(-1);
  if (!head || !tail) {
    return "";
  }
  return `${linePath(points)} L${tail.x.toFixed(2)} ${baseline.toFixed(2)} L${head.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

/** Simple moving average of closes; returns `{ x: candleIndex, y: average }`. */
function movingAverage(candles: Candle[], window: number): Point[] {
  const points: Point[] = [];
  for (let index = window - 1; index < candles.length; index += 1) {
    let sum = 0;
    for (let cursor = index - window + 1; cursor <= index; cursor += 1) {
      sum += candles[cursor]?.c ?? 0;
    }
    points.push({ x: index, y: sum / window });
  }
  return points;
}

interface BookLevel {
  price: number;
  size: number;
  /** Normalised 0..1 fill for the depth bar behind the row. */
  depth: number;
}

/** Deterministic order book so SSR and hydration match exactly. */
function buildOrderBook(price: number, side: "ask" | "bid", levels = 7): BookLevel[] {
  const rows: BookLevel[] = [];
  for (let index = 0; index < levels; index += 1) {
    const step = (index + 1) * 0.00048;
    const level = side === "ask" ? price * (1 + step) : price * (1 - step);
    const wave = (Math.sin((index + 1) * 1.9) + 1) / 2;
    const size = 0.42 + wave * 2.6;
    rows.push({ price: level, size, depth: (levels - index) / levels });
  }
  return rows;
}


/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CryptoMarketSection() {
  const [activePair, setActivePair] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [market, setMarket] = useState<Record<string, Candle[]>>(() => buildMarket());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarket((previous) => {
        const next: Record<string, Candle[]> = { ...previous };
        for (const entry of PAIRS) {
          const series = next[entry.symbol];
          if (series && series.length > 0) {
            next[entry.symbol] = advanceSeries(series, entry);
          }
        }
        return next;
      });
    }, 1500);

    return () => window.clearInterval(timer);
  }, []);

  const pair = PAIRS[activePair] ?? FALLBACK_PAIR;
  /**
   * Memoised so the array identity only changes when the ticker actually swaps
   * the series out; otherwise the `view` memo would recompute every render.
   */
  const candles = useMemo(() => market[pair.symbol] ?? [], [market, pair.symbol]);

  const view = useMemo(() => {
    const last = candles.at(-1) ?? null;
    const first = candles[0] ?? null;

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let volume = 0;
    let maxVolume = 0;
    for (const candle of candles) {
      high = Math.max(high, candle.h);
      low = Math.min(low, candle.l);
      volume += candle.v;
      maxVolume = Math.max(maxVolume, candle.v);
    }
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      high = pair.base;
      low = pair.base;
    }

    const span = high - low || pair.base * 0.01;
    const yMax = high + span * 0.12;
    const yMin = low - span * 0.12;
    const range = yMax - yMin || 1;

    const slot = candles.length > 0 ? PLOT_WIDTH / candles.length : PLOT_WIDTH;
    const candleWidth = Math.max(2, Math.min(14, slot * 0.58));

    const xFor = (index: number) => PLOT_LEFT + slot * index + slot / 2;
    const priceToY = (value: number) => PRICE_TOP + ((yMax - value) / range) * PRICE_H;
    const volToH = (value: number) => (maxVolume === 0 ? 0 : (value / maxVolume) * VOL_H);

    const closePoints = candles.map((candle, index) => ({ x: xFor(index), y: priceToY(candle.c) }));
    const fastPoints = movingAverage(candles, MA_FAST).map((point) => ({
      x: xFor(point.x),
      y: priceToY(point.y),
    }));
    const slowPoints = movingAverage(candles, MA_SLOW).map((point) => ({
      x: xFor(point.x),
      y: priceToY(point.y),
    }));

    const lastClose = last?.c ?? pair.base;
    const firstOpen = first?.o ?? pair.base;
    const changePct = firstOpen === 0 ? 0 : ((lastClose - firstOpen) / firstOpen) * 100;

    const priceTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      return { y: PRICE_TOP + ratio * PRICE_H, value: yMax - ratio * range };
    });

    const timeTicks = candles
      .map((_, index) => index)
      .filter((index) => index % 12 === 0)
      .map((index) => ({ x: xFor(index), label: candleLabel(index) }));

    return {
      candleWidth,
      slot,
      xFor,
      priceToY,
      volToH,
      closePath: linePath(closePoints),
      areaPath: areaPath(closePoints, PRICE_BOTTOM),
      fastPath: linePath(fastPoints),
      slowPath: linePath(slowPoints),
      priceTicks,
      timeTicks,
      lastClose,
      changePct,
      isUp: changePct >= 0,
      high,
      low,
      volume,
      digits: pair.digits,
      lastY: priceToY(lastClose),
    };
  }, [candles, pair]);


  const book = useMemo(
    () => ({
      asks: buildOrderBook(view.lastClose, "ask"),
      bids: buildOrderBook(view.lastClose, "bid"),
    }),
    [view.lastClose],
  );

  const hovered = hoverIndex === null ? null : candles[hoverIndex] ?? null;
  const hoverX = hoverIndex === null ? 0 : view.xFor(hoverIndex);
  const hoverY = hovered ? view.priceToY(hovered.c) : 0;
  const tooltipX = hoverX > PLOT_RIGHT - 236 ? hoverX - 220 : hoverX + 16;

  function handlePointerMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || candles.length === 0) {
      return;
    }
    const xInView = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const index = Math.round((xInView - PLOT_LEFT - view.slot / 2) / view.slot);
    setHoverIndex(Math.min(candles.length - 1, Math.max(0, index)));
  }

  return (
    <section id="market" className="relative overflow-hidden border-b border-white/10 py-20">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" aria-hidden />
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[38rem] -translate-x-1/2 rounded-full bg-[var(--color-neon)]/10 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-6xl px-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Badge>
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[var(--color-neon)] opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-[var(--color-neon)]" />
              </span>
              Papan Pasar · Simulasi
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Pergerakan pasar dalam satu layar,{" "}
              <span className="text-neon">candlestick</span> yang hidup.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-white/65">
              Papan ini memperlihatkan cara membaca pasar kripto: candlestick, rata-rata bergerak,
              volume, dan kedalaman order book. Seluruh angka dibangkitkan untuk memperagakan
              tampilan, bukan harga pasar nyata.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Clock3 className="size-4 text-[var(--color-gold)]" aria-hidden />
            Satu candle mewakili 15 menit
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.72fr_1fr]">

          <Card className="card-glow overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                {PAIRS.map((entry, index) => (
                  <button
                    key={entry.symbol}
                    type="button"
                    onClick={() => {
                      setActivePair(index);
                      setHoverIndex(null);
                    }}
                    aria-pressed={index === activePair}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      index === activePair
                        ? "bg-[var(--color-neon)] text-[#04120a] shadow-[0_0_18px_-6px_var(--color-neon)]"
                        : "text-white/60 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {entry.symbol.replace("/USDT", "")}
                    <span className="text-[10px] font-normal opacity-70">/USDT</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-white/45">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-4 rounded-full"
                    style={{ backgroundColor: COLOR_GOLD }}
                    aria-hidden
                  />
                  MA{MA_FAST}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-4 rounded-full"
                    style={{ backgroundColor: COLOR_SLOW }}
                    aria-hidden
                  />
                  MA{MA_SLOW}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-5">
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-sm text-white/60">
                  <span className="font-semibold text-white">{pair.name}</span>
                  <span className="font-mono text-xs text-white/45">{pair.symbol}</span>
                </p>
                <div className="flex items-baseline gap-3">
                  <span
                    className={cn(
                      "font-mono text-3xl font-semibold tracking-tight transition-colors duration-500",
                      view.isUp ? "text-[var(--color-neon)]" : "text-[#ff5470]",
                    )}
                  >
                    {formatPrice(view.lastClose, view.digits)}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold",
                      view.isUp
                        ? "bg-[var(--color-neon)]/12 text-[var(--color-neon)]"
                        : "bg-[#ff5470]/12 text-[#ff5470]",
                    )}
                  >
                    {view.isUp ? (
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowDownRight className="size-3.5" aria-hidden />
                    )}
                    {formatPercent(view.changePct)}
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-white/40">Tertinggi</dt>
                  <dd className="font-mono font-semibold text-white">
                    {formatPrice(view.high, view.digits)}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/40">Terendah</dt>
                  <dd className="font-mono font-semibold text-white">
                    {formatPrice(view.low, view.digits)}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/40">Volume</dt>
                  <dd className="font-mono font-semibold text-white">{formatCompact(view.volume)}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Rentang</dt>
                  <dd className="font-mono font-semibold text-[var(--color-gold)]">
                    {formatPercent(((view.high - view.low) / (view.low || 1)) * 100)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-4 px-2 pb-3">
              <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                className="h-auto w-full touch-none select-none"
                role="img"
                aria-label={`Grafik candlestick simulasi untuk ${pair.symbol}`}
                onMouseMove={handlePointerMove}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <defs>
                  <linearGradient id="market-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR_UP} stopOpacity={0.34} />
                    <stop offset="55%" stopColor={COLOR_UP} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={COLOR_UP} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="market-volume-up" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR_UP} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLOR_UP} stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="market-volume-down" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR_DOWN} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLOR_DOWN} stopOpacity={0.08} />
                  </linearGradient>
                  <filter id="market-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {view.priceTicks.map((tick) => (
                  <g key={`grid-${tick.value.toFixed(2)}`}>
                    <line
                      x1={PLOT_LEFT}
                      x2={PLOT_RIGHT}
                      y1={tick.y}
                      y2={tick.y}
                      stroke="#ffffff"
                      strokeOpacity={0.07}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={PLOT_RIGHT + 10}
                      y={tick.y + 5}
                      fontSize={14}
                      fill="#ffffff"
                      fillOpacity={0.45}
                      fontFamily={MONO_FONT}
                    >
                      {formatPrice(tick.value, view.digits)}
                    </text>
                  </g>
                ))}

                {view.timeTicks.map((tick) => (
                  <g key={`time-${tick.label}`}>
                    <line
                      x1={tick.x}
                      x2={tick.x}
                      y1={PRICE_TOP}
                      y2={VOL_BOTTOM}
                      stroke="#ffffff"
                      strokeOpacity={0.05}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={tick.x}
                      y={VOL_BOTTOM + 26}
                      fontSize={13}
                      fill="#ffffff"
                      fillOpacity={0.4}
                      textAnchor="middle"
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}

                <path d={view.areaPath} fill="url(#market-area)" />

                {candles.map((candle, index) => {
                  const height = Math.max(1, view.volToH(candle.v));
                  return (
                    <rect
                      key={`vol-${index}`}
                      x={view.xFor(index) - view.candleWidth / 2}
                      y={VOL_BOTTOM - height}
                      width={view.candleWidth}
                      height={height}
                      rx={0.8}
                      fill={candle.c >= candle.o ? "url(#market-volume-up)" : "url(#market-volume-down)"}
                    />
                  );
                })}



                {candles.map((candle, index) => {
                  const isUp = candle.c >= candle.o;
                  const color = isUp ? COLOR_UP : COLOR_DOWN;
                  const x = view.xFor(index);
                  const top = view.priceToY(Math.max(candle.o, candle.c));
                  const bottom = view.priceToY(Math.min(candle.o, candle.c));
                  return (
                    <g key={`candle-${index}`}>
                      <line
                        x1={x}
                        x2={x}
                        y1={view.priceToY(candle.h)}
                        y2={view.priceToY(candle.l)}
                        stroke={color}
                        strokeWidth={1.2}
                        opacity={0.9}
                        vectorEffect="non-scaling-stroke"
                      />
                      <rect
                        x={x - view.candleWidth / 2}
                        y={top}
                        width={view.candleWidth}
                        height={Math.max(1.2, bottom - top)}
                        rx={1}
                        fill={color}
                        opacity={index === candles.length - 1 ? 1 : 0.94}
                      />
                    </g>
                  );
                })}

                <path
                  d={view.slowPath}
                  fill="none"
                  stroke={COLOR_SLOW}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                  opacity={0.85}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={view.fastPath}
                  fill="none"
                  stroke={COLOR_GOLD}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={view.closePath}
                  fill="none"
                  stroke={view.isUp ? COLOR_UP : COLOR_DOWN}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  opacity={0.9}
                  vectorEffect="non-scaling-stroke"
                />

                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={view.lastY}
                  y2={view.lastY}
                  stroke={view.isUp ? COLOR_UP : COLOR_DOWN}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.55}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={PLOT_RIGHT + 4}
                  y={view.lastY - 11}
                  width={PAD_RIGHT - 8}
                  height={22}
                  rx={5}
                  fill={view.isUp ? COLOR_UP : COLOR_DOWN}
                />
                <text
                  x={PLOT_RIGHT + PAD_RIGHT / 2}
                  y={view.lastY + 5}
                  fontSize={14}
                  fontWeight={700}
                  fill="#04120a"
                  textAnchor="middle"
                  fontFamily={MONO_FONT}
                >
                  {formatPrice(view.lastClose, view.digits)}
                </text>


                {hovered ? (
                  <g pointerEvents="none">
                    <line
                      x1={hoverX}
                      x2={hoverX}
                      y1={PRICE_TOP}
                      y2={VOL_BOTTOM}
                      stroke="#ffffff"
                      strokeOpacity={0.3}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={PLOT_LEFT}
                      x2={PLOT_RIGHT}
                      y1={hoverY}
                      y2={hoverY}
                      stroke="#ffffff"
                      strokeOpacity={0.3}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={PLOT_RIGHT + 4}
                      y={hoverY - 11}
                      width={PAD_RIGHT - 8}
                      height={22}
                      rx={5}
                      fill="#1d2632"
                      stroke="#ffffff"
                      strokeOpacity={0.18}
                    />
                    <text
                      x={PLOT_RIGHT + PAD_RIGHT / 2}
                      y={hoverY + 5}
                      fontSize={14}
                      fontWeight={700}
                      fill="#ffffff"
                      textAnchor="middle"
                      fontFamily={MONO_FONT}
                    >
                      {formatPrice(hovered.c, view.digits)}
                    </text>

                    <g transform={`translate(${tooltipX}, ${PRICE_TOP + 10})`}>
                      <rect
                        width={204}
                        height={140}
                        rx={10}
                        fill={COLOR_INK}
                        stroke="#ffffff"
                        strokeOpacity={0.15}
                      />
                      <text
                        x={14}
                        y={24}
                        fontSize={13}
                        fontWeight={700}
                        fill={hovered.c >= hovered.o ? COLOR_UP : COLOR_DOWN}
                      >
                        {pair.symbol}
                      </text>
                      <text
                        x={190}
                        y={24}
                        fontSize={12}
                        fill="#ffffff"
                        fillOpacity={0.45}
                        textAnchor="end"
                      >
                        {hoverIndex === null ? "" : candleLabel(hoverIndex)}
                      </text>
                      {(["Buka", "Tertinggi", "Terendah", "Tutup"] as const).map((label, row) => {
                        const values = [hovered.o, hovered.h, hovered.l, hovered.c];
                        const value = values[row] ?? hovered.c;
                        return (
                          <g key={label}>
                            <text x={14} y={50 + row * 18} fontSize={13} fill="#ffffff" fillOpacity={0.5}>
                              {label}
                            </text>
                            <text
                              x={190}
                              y={50 + row * 18}
                              fontSize={13}
                              fill="#ffffff"
                              textAnchor="end"
                              fontFamily={MONO_FONT}
                            >
                              {formatPrice(value, view.digits)}
                            </text>
                          </g>
                        );
                      })}
                      <text x={14} y={122} fontSize={13} fill="#ffffff" fillOpacity={0.5}>
                        Volume
                      </text>
                      <text
                        x={190}
                        y={122}
                        fontSize={13}
                        fill={COLOR_GOLD}
                        textAnchor="end"
                        fontFamily={MONO_FONT}
                      >
                        {formatCompact(hovered.v)}
                      </text>
                    </g>
                  </g>
                ) : null}
              </svg>
            </div>
          </Card>


          <div className="space-y-5">
            <Card className="card-glow">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <Layers className="size-5 text-[var(--color-neon)]" aria-hidden />
                  Kedalaman pasar
                </CardTitle>
                <Badge variant="muted">Simulasi</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                  <span>Harga</span>
                  <span className="text-right">Jumlah</span>
                  <span className="text-right">Total</span>
                </div>

                <div className="space-y-1">
                  {book.asks.map((level, index) => (
                    <BookRow key={`ask-${index}`} level={level} side="ask" digits={view.digits} />
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      view.isUp ? "text-[var(--color-neon)]" : "text-[#ff5470]",
                    )}
                  >
                    {formatPrice(view.lastClose, view.digits)}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs font-semibold",
                      view.isUp ? "text-[var(--color-neon)]" : "text-[#ff5470]",
                    )}
                  >
                    {view.isUp ? (
                      <TrendingUp className="size-3.5" aria-hidden />
                    ) : (
                      <Activity className="size-3.5" aria-hidden />
                    )}
                    {formatPercent(view.changePct)}
                  </span>
                </div>

                <div className="space-y-1">
                  {book.bids.map((level, index) => (
                    <BookRow key={`bid-${index}`} level={level} side="bid" digits={view.digits} />
                  ))}
                </div>

                <p className="text-xs leading-relaxed text-white/45">
                  Kedalaman order book dibangkitkan secara lokal untuk latihan membaca pasar. Tidak ada
                  order nyata yang dipasang di sini.
                </p>
              </CardContent>
            </Card>

            <Card className="card-glow">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <ChartBar className="size-5 text-[var(--color-gold)]" aria-hidden />
                  Ringkasan sesi
                </CardTitle>
                <Badge variant="muted">{pair.symbol.replace("/USDT", "")}</Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Metric label="Tertinggi" value={formatPrice(view.high, view.digits)} tone="up" />
                <Metric label="Terendah" value={formatPrice(view.low, view.digits)} tone="down" />
                <Metric label="Volume" value={formatCompact(view.volume)} tone="gold" />
                <Metric
                  label="Perubahan"
                  value={formatPercent(view.changePct)}
                  tone={view.isUp ? "up" : "down"}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-white/45">
          Seluruh harga, volume, dan kedalaman pasar pada papan ini adalah data simulasi yang
          dibangkitkan di peramban untuk keperluan tampilan. Papan ini bukan layanan perdagangan,
          tidak menerima order, dan tidak menampilkan harga pasar nyata. Tidak ada jaminan hasil
          finansial dari program maupun dari papan simulasi ini.
        </p>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

const METRIC_TONES: Record<"up" | "down" | "gold" | "muted", string> = {
  up: "text-[var(--color-neon)]",
  down: "text-[#ff5470]",
  gold: "text-[var(--color-gold)]",
  muted: "text-white",
};

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: keyof typeof METRIC_TONES;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className={cn("mt-1 font-mono text-sm font-semibold", METRIC_TONES[tone])}>{value}</p>
    </div>
  );
}

function BookRow({
  level,
  side,
  digits,
}: {
  level: BookLevel;
  side: "ask" | "bid";
  digits: number;
}) {
  const color = side === "ask" ? COLOR_DOWN : COLOR_UP;
  const total = level.price * level.size;

  return (
    <div className="relative grid grid-cols-3 gap-2 overflow-hidden rounded-md px-2 py-[3px] font-mono text-[11px]">
      <span
        className="absolute inset-y-0 right-0"
        style={{ width: `${level.depth * 100}%`, backgroundColor: color, opacity: 0.14 }}
        aria-hidden
      />
      <span className="relative" style={{ color }}>
        {formatPrice(level.price, digits)}
      </span>
      <span className="relative text-right text-white/70">{level.size.toFixed(3)}</span>
      <span className="relative text-right text-white/45">{formatCompact(total)}</span>
    </div>
  );
}

