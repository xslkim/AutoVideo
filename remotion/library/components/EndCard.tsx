/**
 * AutoVideo — Library component: EndCard
 *
 * 2-second brand end card: a solid accent logo tile with the channel
 * monogram, the brand lockup, a growing hairline, a follow call-to-action
 * pill with a radar-ping ring, and an optional next-episode teaser. All
 * elements stagger in with springs inside the first ~1.2s and then hold.
 *
 * Registry entry: see src/ai/visual-registry.ts ("EndCard").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import { breathe, clamp01, enterProgress, springIn } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface EndCardSpec extends AccentOverride {
  /** Brand / channel lockup, e.g. "AutoVideo 频道". */
  brand: string;
  /** 1–2 characters inside the logo tile; defaults to brand's first char. */
  monogram?: string;
  /** Small mono kicker above the tile, e.g. "感谢观看". */
  kicker?: string;
  /** Follow call-to-action inside the accent pill, e.g. "关注频道，不错过更新". */
  followPrompt?: string;
  /** Next-episode teaser line, e.g. "下集预告：动手写出你的第一个渲染器". */
  nextTeaser?: string;
}

export type EndCardProps = LibraryProps<EndCardSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EndCard: React.FC<EndCardProps> = ({
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
  const monogram = spec.monogram ?? Array.from(spec.brand)[0] ?? "";

  // ---- Beat timeline (block-relative frames; all settled by ~1.2s @30fps) ---
  const kickerDelay = frames(0.08, fps);
  const tileDelay = frames(0.2, fps);
  const brandDelay = frames(0.34, fps);
  const ruleDelay = frames(0.5, fps);
  const pillDelay = frames(0.64, fps);
  const teaserDelay = frames(0.82, fps);

  // ---- Type & geometry --------------------------------------------------------
  const kickerSize = typeSize(height, "label");
  const brandSize = typeSize(height, "title");
  const pillSize = typeSize(height, "body");
  const teaserSize = typeSize(height, "caption");
  const tileSize = space(height, 13);
  const tileRadius = Math.max(8, Math.round(height * LAYOUT.radiusCardPct));

  // ---- Animated values ---------------------------------------------------------
  const kickerP = enterProgress(frame, kickerDelay, frames(DUR.enterSec, fps));
  const tileP = clamp01(springIn(frame, fps, tileDelay, "pop"));
  const brandP = clamp01(springIn(frame, fps, brandDelay, "gentle"));
  const ruleP = enterProgress(frame, ruleDelay, frames(DUR.enterSec, fps));
  const pillP = clamp01(springIn(frame, fps, pillDelay, "pop"));
  const teaserP = enterProgress(frame, teaserDelay, frames(DUR.enterSec, fps));

  // Idle life after the entrance: tile glow breathes, pill ring pings.
  const tileGlow = breathe(frame, fps, { min: 0.2, max: 0.5, periodSec: 2.8 });
  const pingPeriod = Math.max(1, frames(1.8, fps));
  const pingT = ((frame % pingPeriod) + pingPeriod) % pingPeriod / pingPeriod;
  const pingOpacity = (1 - pingT) * 0.5 * pillP;
  const pingScale = 1 + pingT * 0.35;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, centred behind the lockup */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 42%, ${accent} 0%, transparent 55%)`,
          opacity: 0.08,
          pointerEvents: "none",
        }}
      />

      {/* Centred lockup column, optically lifted a touch above middle */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: availH,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `translateY(${-availH * 0.02}px)`,
        }}
      >
        {spec.kicker ? (
          <div
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: kickerSize,
              letterSpacing: "0.16em",
              color: accent,
              fontWeight: 500,
              lineHeight: 1.4,
              marginBottom: space(height, 3),
              opacity: kickerP,
              transform: `translateY(${(1 - kickerP) * -space(height, 1.5)}px)`,
            }}
          >
            {spec.kicker}
          </div>
        ) : null}

        {/* Logo tile */}
        <div
          style={{
            position: "relative",
            width: tileSize,
            height: tileSize,
            marginBottom: space(height, 3.5),
            opacity: tileP,
            transform: `scale(${0.6 + 0.4 * tileP})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -Math.round(tileSize * 0.35),
              background: `radial-gradient(circle, ${accent} 0%, transparent 65%)`,
              opacity: tileGlow * tileP,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: tileRadius,
              backgroundColor: accent,
              color: theme.colors.bg,
              fontFamily: theme.fonts.sans,
              fontSize: Math.round(tileSize * 0.44),
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {monogram}
          </div>
        </div>

        {/* Brand lockup */}
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: brandSize,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
            color: theme.colors.fg,
            textAlign: "center",
            opacity: brandP,
            transform: `translateY(${(1 - brandP) * space(height, 2.5)}px)`,
          }}
        >
          {spec.brand}
        </div>

        {/* Accent hairline */}
        <div
          style={{
            marginTop: space(height, 3),
            marginBottom: space(height, 3.5),
            width: "26%",
            height: Math.max(3, Math.round(height * 0.0035)),
            backgroundColor: accent,
            transform: `scaleX(${ruleP})`,
            opacity: breathe(frame, fps, { min: 0.6, max: 1, periodSec: 3.2 }),
            borderRadius: 2,
          }}
        />

        {/* Follow pill with a looping radar ping */}
        {spec.followPrompt ? (
          <div
            style={{
              position: "relative",
              marginBottom: spec.nextTeaser ? space(height, 3) : 0,
              opacity: pillP,
              transform: `scale(${0.7 + 0.3 * pillP})`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 999,
                border: `2px solid ${accent}`,
                opacity: pingOpacity,
                transform: `scale(${pingScale})`,
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                borderRadius: 999,
                border: `${Math.max(1.5, Math.round(height * 0.0015))}px solid ${accent}`,
                padding: `${space(height, 1.5)}px ${space(height, 4)}px`,
                fontFamily: theme.fonts.sans,
                fontSize: pillSize,
                fontWeight: 600,
                letterSpacing: "0.04em",
                lineHeight: 1.3,
                color: accent,
                whiteSpace: "nowrap",
              }}
            >
              {spec.followPrompt}
            </div>
          </div>
        ) : null}

        {/* Next-episode teaser */}
        {spec.nextTeaser ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: space(height, 1.5),
              opacity: teaserP,
              transform: `translateY(${(1 - teaserP) * space(height, 1.5)}px)`,
            }}
          >
            <div
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: teaserSize,
                letterSpacing: "0.14em",
                color: accent,
                border: `1px solid ${accent}`,
                borderRadius: Math.max(3, Math.round(height * LAYOUT.radiusChipPct)),
                padding: `${space(height, 0.5)}px ${space(height, 1)}px`,
                lineHeight: 1.3,
              }}
            >
              NEXT
            </div>
            <div
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: teaserSize,
                lineHeight: 1.5,
                color: theme.colors.muted,
                maxWidth: width * LAYOUT.measurePct,
              }}
            >
              {spec.nextTeaser}
            </div>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export default EndCard;
