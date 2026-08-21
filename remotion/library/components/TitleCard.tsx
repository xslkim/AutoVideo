/**
 * AutoVideo — Library component: TitleCard
 *
 * Hero title for openers and chapter breaks: kicker label, multi-line
 * title with staggered spring entrances, a growing accent hairline and an
 * optional subtitle. Registry entry: see src/ai/visual-registry.ts ("TitleCard").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import { breathe, enterProgress, springIn } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface TitleCardSpec extends AccentOverride {
  /** Small mono label above the title, e.g. "第 3 课 · L3". */
  kicker?: string;
  /** Main title; "\n" starts a new line (each line staggers in). */
  title: string;
  /** Optional muted lead line under the hairline. */
  subtitle?: string;
  /** Text alignment of the whole block. Default "center". */
  align?: "center" | "left";
}

export type TitleCardProps = LibraryProps<TitleCardSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TitleCard: React.FC<TitleCardProps> = ({
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
  const align = spec.align ?? "center";
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;

  // ---- Beat timeline (block-relative frames) ------------------------------
  const kickerDelay = frames(0.1, fps);
  const titleBase = spec.kicker ? frames(0.35, fps) : frames(0.15, fps);
  const lineStep = frames(0.18, fps);
  const ruleDelay = titleBase + frames(0.35, fps);
  const subtitleDelay = ruleDelay + frames(0.25, fps);

  // ---- Type & geometry ----------------------------------------------------
  const titleLines = spec.title.split("\n").filter((l) => l.length > 0);
  const titleSize = typeSize(height, "display");
  const subtitleSize = typeSize(height, "subtitle");
  const kickerSize = typeSize(height, "label");
  const contentWidth = width - marginX * 2;

  // Content cluster height → optically centred slightly above middle.
  const kickerH = spec.kicker ? kickerSize * 1.6 + space(height, 3) : 0;
  const titleH = titleLines.length * titleSize * 1.16;
  const ruleH = space(height, 4);
  const subtitleH = spec.subtitle ? subtitleSize * 1.5 : 0;
  const clusterH = kickerH + titleH + ruleH + subtitleH;
  const clusterTop = availH * LAYOUT.heroCenterPct - clusterH / 2;

  const alignItems = align === "center" ? "center" : "flex-start";
  const textAlign = align === "center" ? ("center" as const) : ("left" as const);

  // ---- Animated values ----------------------------------------------------
  const kickerP = enterProgress(frame, kickerDelay, frames(DUR.enterSec, fps));
  const ruleP = enterProgress(frame, ruleDelay, frames(DUR.enterSec, fps));
  const subtitleP = enterProgress(frame, subtitleDelay, frames(DUR.enterSec, fps));
  // The hairline keeps a faint life of its own while the block holds.
  const ruleGlow = breathe(frame, fps, { min: 0.55, max: 1, periodSec: 3.2 });
  const cornerP = enterProgress(frame, kickerDelay, frames(DUR.snapSec, fps));

  const cornerLen = space(height, 5);
  const cornerThickness = Math.max(2, Math.round(height * 0.0022));
  const cornerInsetY = availH * 0.12;
  const corners: React.CSSProperties[] = [
    { top: cornerInsetY, left: marginX, borderTopWidth: cornerThickness, borderLeftWidth: cornerThickness },
    { top: cornerInsetY, right: marginX, borderTopWidth: cornerThickness, borderRightWidth: cornerThickness },
    { top: availH - cornerInsetY - cornerLen, left: marginX, borderBottomWidth: cornerThickness, borderLeftWidth: cornerThickness },
    { top: availH - cornerInsetY - cornerLen, right: marginX, borderBottomWidth: cornerThickness, borderRightWidth: cornerThickness },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, top-left — kept whisper-quiet via layer opacity */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 22% 12%, ${accent} 0%, transparent 52%)`,
          opacity: 0.07,
          pointerEvents: "none",
        }}
      />

      {/* Corner ticks framing the safe area */}
      {corners.map((pos, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: cornerLen,
            height: cornerLen,
            borderColor: accent,
            borderStyle: "solid",
            borderWidth: 0,
            opacity: 0.35 * cornerP,
            pointerEvents: "none",
            ...pos,
          }}
        />
      ))}

      {/* Centred content cluster */}
      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: contentWidth,
          display: "flex",
          flexDirection: "column",
          alignItems,
        }}
      >
        {spec.kicker ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: space(height, 2),
              marginBottom: space(height, 3),
              opacity: kickerP,
              transform: `translateY(${(1 - kickerP) * -space(height, 1.5)}px)`,
            }}
          >
            <div style={{ width: space(height, 4), height: 2, backgroundColor: accent }} />
            <div
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: kickerSize,
                letterSpacing: "0.14em",
                color: accent,
                fontWeight: 500,
                lineHeight: 1.4,
              }}
            >
              {spec.kicker}
            </div>
            <div style={{ width: space(height, 4), height: 2, backgroundColor: accent }} />
          </div>
        ) : null}

        {titleLines.map((line, i) => {
          const p = springIn(frame, fps, titleBase + i * lineStep, "gentle");
          const clamped = Math.max(0, Math.min(1, p));
          return (
            <div
              key={i}
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: titleSize,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.16,
                color: theme.colors.fg,
                textAlign,
                opacity: clamped,
                transform: `translateY(${(1 - clamped) * space(height, 3)}px)`,
              }}
            >
              {line}
            </div>
          );
        })}

        {/* Accent hairline growing out from the alignment origin */}
        <div
          style={{
            marginTop: space(height, 2.5),
            marginBottom: space(height, 2.5),
            width: contentWidth * 0.28,
            height: Math.max(3, Math.round(height * 0.0035)),
            backgroundColor: accent,
            transform: `scaleX(${ruleP})`,
            transformOrigin: align === "center" ? "center" : "left",
            opacity: ruleGlow,
            borderRadius: 2,
          }}
        />

        {spec.subtitle ? (
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: subtitleSize,
              fontWeight: 400,
              lineHeight: 1.5,
              color: theme.colors.muted,
              textAlign,
              maxWidth: contentWidth * LAYOUT.measurePct,
              opacity: subtitleP,
              transform: `translateY(${(1 - subtitleP) * space(height, 2)}px)`,
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export default TitleCard;
