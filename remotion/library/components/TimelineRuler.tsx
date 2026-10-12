/**
 * AutoVideo — Library component: TimelineRuler
 *
 * Horizontal history/step timeline: a ruler axis draws itself across the
 * frame with minor ticks, event nodes pop in with springs along it, an
 * accent progress line grows from node to node, and the node under the
 * narration beat (or a pinned `activeIndex`) enlarges with a glow while its
 * card brightens. Event cards alternate above/below the axis so six events
 * stay readable. Registry entry: see src/ai/visual-registry.ts
 * ("TimelineRuler").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import {
  activeIndexAt,
  breathe,
  clamp01,
  enterProgress,
  resolveBeatSchedule,
  springIn,
  staggeredSpring,
} from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface TimelineRulerSpec extends AccentOverride {
  /** Small mono heading pinned top-left, e.g. "发展史". */
  title?: string;
  /** 2–6 events in chronological order; positions follow array order. */
  events: {
    /** Main event text, e.g. "Transformer 发布". */
    label: string;
    /** Muted secondary line under the label. */
    detail?: string;
    /** Small mono chip above the label, e.g. "2017". */
    time?: string;
  }[];
  /**
   * 0-based index of the node to feature (clamped into range). Omit to
   * auto-advance with the narration beat (lineTimings).
   */
  activeIndex?: number;
}

export type TimelineRulerProps = LibraryProps<TimelineRulerSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TimelineRuler: React.FC<TimelineRulerProps> = ({
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

  const events = spec.events;
  const count = events.length;
  const durationSec = durationInFrames / fps;
  const tSec = frame / fps;

  // ---- Beat schedule → featured node ----------------------------------------
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const autoActive = activeIndexAt(schedule, tSec);
  const manual =
    spec.activeIndex === undefined
      ? null
      : Math.max(0, Math.min(count - 1, Math.round(spec.activeIndex)));
  const active = manual ?? autoActive; // -1 = before the first beat

  // ---- Geometry ---------------------------------------------------------------
  const axisY = availH * 0.54;
  const axisX0 = marginX;
  const axisX1 = width - marginX;
  const trackW = axisX1 - axisX0;
  const insetHalf = Math.max(space(height, 9), trackW * 0.07);
  const nodeX = (i: number): number =>
    count > 1
      ? axisX0 + insetHalf + (i * (trackW - insetHalf * 2)) / (count - 1)
      : axisX0 + trackW / 2;

  const axisH = Math.max(3, Math.round(height * 0.0032));
  const dotR = space(height, 1.15);
  const stemH = space(height, 4.5);
  const stemW = Math.max(2, Math.round(height * 0.002));
  const cardW = Math.min(width * 0.24, (trackW / Math.max(1, count)) * 1.3);

  // ---- Progress line: glide from the previous node onto the featured one -----
  const prevX = active > 0 ? nodeX(active - 1) : axisX0;
  const beatStartFrame =
    active > 0
      ? schedule[active].startSec * fps
      : active === 0
        ? schedule[0].startSec * fps
        : 0;
  const transP = active >= 0 ? clamp01(springIn(frame, fps, beatStartFrame, "snappy")) : 0;
  const tipX = active === -1 ? axisX0 : prevX + (nodeX(active) - prevX) * transP;

  /** Emphasis scale per node: the newly featured node grows, the previous one shrinks back. */
  const scaleOf = (i: number): number => {
    if (i === active) return 1 + 0.22 * transP;
    if (i === active - 1) return 1 + 0.22 * (1 - transP);
    return 1;
  };

  // ---- Entrance beats ---------------------------------------------------------
  const axisP = enterProgress(frame, frames(0.15, fps), frames(DUR.heroSec, fps));
  const headingP = clamp01(staggeredSpring(frame, fps, 0, { preset: "gentle" }));
  const halo = breathe(frame, fps, { min: 0.2, max: 0.45, periodSec: 2.4 });

  // ---- Type -------------------------------------------------------------------
  const headingSize = typeSize(height, "label");
  const timeSize = typeSize(height, "label");
  const labelSize = count <= 4 ? typeSize(height, "body") : typeSize(height, "caption");
  const detailSize = typeSize(height, "caption") * 0.92;

  // Minor ruler ticks: three subdivisions per gap between adjacent nodes.
  const ticks: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = nodeX(i);
    const b = nodeX(i + 1);
    for (let k = 1; k <= 3; k++) ticks.push(a + ((b - a) * k) / 4);
  }

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% ${axisY}px, ${accent} 0%, transparent 62%)`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />

      {spec.title ? (
        <div
          style={{
            position: "absolute",
            top: availH * 0.12,
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

      {/* Base axis — draws itself left → right */}
      <div
        style={{
          position: "absolute",
          left: axisX0,
          top: axisY - axisH / 2,
          width: trackW,
          height: axisH,
          backgroundColor: theme.colors.muted,
          opacity: 0.35,
          borderRadius: axisH / 2,
          transform: `scaleX(${axisP})`,
          transformOrigin: "left center",
        }}
      />
      {/* Ruler end caps + minor ticks */}
      {[axisX0, axisX1].map((x, i) => (
        <div
          key={`cap-${i}`}
          style={{
            position: "absolute",
            left: x - stemW / 2,
            top: axisY - space(height, 0.9),
            width: stemW,
            height: space(height, 1.8),
            backgroundColor: theme.colors.muted,
            opacity: 0.4 * axisP,
          }}
        />
      ))}
      {ticks.map((x, i) => (
        <div
          key={`tick-${i}`}
          style={{
            position: "absolute",
            left: x - 1,
            top: axisY - space(height, 0.55),
            width: 2,
            height: space(height, 1.1),
            backgroundColor: theme.colors.muted,
            opacity: 0.25 * axisP,
          }}
        />
      ))}

      {/* Accent progress line + glowing tip */}
      <div
        style={{
          position: "absolute",
          left: axisX0,
          top: axisY - axisH / 2,
          width: Math.max(0, tipX - axisX0),
          height: axisH,
          backgroundColor: accent,
          borderRadius: axisH / 2,
          opacity: active === -1 ? 0 : 0.95,
        }}
      />
      {active !== -1 ? (
        <div
          style={{
            position: "absolute",
            left: tipX - dotR * 0.75,
            top: axisY - dotR * 0.75,
            width: dotR * 1.5,
            height: dotR * 1.5,
            borderRadius: "50%",
            backgroundColor: accent,
            boxShadow: `0 0 ${space(height, 2.5)}px ${accent}`,
            opacity: 0.9,
          }}
        />
      ) : null}

      {/* Nodes, stems and alternating event cards */}
      {events.map((ev, i) => {
        const x = nodeX(i);
        const above = i % 2 === 0;
        const pop = staggeredSpring(frame, fps, i, {
          baseSec: 0.45,
          stepSec: 0.1,
          preset: "pop",
        });
        const popDelay = frames(0.45 + i * 0.1, fps);
        const stemP = enterProgress(frame, popDelay + frames(0.12, fps), frames(DUR.snapSec, fps));
        const cardP = enterProgress(frame, popDelay + frames(0.22, fps), frames(DUR.enterSec, fps));
        const isActive = i === active;
        const isPast = active !== -1 && i < active;
        const nodeScale = (0.4 + 0.6 * pop) * scaleOf(i);

        return (
          <React.Fragment key={i}>
            {/* Stem from the axis to the card */}
            <div
              style={{
                position: "absolute",
                left: x - stemW / 2,
                top: above ? axisY - dotR - stemH : axisY + dotR,
                width: stemW,
                height: stemH,
                backgroundColor: accent,
                opacity: 0.5 * stemP,
                transform: `scaleY(${stemP})`,
                transformOrigin: above ? "bottom" : "top",
              }}
            />

            {/* Node dot on the axis */}
            <div
              style={{
                position: "absolute",
                left: x - dotR,
                top: axisY - dotR,
                width: dotR * 2,
                height: dotR * 2,
                borderRadius: "50%",
                backgroundColor:
                  isActive || isPast ? accent : theme.colors.bg,
                border: `${stemW}px solid ${isActive || isPast ? accent : theme.colors.muted}`,
                boxSizing: "border-box",
                opacity: clamp01(pop),
                transform: `scale(${nodeScale})`,
                boxShadow: isActive ? `0 0 ${space(height, 2.5)}px ${accent}` : undefined,
                zIndex: 2,
              }}
            />
            {/* Active-node breathing halo */}
            {isActive ? (
              <div
                style={{
                  position: "absolute",
                  left: x - dotR * 2.1,
                  top: axisY - dotR * 2.1,
                  width: dotR * 4.2,
                  height: dotR * 4.2,
                  borderRadius: "50%",
                  backgroundColor: accent,
                  opacity: halo * clamp01(pop),
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              />
            ) : null}

            {/* Event card, alternating above / below the axis */}
            <div
              style={{
                position: "absolute",
                left: x - cardW / 2,
                ...(above
                  ? { bottom: height - axisY + dotR + stemH }
                  : { top: axisY + dotR + stemH }),
                width: cardW,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: space(height, 0.75),
                padding: `${space(height, 1.5)}px ${space(height, 2)}px`,
                backgroundColor: `${theme.colors.code.bg}E6`,
                border: `1px solid ${isActive ? accent : `${theme.colors.muted}44`}`,
                borderRadius: space(height, 1.25),
                opacity: cardP,
                transform: `translateY(${(1 - cardP) * (above ? 1 : -1) * space(height, 2)}px) scale(${isActive ? 1.06 : 1})`,
                boxShadow: isActive
                  ? `0 0 ${space(height, 3)}px ${accent}55`
                  : `0 ${space(height, 1)}px ${space(height, 3)}px rgba(0,0,0,0.35)`,
              }}
            >
              {ev.time ? (
                <div
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: timeSize,
                    color: accent,
                    border: `1px solid ${accent}88`,
                    borderRadius: space(height, 2),
                    padding: `${space(height, 0.3)}px ${space(height, 1.2)}px`,
                    lineHeight: 1.3,
                  }}
                >
                  {ev.time}
                </div>
              ) : null}
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: labelSize,
                  fontWeight: isActive ? 700 : 600,
                  lineHeight: 1.3,
                  textAlign: "center",
                  color: theme.colors.fg,
                }}
              >
                {ev.label}
              </div>
              {ev.detail ? (
                <div
                  style={{
                    fontFamily: theme.fonts.sans,
                    fontSize: detailSize,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    textAlign: "center",
                    color: theme.colors.muted,
                  }}
                >
                  {ev.detail}
                </div>
              ) : null}
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

export default TimelineRuler;
