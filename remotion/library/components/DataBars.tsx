/**
 * AutoVideo — Library component: DataBars
 *
 * Animated horizontal bar chart for data comparisons: bars spring out from a
 * shared baseline with a stagger, values count up in sync, and the narration
 * beat (lineTimings, or an even rhythm when empty) spotlights one bar at a
 * time. Horizontal layout keeps CJK labels legible.
 * Registry entry: see src/ai/visual-registry.ts ("DataBars").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, availHeight, space, typeSize } from "../tokens";
import {
  activeIndexAt,
  breathe,
  clamp01,
  resolveBeatSchedule,
  staggeredSpring,
} from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface DataBarsSpec extends AccentOverride {
  /** Small mono heading pinned top-left, e.g. "耗时对比". */
  title?: string;
  /** Unit suffix for value labels, e.g. "ms" or "%". */
  unit?: string;
  /** Scale max; defaults to the largest bar value. */
  maxValue?: number;
  /** 2–6 bars. */
  bars: { label: string; value: number; color?: string }[];
}

export type DataBarsProps = LibraryProps<DataBarsSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DataBars: React.FC<DataBarsProps> = ({
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
  const marginX = width * 0.0625;

  const bars = spec.bars;
  const count = bars.length;
  const maxValue =
    spec.maxValue ?? Math.max(...bars.map((b) => Math.abs(b.value)), 1);

  // ---- Beat schedule over bars --------------------------------------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const active = activeIndexAt(schedule, frame / fps);

  // ---- Type & geometry ----------------------------------------------------
  const headingSize = typeSize(height, "label");
  const labelSize = typeSize(height, "caption");
  const valueSize = typeSize(height, "body");

  const barH = Math.min(space(height, 4.5), (availH * 0.55) / count - space(height, 2));
  const rowGap = space(height, 2.5);
  const listH = count * barH + (count - 1) * rowGap;

  const labelW = width * 0.17;
  const valueW = width * 0.1;
  const trackW = width - marginX * 2 - labelW - valueW - space(height, 4);

  const headingH = spec.title ? headingSize * 1.6 + space(height, 4) : 0;
  const clusterTop = Math.max(availH * 0.12, (availH - (headingH + listH)) / 2);

  const headingP = clamp01(staggeredSpring(frame, fps, 0, { preset: "gentle" }));
  const activePulse = breathe(frame, fps, { min: 0.85, max: 1, periodSec: 2.2 });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 18% 85%, ${accent} 0%, transparent 55%)`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: width - marginX * 2,
        }}
      >
        {spec.title ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: space(height, 2),
              marginBottom: space(height, 4),
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

        {bars.map((bar, i) => {
          const enter = staggeredSpring(frame, fps, i, {
            baseSec: spec.title ? 0.25 : 0.1,
            stepSec: DUR.staggerSec,
            preset: "snappy",
          });
          const p = clamp01(enter);
          const isActive = i === active;
          const barColor = bar.color ?? accent;
          const fillRatio = Math.min(1, Math.abs(bar.value) / maxValue);

          // Count-up label follows the same spring as the bar itself.
          const shown = interpolate(p, [0, 1], [0, bar.value]);
          const shownText = Number.isInteger(bar.value)
            ? String(Math.round(shown))
            : shown.toFixed(1);

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                height: barH,
                marginBottom: i < count - 1 ? rowGap : 0,
                opacity: p,
              }}
            >
              {/* Label column */}
              <div
                style={{
                  width: labelW,
                  flexShrink: 0,
                  paddingRight: space(height, 2),
                  fontFamily: theme.fonts.sans,
                  fontSize: labelSize,
                  fontWeight: isActive ? 600 : 400,
                  lineHeight: 1.35,
                  textAlign: "right",
                  color: isActive ? theme.colors.fg : theme.colors.muted,
                }}
              >
                {bar.label}
              </div>

              {/* Track + growing fill */}
              <div
                style={{
                  position: "relative",
                  width: trackW,
                  height: barH,
                  backgroundColor: theme.colors.code.bg,
                  borderRadius: barH / 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${fillRatio * 100}%`,
                    backgroundColor: barColor,
                    borderRadius: barH / 2,
                    transform: `scaleX(${p})`,
                    transformOrigin: "left",
                    opacity: isActive ? activePulse : 0.72,
                    boxShadow: isActive ? `0 0 ${space(height, 2)}px ${barColor}` : "none",
                  }}
                />
              </div>

              {/* Value readout */}
              <div
                style={{
                  width: valueW,
                  flexShrink: 0,
                  paddingLeft: space(height, 2),
                  fontFamily: theme.fonts.mono,
                  fontSize: valueSize,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  color: isActive ? barColor : theme.colors.muted,
                }}
              >
                {shownText}
                {spec.unit ? (
                  <span
                    style={{
                      fontSize: labelSize,
                      fontWeight: 400,
                      color: theme.colors.muted,
                      marginLeft: space(height, 0.5),
                    }}
                  >
                    {spec.unit}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default DataBars;
