/**
 * AutoVideo — Library component: QuoteCard
 *
 * Editorial pull-quote: an oversized accent quote mark, large lines that
 * mask-reveal upward one after another (each line rises out of an overflow
 * mask, uncovered from its bottom edge), and a Ken Burns-style drift that
 * scales the whole block almost imperceptibly while it holds. Optional
 * author / source attribution row below. Registry entry: see
 * src/ai/visual-registry.ts ("QuoteCard").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import { clamp01, enterProgress, springIn } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface QuoteCardSpec extends AccentOverride {
  /** Quote body — one string per line, 1–6 lines; lines mask-reveal in order. */
  lines: string[];
  /** Attribution name, rendered as "—— {author}" under the quote. */
  author?: string;
  /** Muted source on the attribution row, e.g. "《时间简史》". */
  source?: string;
}

export type QuoteCardProps = LibraryProps<QuoteCardSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QuoteCard: React.FC<QuoteCardProps> = ({
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
  void lineTimings;

  const accent = spec.accent ?? theme.colors.accent;
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;
  const measure = width * LAYOUT.measurePct;

  const lines = spec.lines.filter((l) => l.trim().length > 0);
  const count = lines.length;

  // ---- Beat timeline (block-relative frames) ------------------------------
  const markDelay = frames(0.1, fps);
  const lineBase = frames(0.4, fps);
  const lineStep = frames(0.38, fps);
  const attrDelay = lineBase + lineStep * Math.max(0, count - 1) + frames(0.5, fps);

  // ---- Type & geometry ------------------------------------------------------
  const quoteSize = typeSize(height, "title");
  const authorSize = typeSize(height, "body");
  const sourceSize = typeSize(height, "caption");
  const lineHeight = 1.42;

  const markH = quoteSize * 0.9;
  const quoteH = count * quoteSize * lineHeight;
  const hasAttr = Boolean(spec.author || spec.source);
  const attrH = hasAttr ? space(height, 4) + authorSize * 1.5 : 0;
  const clusterH = markH + quoteH + attrH;
  const clusterTop = availH * LAYOUT.heroCenterPct - clusterH / 2;

  // ---- Animated values ------------------------------------------------------
  const markP = springIn(frame, fps, markDelay, "pop");
  const markC = clamp01(markP);
  const attrP = enterProgress(frame, attrDelay, frames(DUR.enterSec, fps));

  // Ken Burns drift — a near-still, linear scale+breathe over the whole hold.
  const driftFrames = Math.max(1, durationInFrames);
  const drift = interpolate(frame, [0, driftFrames], [1, 1.035], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const driftY = interpolate(frame, [0, driftFrames], [0, -space(height, 1.2)], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash, bottom-right — whisper-quiet layer opacity */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 82% 88%, ${accent} 0%, transparent 50%)`,
          opacity: 0.06,
          pointerEvents: "none",
        }}
      />

      {/* Drifting quote cluster, left-aligned editorial measure */}
      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: measure,
          transform: `translateY(${driftY.toFixed(2)}px) scale(${drift.toFixed(4)})`,
          transformOrigin: "50% 50%",
        }}
      >
        {/* Oversized opening quote mark */}
        <div
          style={{
            height: markH,
            fontFamily: theme.fonts.sans,
            fontSize: Math.round(height * 0.14),
            fontWeight: 800,
            lineHeight: 1,
            color: accent,
            opacity: 0.16 * markC,
            transform: `scale(${0.6 + 0.4 * markP})`,
            transformOrigin: "0% 100%",
            userSelect: "none",
          }}
        >
          “
        </div>

        {/* Lines rising out of their overflow masks, bottom edge first */}
        {lines.map((line, i) => {
          const p = springIn(frame, fps, lineBase + i * lineStep, "gentle");
          const c = clamp01(p);
          return (
            <div
              key={i}
              style={{ overflow: "hidden", paddingBottom: "0.1em", marginBottom: "-0.1em" }}
            >
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: quoteSize,
                  fontWeight: 600,
                  lineHeight,
                  letterSpacing: "0.01em",
                  color: theme.colors.fg,
                  transform: `translateY(${((1 - c) * 108).toFixed(2)}%)`,
                }}
              >
                {line}
              </div>
            </div>
          );
        })}

        {/* Attribution row: "—— 作者 · 出处" */}
        {hasAttr ? (
          <div
            style={{
              marginTop: space(height, 4),
              display: "flex",
              alignItems: "baseline",
              gap: space(height, 2),
              opacity: attrP,
              transform: `translateY(${(1 - attrP) * space(height, 2)}px)`,
            }}
          >
            <span
              style={{
                color: accent,
                fontSize: authorSize,
                fontWeight: 700,
                letterSpacing: "-0.1em",
              }}
            >
              ——
            </span>
            {spec.author ? (
              <span
                style={{
                  fontFamily: theme.fonts.sans,
                  color: theme.colors.fg,
                  fontSize: authorSize,
                  fontWeight: 600,
                  lineHeight: 1.5,
                }}
              >
                {spec.author}
              </span>
            ) : null}
            {spec.source ? (
              <span
                style={{
                  fontFamily: theme.fonts.sans,
                  color: theme.colors.muted,
                  fontSize: sourceSize,
                  fontWeight: 400,
                  lineHeight: 1.5,
                }}
              >
                {spec.source}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export default QuoteCard;
