/**
 * AutoVideo — Library component: NumberTicker
 *
 * Big-number impact beat: odometer drums roll up to the target value — each
 * digit column spins through full revolutions (lower places spin more) and
 * its own pop spring rolls it slightly past the target digit and bounces
 * back, cascading left → right — while an optional sparkline draws itself
 * underneath. For data-impact moments: one hero number plus a caption, not
 * a chart.
 * Registry entry: see src/ai/visual-registry.ts ("NumberTicker").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import { EASE, breathe, clamp01, enterProgress, springIn } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface NumberTickerSpec extends AccentOverride {
  /** Target value the counter lands on, e.g. 128000 or 99.2. */
  value: number;
  /** Caption under the number, e.g. "本月活跃用户". */
  label: string;
  /** Small suffix right of the digits, e.g. "%" or "ms". */
  unit?: string;
  /** Decimal places; defaults to 0 for integers, 1 otherwise. */
  decimals?: number;
  /** Optional trend under the caption (2–24 points, oldest → newest). */
  sparkline?: number[];
}

export type NumberTickerProps = LibraryProps<NumberTickerSpec>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable per-instance SVG id so multiple tickers never share gradient ids. */
function uid(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * One odometer drum: digit strip 0–9 repeated `spins + 2` times inside a
 * clipped column. The spring progress `q` (0→1, pop preset overshoots to
 * ~1.19) scrolls the strip to `q * (10*spins + digit)` cells, so the drum
 * rolls through `spins` full revolutions, overshoots past the target digit
 * and bounces back onto it — at q = 1 the digit lands exactly. The extra
 * copies absorb the overshoot without running off the strip.
 */
const DigitColumn: React.FC<{
  digit: number;
  spins: number;
  q: number;
  cellH: number;
  fontSize: number;
  color: string;
}> = ({ digit, spins, q, cellH, fontSize, color }) => {
  const cells = Array.from({ length: (spins + 2) * 10 }, (_, i) => i % 10);
  const position = Math.max(0, q) * (10 * spins + digit);
  return (
    <div
      style={{
        position: "relative",
        width: "0.62em",
        height: cellH,
        overflow: "hidden",
        fontSize,
        WebkitMaskImage:
          "linear-gradient(transparent, black 18%, black 82%, transparent)",
        maskImage:
          "linear-gradient(transparent, black 18%, black 82%, transparent)",
      }}
    >
      <div
        style={{ transform: `translateY(${(-position * cellH).toFixed(2)}px)` }}
      >
        {cells.map((d, i) => (
          <div
            key={i}
            style={{
              height: cellH,
              lineHeight: `${cellH}px`,
              textAlign: "center",
              fontWeight: 700,
              color,
            }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const NumberTicker: React.FC<NumberTickerProps> = ({
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
  void durationInFrames;
  void lineTimings;

  const accent = spec.accent ?? theme.colors.accent;
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;

  // ---- Digit columns from the formatted target ------------------------------
  const decimals = spec.decimals ?? (Number.isInteger(spec.value) ? 0 : 1);
  const negative = spec.value < 0;
  const targetStr = Math.abs(spec.value).toFixed(decimals);

  type Column = { kind: "digit"; digit: number; spins: number } | { kind: "sep" };
  const parsed: ({ kind: "digit"; digit: number } | { kind: "sep" })[] = [];
  for (const ch of targetStr) {
    if (ch === ".") parsed.push({ kind: "sep" });
    else parsed.push({ kind: "digit", digit: ch.charCodeAt(0) - 48 });
  }
  const digitCount = parsed.filter((c) => c.kind === "digit").length;
  let digitSeen = 0;
  const columns: Column[] = parsed.map((c) => {
    if (c.kind === "sep") return c;
    digitSeen += 1;
    // Lower places spin more revolutions, capped so the pop overshoot stays
    // under one extra revolution.
    const spins = Math.min(3, 1 + (digitCount - digitSeen));
    return { kind: "digit", digit: c.digit, spins };
  });

  // ---- Beat timeline (block-relative frames) --------------------------------
  const numDelay = frames(0.15, fps);
  const drumStepF = frames(0.07, fps);
  const numP = enterProgress(frame, numDelay, frames(DUR.snapSec, fps));
  // Cascade: drums start left → right; each settles with its own pop bounce.
  let drumIndex = 0;
  const drumQ = columns.map((c) => {
    if (c.kind === "sep") return 1;
    const q = springIn(frame, fps, numDelay + drumIndex * drumStepF, "pop");
    drumIndex += 1;
    return q;
  });
  const lastDrumDelay = numDelay + Math.max(0, digitCount - 1) * drumStepF;
  // Whole-row thud as the final drum lands.
  const rowPop = springIn(frame, fps, lastDrumDelay, "pop");
  const rowScale = 1 + Math.max(0, rowPop - 1) * 0.1;

  const labelDelay = numDelay + frames(0.5, fps);
  const labelP = enterProgress(frame, labelDelay, frames(DUR.enterSec, fps));
  const glowP = enterProgress(
    frame,
    lastDrumDelay + frames(0.4, fps),
    frames(DUR.enterSec, fps),
  );
  const glow = glowP * breathe(frame, fps, { min: 0.55, max: 1, periodSec: 3.4 });

  // ---- Type & geometry ------------------------------------------------------
  const numberSize = Math.round(typeSize(height, "display") * 1.18);
  const cellH = Math.round(numberSize * 1.14);
  const labelSize = typeSize(height, "body");
  const unitSize = Math.round(numberSize * 0.3);

  // ---- Sparkline --------------------------------------------------------------
  const spark =
    spec.sparkline && spec.sparkline.length >= 2 ? spec.sparkline : null;
  const sparkW = Math.round(width * 0.22);
  const sparkH = space(height, 8);
  const sparkPad = Math.max(2, Math.round(height * 0.003));
  const sparkDelay = lastDrumDelay + frames(DUR.enterSec, fps);
  const sparkDur = frames(DUR.heroSec, fps);
  const sparkP = spark
    ? enterProgress(frame, sparkDelay, sparkDur, EASE.inOut)
    : 0;
  const sparkDotP = spark ? springIn(frame, fps, sparkDelay + sparkDur, "pop") : 0;
  const gradId = `nt-spark-${uid(`${spec.label}|${spec.value}`)}`;

  let sparkLine = "";
  let sparkArea = "";
  let sparkEnd = { x: 0, y: 0 };
  if (spark) {
    const sMin = Math.min(...spark);
    const sRange = Math.max(...spark) - sMin || 1;
    const innerW = sparkW - sparkPad * 2;
    const innerH = sparkH - sparkPad * 2;
    const pts = spark.map((v, i) => ({
      x: sparkPad + (i / (spark.length - 1)) * innerW,
      y: sparkPad + (1 - (v - sMin) / sRange) * innerH,
    }));
    sparkLine = pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    sparkArea = `${sparkLine} L ${pts[pts.length - 1].x.toFixed(1)} ${(
      sparkH - sparkPad
    ).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(sparkH - sparkPad).toFixed(1)} Z`;
    sparkEnd = pts[pts.length - 1];
  }

  // ---- Cluster layout ---------------------------------------------------------
  const labelH = labelSize * 1.5 + space(height, 1.5);
  const sparkBlockH = spark ? sparkH + space(height, 2) : 0;
  const clusterH = cellH + labelH + sparkBlockH;
  const clusterTop = availH * LAYOUT.heroCenterPct - clusterH / 2;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, top-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 78% 18%, ${accent} 0%, transparent 55%)`,
          opacity: 0.06,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: width - marginX * 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Settle glow blooming behind the number once it lands */}
        <div
          style={{
            position: "absolute",
            top: cellH / 2,
            left: "50%",
            width: width * 0.42,
            height: cellH * 2.4,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(ellipse, ${accent} 0%, transparent 65%)`,
            opacity: 0.14 * glow,
            pointerEvents: "none",
          }}
        />

        {/* Odometer row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            fontFamily: theme.fonts.mono,
            opacity: numP,
            transform: `scale(${rowScale.toFixed(4)})`,
            transformOrigin: "center bottom",
          }}
        >
          {negative ? (
            <div
              style={{
                fontSize: numberSize,
                height: cellH,
                lineHeight: `${cellH}px`,
                width: "0.5em",
                textAlign: "center",
                fontWeight: 700,
                color: theme.colors.fg,
              }}
            >
              −
            </div>
          ) : null}
          {columns.map((col, i) =>
            col.kind === "sep" ? (
              <div
                key={i}
                style={{
                  fontSize: numberSize,
                  height: cellH,
                  lineHeight: `${cellH}px`,
                  width: "0.34em",
                  textAlign: "center",
                  fontWeight: 700,
                  color: theme.colors.fg,
                }}
              >
                .
              </div>
            ) : (
              <DigitColumn
                key={i}
                digit={col.digit}
                spins={col.spins}
                q={drumQ[i]}
                cellH={cellH}
                fontSize={numberSize}
                color={theme.colors.fg}
              />
            ),
          )}
          {spec.unit ? (
            <div
              style={{
                fontSize: unitSize,
                fontWeight: 600,
                lineHeight: 1.2,
                color: accent,
                paddingBottom: Math.round(cellH * 0.12),
                marginLeft: space(height, 1),
              }}
            >
              {spec.unit}
            </div>
          ) : null}
        </div>

        {/* Caption */}
        <div
          style={{
            marginTop: space(height, 1.5),
            fontFamily: theme.fonts.sans,
            fontSize: labelSize,
            fontWeight: 400,
            letterSpacing: "0.04em",
            lineHeight: 1.5,
            color: theme.colors.muted,
            opacity: labelP,
            transform: `translateY(${(1 - labelP) * space(height, 1.5)}px)`,
          }}
        >
          {spec.label}
        </div>

        {/* Sparkline drawing itself under the caption */}
        {spark ? (
          <svg
            width={sparkW}
            height={sparkH}
            style={{ marginTop: space(height, 2), overflow: "visible" }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={sparkArea} fill={`url(#${gradId})`} opacity={sparkP} />
            {(() => {
              const dash = evolvePath(sparkP, sparkLine);
              return (
                <path
                  d={sparkLine}
                  fill="none"
                  stroke={accent}
                  strokeWidth={Math.max(2, height * 0.0022)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dash.strokeDasharray}
                  strokeDashoffset={dash.strokeDashoffset}
                />
              );
            })()}
            <circle
              cx={sparkEnd.x}
              cy={sparkEnd.y}
              r={Math.max(3, height * 0.004) * clamp01(sparkDotP)}
              fill={accent}
              opacity={clamp01(sparkDotP)}
            />
          </svg>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export default NumberTicker;
