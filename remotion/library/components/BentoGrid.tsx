/**
 * AutoVideo — Library component: BentoGrid
 *
 * Glassmorphism bento grid: 2–4 frosted cards (translucent fill, backdrop
 * blur, 1px translucent border, soft shadow) pop in with an overshoot
 * spring stagger. Each card carries an icon glyph chip, a title and an
 * optional detail line; the narration beat (lineTimings, or an even rhythm
 * when empty) walks an accent glow across the cards.
 * Registry entry: see src/ai/visual-registry.ts ("BentoGrid").
 *
 * backdrop-filter works in Remotion's headless Chrome; where it is silently
 * unsupported the translucent fill alone keeps the cards legible, and
 * spec.blur === false forces the higher-opacity solid fallback.
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, space, typeSize } from "../tokens";
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

export interface BentoCardSpec {
  /** Icon glyph or short placeholder text in the chip, e.g. "⚡" or "API". */
  icon?: string;
  /** Card heading — keep to one short line. */
  title: string;
  /** Muted supporting line under the title. */
  detail?: string;
}

export interface BentoGridSpec extends AccentOverride {
  /** Small mono heading pinned top-left, e.g. "核心能力". */
  title?: string;
  /** 2–4 cards, in narration order. */
  cards: BentoCardSpec[];
  /**
   * Card arrangement. "auto": 2 cards → "row", 3 → "1+2" (featured card
   * left, the rest stacked right), 4 → "2x2". Default "auto".
   */
  layout?: "auto" | "row" | "2x2" | "1+2";
  /**
   * Backdrop blur under the glass. Default true; set false to force the
   * solid translucent fallback (e.g. when compositing over busy footage).
   */
  blur?: boolean;
}

export type BentoGridProps = LibraryProps<BentoGridSpec>;

// ---------------------------------------------------------------------------
// Layout — resolve the card rectangles for each arrangement
// ---------------------------------------------------------------------------

interface Cell {
  left: number;
  top: number;
  w: number;
  h: number;
}

function layoutCells(
  resolved: "row" | "2x2" | "1+2",
  count: number,
  gridW: number,
  gridH: number,
  gap: number,
): Cell[] {
  if (resolved === "2x2") {
    const cw = (gridW - gap) / 2;
    const ch = (gridH - gap) / 2;
    return Array.from({ length: count }, (_, i) => ({
      left: (i % 2) * (cw + gap),
      top: Math.floor(i / 2) * (ch + gap),
      w: cw,
      h: ch,
    }));
  }
  if (resolved === "1+2") {
    const fw = gridW * 0.44;
    const rw = gridW - fw - gap;
    const rest = count - 1;
    const rh = rest > 0 ? (gridH - gap * (rest - 1)) / rest : gridH;
    return [
      { left: 0, top: 0, w: fw, h: gridH },
      ...Array.from({ length: rest }, (_, i) => ({
        left: fw + gap,
        top: i * (rh + gap),
        w: rw,
        h: rh,
      })),
    ];
  }
  const cw = (gridW - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({
    left: i * (cw + gap),
    top: 0,
    w: cw,
    h: gridH,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BentoGrid: React.FC<BentoGridProps> = ({
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
  const blur = spec.blur !== false;

  const cards = spec.cards.slice(0, 4);
  const count = cards.length;
  const layout = spec.layout ?? "auto";
  const resolved: "row" | "2x2" | "1+2" =
    layout === "auto"
      ? count >= 4
        ? "2x2"
        : count === 3
          ? "1+2"
          : "row"
      : layout;

  // ---- Beat schedule over cards -------------------------------------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const active = activeIndexAt(schedule, frame / fps);

  // ---- Type & geometry ----------------------------------------------------
  const headingSize = typeSize(height, "label");
  const titleSize = typeSize(height, "body");
  const detailSize = typeSize(height, "caption");
  const iconSize = typeSize(height, "body");
  const chip = space(height, 6);
  const cardRadius = Math.round(height * LAYOUT.radiusCardPct);
  const chipRadius = Math.round(height * LAYOUT.radiusChipPct);
  const blurPx = Math.max(8, Math.round(height * 0.014));

  const gap = space(height, 3);
  const gridW = width - marginX * 2;
  const gridH =
    resolved === "row"
      ? Math.min(availH * 0.42, space(height, 30))
      : Math.min(availH * 0.6, gridW * 0.52);
  const cells = layoutCells(resolved, count, gridW, gridH, gap);

  const headingH = spec.title ? headingSize * 1.6 + space(height, 4) : 0;
  const clusterTop = Math.max(
    availH * 0.1,
    (availH - (headingH + gridH)) / 2,
  );

  // ---- Glass surfaces (fill stays translucent even when blur is off) ------
  const glassFill = `color-mix(in srgb, ${theme.colors.fg} ${blur ? 7 : 13}%, transparent)`;
  const glassSheen = `linear-gradient(155deg, color-mix(in srgb, ${theme.colors.fg} 9%, transparent) 0%, transparent 42%)`;
  const idleBorder = `color-mix(in srgb, ${theme.colors.fg} 14%, transparent)`;

  // ---- Animated values ----------------------------------------------------
  const headingP = clamp01(staggeredSpring(frame, fps, 0, { preset: "gentle" }));
  const glowPulse = breathe(frame, fps, { min: 0.55, max: 1, periodSec: 2.4 });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, top-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 80% 14%, ${accent} 0%, transparent 55%)`,
          opacity: 0.06,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: gridW,
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

        <div style={{ position: "relative", width: gridW, height: gridH }}>
          {cards.map((card, i) => {
            const cell = cells[i];
            const enter = staggeredSpring(frame, fps, i, {
              baseSec: spec.title ? 0.25 : 0.1,
              stepSec: DUR.staggerSec,
              preset: "pop",
            });
            const p = clamp01(enter);
            const isActive = i === active;

            const borderColor = isActive
              ? `color-mix(in srgb, ${accent} ${Math.round(55 * glowPulse)}%, transparent)`
              : idleBorder;
            const shadow = isActive
              ? `0 ${space(height, 2)}px ${space(height, 6)}px rgba(0,0,0,0.35), 0 0 ${space(height, 3)}px color-mix(in srgb, ${accent} 28%, transparent)`
              : `0 ${space(height, 2)}px ${space(height, 5)}px rgba(0,0,0,0.28)`;

            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: cell.left,
                  top: cell.top,
                  width: cell.w,
                  height: cell.h,
                  borderRadius: cardRadius,
                  backgroundColor: glassFill,
                  backgroundImage: glassSheen,
                  border: `1px solid ${borderColor}`,
                  boxShadow: shadow,
                  backdropFilter: blur
                    ? `blur(${blurPx}px) saturate(1.4)`
                    : undefined,
                  opacity: p,
                  transform: `translateY(${(1 - p) * space(height, 4)}px) scale(${0.88 + 0.12 * enter})`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: space(height, 1.5),
                    height: "100%",
                    boxSizing: "border-box",
                    padding: space(height, 3),
                  }}
                >
                  {/* Icon chip — accent plate, inverted while narrated */}
                  <div
                    style={{
                      width: chip,
                      height: chip,
                      flexShrink: 0,
                      borderRadius: chipRadius,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isActive
                        ? accent
                        : `color-mix(in srgb, ${accent} 16%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${accent} ${isActive ? 70 : 32}%, transparent)`,
                      fontFamily: theme.fonts.mono,
                      fontSize: iconSize,
                      fontWeight: 600,
                      lineHeight: 1,
                      color: isActive ? theme.colors.bg : accent,
                    }}
                  >
                    {card.icon ?? String(i + 1).padStart(2, "0")}
                  </div>

                  <div
                    style={{
                      fontFamily: theme.fonts.sans,
                      fontSize: titleSize,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      color: theme.colors.fg,
                    }}
                  >
                    {card.title}
                  </div>

                  {card.detail ? (
                    <div
                      style={{
                        fontFamily: theme.fonts.sans,
                        fontSize: detailSize,
                        fontWeight: 400,
                        lineHeight: 1.5,
                        color: theme.colors.muted,
                        opacity: isActive ? 0.95 : 0.8,
                      }}
                    >
                      {card.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default BentoGrid;
