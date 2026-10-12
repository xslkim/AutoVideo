/**
 * AutoVideo — Library component: ChartGrow
 *
 * Growing data chart for trend narratives: axes and nice-step gridlines wipe
 * in with a stagger, then the series grows — line/area strokes draw
 * themselves via evolvePath (dots popping as the stroke reaches them), bars
 * spring up from the baseline with overshoot. After the draw, the key point
 * of every series (max / min / last) gets a pulsing ring and a value
 * callout. The narration beat (lineTimings, or an even rhythm when empty)
 * sweeps a guide across the categories. Coordinates auto-fit the canvas and
 * the data range.
 * Registry entry: see src/ai/visual-registry.ts ("ChartGrow").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import {
  EASE,
  activeIndexAt,
  breathe,
  clamp01,
  enterProgress,
  resolveBeatSchedule,
  springIn,
} from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface ChartGrowSeries {
  /** Legend name; set it when more than one series is plotted. */
  name?: string;
  /** One value per xLabels category; shorter arrays repeat their last value. */
  data: number[];
  /** Per-series colour override; defaults to the chart palette. */
  color?: string;
}

export interface ChartGrowSpec extends AccentOverride {
  /** line / area strokes draw themselves on; bars rise from the baseline. */
  type: "line" | "bar" | "area";
  /** 1–3 series. */
  series: ChartGrowSeries[];
  /** 2–12 short category labels, matched by index to each series' data. */
  xLabels: string[];
  /** Small mono heading pinned top-left, e.g. "逐月吞吐量". */
  title?: string;
  /** Which key point of each series gets the callout. Default "max". */
  highlight?: "max" | "min" | "last";
}

export type ChartGrowProps = LibraryProps<ChartGrowSpec>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round `raw` to a 1 / 2 / 2.5 / 5 × 10^k step for readable axis ticks. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}

/** Stable per-instance SVG id so multiple charts never share gradient ids. */
function uid(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Axis / callout number format: integers stay bare, others keep one decimal. */
function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChartGrow: React.FC<ChartGrowProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
  lineTimings,
  spec,
}) => {
  const accent = spec.accent ?? theme.colors.accent;
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;

  const n = spec.xLabels.length;
  const seriesList: ChartGrowSeries[] =
    spec.series.length > 0 ? spec.series : [{ data: new Array(n).fill(0) }];
  const sc = seriesList.length;
  const highlight = spec.highlight ?? "max";
  const isBar = spec.type === "bar";

  // Normalise every series to exactly n points (pad with the last value).
  const data: number[][] = seriesList.map((s) =>
    Array.from(
      { length: n },
      (_, i) => s.data[i] ?? s.data[s.data.length - 1] ?? 0,
    ),
  );

  // ---- Y scale with nice ticks ---------------------------------------------
  const flat = data.flat();
  const dataMin = flat.length > 0 ? Math.min(...flat) : 0;
  const dataMax = flat.length > 0 ? Math.max(...flat) : 1;
  const step = niceStep(Math.abs(dataMax - dataMin) / 4 || 1);
  const yMin = Math.min(0, Math.floor(dataMin / step) * step);
  let yMax = Math.ceil(dataMax / step) * step;
  if (yMax <= yMin) yMax = yMin + step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step * 1e-6 && ticks.length < 8; v += step) {
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }

  // ---- Geometry --------------------------------------------------------------
  const headingSize = typeSize(height, "label");
  const tickSize = typeSize(height, "caption");
  const chipSize = typeSize(height, "caption");

  const plotLeft = marginX + width * 0.052;
  const plotRight = width - marginX - width * 0.012;
  const plotTop = availH * (spec.title || sc > 1 ? 0.24 : 0.2);
  const plotBottom = availH * 0.8;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  const yOf = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin)) * plotH;
  const baselineY = yOf(Math.min(Math.max(0, yMin), yMax));
  const xOf = (i: number) =>
    n > 1 ? plotLeft + (plotW * i) / (n - 1) : plotLeft + plotW / 2;

  // Bar layout: grouped bars centred in each category slot.
  const slotW = plotW / Math.max(1, n);
  const groupW = slotW * 0.58;
  const barGap = Math.max(2, height * 0.002);
  const barW = Math.min(space(height, 6), (groupW - barGap * (sc - 1)) / sc);
  const groupBarsW = sc * barW + (sc - 1) * barGap;
  const groupCx = (i: number) => plotLeft + slotW * (i + 0.5);
  const barX = (i: number, s: number) =>
    groupCx(i) - groupBarsW / 2 + s * (barW + barGap);

  const palette = [
    accent,
    theme.colors.code.string,
    theme.colors.code.keyword,
    theme.colors.fg,
  ];
  const seriesColor = (s: number) =>
    seriesList[s].color ?? palette[s % palette.length];

  // ---- Narration beat over categories ---------------------------------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, n, durationSec);
  const active = activeIndexAt(schedule, frame / fps);

  // ---- Beat timeline (block-relative frames) ----------------------------------
  const t0 = frames(0.1, fps);
  const axisP = enterProgress(frame, t0, frames(DUR.enterSec, fps));
  const tickStepF = frames(0.07, fps);
  const xStepF = frames(DUR.staggerDenseSec, fps);
  const tSeries = t0 + frames(0.5, fps);
  const drawDur = frames(DUR.heroSec + 0.2, fps);
  const seriesGapF = frames(0.35, fps);
  const barStepF = frames(0.08, fps);
  const barSeriesF = frames(0.06, fps);
  const tHighlight = isBar
    ? tSeries + n * barStepF + frames(0.55, fps)
    : tSeries + (sc - 1) * seriesGapF + drawDur + frames(0.15, fps);

  const headingP = clamp01(springIn(frame, fps, 0, "gentle"));
  const guideP = enterProgress(frame, tSeries, frames(DUR.snapSec, fps));

  // ---- Line/area path geometry -------------------------------------------------
  const strokeW = Math.max(2.5, height * 0.0035);
  const dotR = Math.max(3.5, height * 0.005);
  const uidBase = uid(
    `${spec.type}|${spec.title ?? ""}|${seriesList.map((s) => s.name ?? "").join(",")}`,
  );

  const seriesGeom = data.map((vals) => {
    const pts = vals.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(
        cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y),
      );
    }
    const total = cum[cum.length - 1] || 1;
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${baselineY.toFixed(
      1,
    )} L ${pts[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
    return { pts, cum, total, line, area };
  });

  /** Index of the narrated key point within one series. */
  const hlIndex = (vals: number[]): number => {
    if (highlight === "last") return vals.length - 1;
    let idx = 0;
    for (let i = 1; i < vals.length; i++) {
      if (highlight === "max" ? vals[i] > vals[idx] : vals[i] < vals[idx]) idx = i;
    }
    return idx;
  };

  /** Centre of a series' highlighted mark, for both bar and point layouts. */
  const hlPoint = (s: number): { x: number; y: number; v: number } => {
    const idx = hlIndex(data[s]);
    const v = data[s][idx];
    return isBar
      ? { x: barX(idx, s) + barW / 2, y: yOf(v), v }
      : { x: seriesGeom[s].pts[idx].x, y: seriesGeom[s].pts[idx].y, v };
  };

  const chipW = width * 0.07;
  const chipH = chipSize * 1.9;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, bottom-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 85% 82%, ${accent} 0%, transparent 55%)`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />

      {/* Heading */}
      {spec.title ? (
        <div
          style={{
            position: "absolute",
            top: availH * 0.115,
            left: marginX,
            display: "flex",
            alignItems: "center",
            gap: space(height, 2),
            opacity: headingP,
            transform: `translateY(${(1 - headingP) * space(height, 1.5)}px)`,
          }}
        >
          <div
            style={{
              width: space(height, 1),
              height: headingSize * 1.1,
              backgroundColor: accent,
              borderRadius: 1,
            }}
          />
          <div
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: headingSize,
              letterSpacing: "0.14em",
              color: theme.colors.muted,
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            {spec.title}
          </div>
        </div>
      ) : null}

      {/* Legend (multi-series only) */}
      {sc > 1 ? (
        <div
          style={{
            position: "absolute",
            top: availH * 0.115,
            right: marginX,
            display: "flex",
            gap: space(height, 2.5),
          }}
        >
          {seriesList.map((s, i) => {
            const lp = clamp01(
              springIn(frame, fps, t0 + frames(0.25, fps) + i * frames(0.08, fps), "snappy"),
            );
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space(height, 1),
                  opacity: lp,
                  transform: `translateY(${(1 - lp) * space(height, 1)}px)`,
                }}
              >
                <div
                  style={{
                    width: space(height, 1.6),
                    height: space(height, 1.6),
                    borderRadius: 2,
                    backgroundColor: seriesColor(i),
                  }}
                />
                <div
                  style={{
                    fontFamily: theme.fonts.sans,
                    fontSize: tickSize,
                    lineHeight: 1.3,
                    color: theme.colors.muted,
                  }}
                >
                  {s.name ?? `系列${i + 1}`}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Chart layer */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          {spec.type === "area"
            ? seriesList.map((_, s) => (
                <linearGradient
                  key={s}
                  id={`cg-fill-${uidBase}-${s}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={seriesColor(s)} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={seriesColor(s)} stopOpacity={0} />
                </linearGradient>
              ))
            : null}
        </defs>

        {/* Gridlines wiping left → right, staggered bottom-up */}
        {ticks.map((t, i) => {
          const p = enterProgress(
            frame,
            t0 + i * tickStepF,
            frames(DUR.enterSec, fps),
          );
          const y = yOf(t);
          return (
            <g key={i}>
              <line
                x1={plotLeft}
                y1={y}
                x2={plotRight}
                y2={y}
                stroke={theme.colors.muted}
                strokeWidth={Math.max(1, height * 0.0011)}
                opacity={0.16}
                strokeDasharray={plotW}
                strokeDashoffset={(1 - p) * plotW}
              />
              <text
                x={plotLeft - space(height, 1)}
                y={y + tickSize * 0.35}
                textAnchor="end"
                fontFamily={theme.fonts.mono}
                fontSize={tickSize}
                fill={theme.colors.muted}
                opacity={p * 0.9}
              >
                {fmt(t)}
              </text>
            </g>
          );
        })}

        {/* Axes drawing themselves out of the origin corner */}
        <line
          x1={plotLeft}
          y1={plotTop}
          x2={plotLeft}
          y2={plotBottom}
          stroke={theme.colors.muted}
          strokeWidth={Math.max(1.5, height * 0.0016)}
          opacity={0.55}
          strokeDasharray={plotH}
          strokeDashoffset={(1 - axisP) * plotH}
        />
        <line
          x1={plotLeft}
          y1={plotBottom}
          x2={plotRight}
          y2={plotBottom}
          stroke={theme.colors.muted}
          strokeWidth={Math.max(1.5, height * 0.0016)}
          opacity={0.55}
          strokeDasharray={plotW}
          strokeDashoffset={(1 - axisP) * plotW}
        />

        {/* X category labels, dense stagger */}
        {spec.xLabels.map((label, i) => {
          const p = enterProgress(
            frame,
            t0 + frames(0.2, fps) + i * xStepF,
            frames(DUR.snapSec, fps),
          );
          return (
            <text
              key={i}
              x={isBar ? groupCx(i) : xOf(i)}
              y={plotBottom + space(height, 3)}
              textAnchor="middle"
              fontFamily={theme.fonts.mono}
              fontSize={tickSize}
              fill={i === active ? theme.colors.fg : theme.colors.muted}
              opacity={p}
            >
              {label}
            </text>
          );
        })}

        {/* Narration guide sweeping the categories (line / area) */}
        {!isBar && active >= 0 ? (
          <line
            x1={xOf(active)}
            y1={plotTop}
            x2={xOf(active)}
            y2={plotBottom}
            stroke={accent}
            strokeWidth={Math.max(1.5, height * 0.0014)}
            strokeDasharray={`${space(height, 0.8)} ${space(height, 0.8)}`}
            opacity={0.3 * guideP}
          />
        ) : null}

        {/* Series: bars rising from the baseline */}
        {isBar
          ? data.map((vals, s) =>
              vals.map((v, i) => {
                const raw = springIn(
                  frame,
                  fps,
                  tSeries + i * barStepF + s * barSeriesF,
                  "snappy",
                );
                const p = Math.max(0, raw);
                const fullH = Math.abs(yOf(v) - baselineY);
                const h = fullH * p;
                const isActive = i === active;
                return (
                  <rect
                    key={`${s}-${i}`}
                    x={barX(i, s)}
                    y={v >= 0 ? baselineY - h : baselineY}
                    width={barW}
                    height={h}
                    rx={Math.min(4, barW * 0.12)}
                    fill={seriesColor(s)}
                    opacity={clamp01(raw) * (isActive ? 1 : 0.72)}
                  />
                );
              }),
            )
          : null}

        {/* Series: line / area drawing itself on */}
        {!isBar
          ? data.map((_, s) => {
              const geom = seriesGeom[s];
              const drawDelay = tSeries + s * seriesGapF;
              const drawP = enterProgress(frame, drawDelay, drawDur, EASE.inOut);
              const dash = evolvePath(drawP, geom.line);
              const color = seriesColor(s);
              const fillP =
                spec.type === "area"
                  ? enterProgress(
                      frame,
                      drawDelay + drawDur * 0.55,
                      frames(DUR.enterSec, fps),
                    )
                  : 0;
              return (
                <g key={s}>
                  {spec.type === "area" ? (
                    <path
                      d={geom.area}
                      fill={`url(#cg-fill-${uidBase}-${s})`}
                      opacity={fillP}
                    />
                  ) : null}
                  <path
                    d={geom.line}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={dash.strokeDasharray}
                    strokeDashoffset={dash.strokeDashoffset}
                  />
                  {/* Dots pop as the stroke tip reaches them */}
                  {geom.pts.map((pt, i) => {
                    const dotDelay = drawDelay + (geom.cum[i] / geom.total) * drawDur;
                    const dotP = springIn(frame, fps, dotDelay, "pop");
                    return (
                      <circle
                        key={i}
                        cx={pt.x}
                        cy={pt.y}
                        r={dotR * Math.max(0, dotP)}
                        fill={color}
                        opacity={clamp01(dotP)}
                      />
                    );
                  })}
                </g>
              );
            })
          : null}

        {/* Key-point rings after the draw completes */}
        {data.map((_, s) => {
          const pt = hlPoint(s);
          const ringP = clamp01(
            springIn(frame, fps, tHighlight + s * frames(0.12, fps), "pop"),
          );
          const ringPulse = breathe(frame, fps, {
            min: 0.35,
            max: 0.85,
            periodSec: 2.2,
            phase: s * 0.3,
          });
          const color = seriesColor(s);
          return (
            <g key={`hl-${s}`} opacity={ringP}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={dotR * (1.9 + ringPulse * 0.5)}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(1.5, height * 0.0016)}
                opacity={ringPulse}
              />
              <circle cx={pt.x} cy={pt.y} r={dotR * 1.25} fill={color} />
            </g>
          );
        })}
      </svg>

      {/* Value callouts (HTML layer, above the SVG) */}
      {data.map((vals, s) => {
        const pt = hlPoint(s);
        const ringP = clamp01(
          springIn(frame, fps, tHighlight + s * frames(0.12, fps), "pop"),
        );
        const above = pt.y - chipH - dotR * 2 > plotTop - space(height, 2);
        const cx = Math.min(
          Math.max(pt.x, marginX + chipW / 2),
          width - marginX - chipW / 2,
        );
        return (
          <div
            key={`chip-${s}`}
            style={{
              position: "absolute",
              left: cx,
              top: pt.y,
              transform: `translate(-50%, ${above ? "-135%" : "45%"}) scale(${
                0.7 + 0.3 * ringP
              })`,
              padding: `${space(height, 0.75)}px ${space(height, 1.5)}px`,
              backgroundColor: theme.colors.code.bg,
              border: `${Math.max(1.5, height * 0.0014)}px solid ${seriesColor(s)}`,
              borderRadius: space(height, 1),
              fontFamily: theme.fonts.mono,
              fontSize: chipSize,
              fontWeight: 600,
              lineHeight: 1.2,
              color: seriesColor(s),
              opacity: ringP,
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {fmt(pt.v)}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export default ChartGrow;
