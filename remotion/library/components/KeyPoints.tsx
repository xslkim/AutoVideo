/**
 * AutoVideo — Library component: KeyPoints
 *
 * Numbered key-point list with per-item emphasis: the row being narrated
 * (from lineTimings, or an even rhythm when empty) lights up with an accent
 * rail, brighter type and a slight push while the rest recede. Replaces the
 * overused "pill trio" layout for teaching beats.
 * Registry entry: see src/ai/visual-registry.ts ("KeyPoints").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { LAYOUT, availHeight, space, typeSize } from "../tokens";
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

export interface KeyPointsSpec extends AccentOverride {
  /** Small mono heading pinned top-left, e.g. "核心要点". */
  title?: string;
  /** 2–6 points, in narration order. */
  points: { title: string; detail?: string }[];
}

export type KeyPointsProps = LibraryProps<KeyPointsSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const KeyPoints: React.FC<KeyPointsProps> = ({
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
  const tSec = frame / fps;

  const points = spec.points;
  const count = points.length;

  // ---- Beat schedule: narration-driven, uniform when no audio ------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const active = activeIndexAt(schedule, tSec);

  // ---- Type & geometry ----------------------------------------------------
  const headingSize = typeSize(height, "label");
  const titleSize = typeSize(height, "body");
  const detailSize = typeSize(height, "caption");
  const indexSize = typeSize(height, "caption");

  const hasDetail = points.some((p) => p.detail);
  const rowContentH =
    titleSize * 1.35 + (hasDetail ? detailSize * 1.5 + space(height, 1) : 0);
  const rowPadY = space(height, 2);
  const rowH = rowContentH + rowPadY * 2;
  const rowGap = space(height, 2);
  const listH = count * rowH + (count - 1) * rowGap;

  const headingH = spec.title ? headingSize * 1.6 + space(height, 4) : 0;
  const clusterTop = Math.max(
    availH * 0.1,
    (availH - (headingH + listH)) / 2,
  );

  const listWidth = Math.min(
    width - marginX * 2,
    width * LAYOUT.measurePct,
  );

  const headingP = staggeredSpring(frame, fps, 0, { preset: "gentle" });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, bottom-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 82% 88%, ${accent} 0%, transparent 55%)`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: listWidth,
        }}
      >
        {spec.title ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: space(height, 2),
              marginBottom: space(height, 4),
              opacity: clamp01(headingP),
              transform: `translateY(${(1 - clamp01(headingP)) * space(height, 1.5)}px)`,
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

        {points.map((point, i) => {
          const enter = staggeredSpring(frame, fps, i, {
            baseSec: spec.title ? 0.25 : 0.1,
            preset: "snappy",
          });
          const p = clamp01(enter);
          const isActive = i === active;
          const isPast = i < active;

          // Emphasis cross-fade, driven by narration beats. No wall clock:
          // interpolate state, not time — Remotion re-renders every frame.
          const emphasis = isActive ? 1 : 0;
          const rest = isPast ? 0.62 : 0.85;
          const glow = isActive
            ? breathe(frame, fps, { min: 0.18, max: 0.34, periodSec: 2.2 })
            : 0;

          return (
            <div
              key={i}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "stretch",
                gap: space(height, 2.5),
                height: rowH,
                marginBottom: i < count - 1 ? rowGap : 0,
                opacity: p * (isActive ? 1 : rest),
                transform: `translateX(${(1 - p) * -space(height, 3) + emphasis * space(height, 1)}px)`,
              }}
            >
              {/* Active-row tint plate (behind content) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: accent,
                  opacity: isActive ? 0.08 : 0,
                  borderRadius: space(height, 1.5),
                  pointerEvents: "none",
                }}
              />

              {/* Accent rail — full height when active, stub otherwise */}
              <div
                style={{
                  width: Math.max(3, Math.round(height * 0.004)),
                  borderRadius: 2,
                  backgroundColor: isActive ? accent : theme.colors.muted,
                  opacity: isActive ? 1 : 0.35,
                  marginTop: rowPadY * (isActive ? 0 : 0.6),
                  marginBottom: rowPadY * (isActive ? 0 : 0.6),
                  boxShadow: isActive
                    ? `0 0 ${space(height, 2.5)}px ${accent}`
                    : "none",
                }}
              />

              {/* Mono index */}
              <div
                style={{
                  width: space(height, 5),
                  paddingTop: rowPadY,
                  fontFamily: theme.fonts.mono,
                  fontSize: indexSize,
                  fontWeight: 500,
                  lineHeight: titleSize * 1.35 / indexSize,
                  color: isActive ? accent : theme.colors.muted,
                  opacity: isActive ? 1 : 0.7,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>

              {/* Text block */}
              <div style={{ paddingTop: rowPadY, paddingBottom: rowPadY }}>
                <div
                  style={{
                    fontFamily: theme.fonts.sans,
                    fontSize: titleSize,
                    fontWeight: isActive ? 600 : 500,
                    lineHeight: 1.35,
                    color: isActive ? theme.colors.fg : theme.colors.muted,
                  }}
                >
                  {point.title}
                </div>
                {point.detail ? (
                  <div
                    style={{
                      marginTop: space(height, 1),
                      fontFamily: theme.fonts.sans,
                      fontSize: detailSize,
                      fontWeight: 400,
                      lineHeight: 1.5,
                      color: theme.colors.muted,
                      opacity: isActive ? 0.95 : 0.75,
                    }}
                  >
                    {point.detail}
                  </div>
                ) : null}
              </div>

              {/* Breathing glow dot on the active row's right edge */}
              {isActive ? (
                <div
                  style={{
                    position: "absolute",
                    right: space(height, 2),
                    top: "50%",
                    width: space(height, 1),
                    height: space(height, 1),
                    marginTop: -space(height, 0.5),
                    borderRadius: "50%",
                    backgroundColor: accent,
                    opacity: glow + 0.4,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default KeyPoints;
