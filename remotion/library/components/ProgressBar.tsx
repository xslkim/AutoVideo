/**
 * AutoVideo — Library component: ProgressBar
 *
 * Channel-packaging top rail: a hairline progress fill, diamond chapter
 * ticks that light up as the playhead sweeps past them, and a small mono
 * label naming the current chapter.
 *
 * The spec is pure whole-video data — `progress` and each chapter's `at`
 * are global 0..1 fractions computed by the caller. `progress` is either a
 * single value (static, e.g. previews) or a `{ from, to }` pair that the
 * component interpolates linearly across the block-local `frame`, so the
 * rail sweeps smoothly and stays perfectly continuous across block cuts:
 * everything (fill, ticks, label fade, head glow) is a pure function of
 * the resolved progress.
 *
 * Registry entry: see src/ai/visual-registry.ts ("ProgressBar").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { LAYOUT, space, typeSize } from "../tokens";
import { breathe, clamp01 } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface ProgressBarChapter {
  /** Chapter title shown in the label while this chapter is active. */
  title: string;
  /** Chapter start as a fraction of the whole video (0..1). */
  at: number;
}

export interface ProgressBarSpec extends AccentOverride {
  /**
   * Whole-video playback progress, 0..1. A bare number pins the rail to a
   * static position; `{ from, to }` sweeps it from `from` (block start) to
   * `to` (block end) as the block-local frame advances.
   */
  progress: number | { from: number; to: number };
  /** Chapter ticks along the rail; sorted by `at` (defensively re-sorted). */
  chapters?: ProgressBarChapter[];
  /** Show the active chapter name under the rail. Default true. */
  showLabel?: boolean;
}

export type ProgressBarProps = LibraryProps<ProgressBarSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ProgressBar: React.FC<ProgressBarProps> = ({
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
  void subtitleSafeBottom; // top rail: the subtitle band never intersects it
  void lineTimings;

  const accent = spec.accent ?? theme.colors.accent;
  const progressRaw = spec.progress;
  const progress = clamp01(
    typeof progressRaw === "number"
      ? progressRaw
      : progressRaw.from +
          clamp01(frame / Math.max(1, durationInFrames)) *
            (progressRaw.to - progressRaw.from)
  );
  const chapters = [...(spec.chapters ?? [])]
    .map((c) => ({ title: c.title, at: clamp01(c.at) }))
    .sort((a, b) => a.at - b.at);
  const showLabel = spec.showLabel ?? true;

  // ---- Geometry -------------------------------------------------------------
  const barH = Math.max(3, Math.round(height * 0.0035)); // 4px @1080p
  const diamondSize = Math.max(8, Math.round(height * 0.0085)); // 9px @1080p
  const railTopPad = Math.max(0, (diamondSize - barH) / 2); // diamonds never clip at y=0
  const labelSize = typeSize(height, "label");
  const marginX = width * LAYOUT.marginXPct;

  // ---- Progress-driven animation values --------------------------------------
  // Track fades in over the first ~1% of the video (continuous across blocks).
  const trackP = clamp01(progress / 0.01);
  // A tick lights up as the playhead sweeps across it (window in progress units).
  const tickWindow = 0.015;
  // Head glow breathes as a pure function of progress — phase is locked to the
  // global timeline, so the pulse does not restart at block cuts.
  const headGlow = breathe(0, fps, { phase: progress * 6, min: 0.45, max: 1 });

  // Active chapter: last tick at or behind the playhead.
  let activeIdx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].at <= progress + 1e-6) activeIdx = i;
    else break;
  }
  const active = activeIdx >= 0 ? chapters[activeIdx] : null;
  // Chapter label fades in as the playhead moves past the chapter boundary.
  const labelWindow = 0.012;
  const labelP = active ? clamp01((progress - active.at) / labelWindow) : 0;

  const fillPct = (progress * 100).toFixed(3);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Rail zone: tall enough that diamond ticks never clip the frame edge */}
      <div style={{ position: "absolute", top: 0, left: 0, width, height: diamondSize }}>
        {/* Track */}
        <div
          style={{
            position: "absolute",
            top: railTopPad,
            left: 0,
            width,
            height: barH,
            backgroundColor: theme.colors.fg,
            opacity: 0.12 * trackP,
          }}
        />
        {/* Fill */}
        <div
          style={{
            position: "absolute",
            top: railTopPad,
            left: 0,
            width: `${fillPct}%`,
            height: barH,
            backgroundColor: accent,
            opacity: 0.95,
          }}
        />
        {/* Head dot with a soft glow riding the fill tip */}
        {progress > 0.002 ? (
          <div
            style={{
              position: "absolute",
              top: railTopPad + barH / 2,
              left: `${fillPct}%`,
              width: barH + 4,
              height: barH + 4,
              borderRadius: "50%",
              backgroundColor: accent,
              boxShadow: `0 0 ${Math.round(4 + headGlow * 6)}px ${accent}`,
              opacity: headGlow,
              transform: "translate(-50%, -50%)",
            }}
          />
        ) : null}
        {/* Chapter ticks — diamonds that fill in as the playhead passes */}
        {chapters.map((c, i) => {
          const p = clamp01((progress - c.at) / tickWindow);
          const isActive = i === activeIdx;
          const scale = (0.7 + 0.3 * p) * (isActive ? 1.15 : 1);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: diamondSize / 2,
                left: `${(c.at * 100).toFixed(3)}%`,
                width: diamondSize - 3,
                height: diamondSize - 3,
                border: `${Math.max(1.5, Math.round(height * 0.0015))}px solid ${accent}`,
                borderRadius: 2,
                backgroundColor: accent,
                backgroundClip: "padding-box",
                opacity: (0.35 + 0.65 * p) * trackP,
                // Hollow until reached: the fill fades in via opacity over the
                // accent track colour — reached ticks read as solid diamonds.
                transform: `translate(-50%, -50%) rotate(45deg) scale(${scale})`,
              }}
            >
              {/* Inner mask punches the centre back out while unreached */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: theme.colors.bg,
                  opacity: 1 - p,
                  borderRadius: 1,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Current chapter label, aligned with the content column */}
      {showLabel && active ? (
        <div
          style={{
            position: "absolute",
            top: diamondSize + space(height, 1.5),
            left: marginX,
            display: "flex",
            alignItems: "center",
            gap: space(height, 1.5),
            opacity: labelP,
            transform: `translateY(${(1 - labelP) * -space(height, 1)}px)`,
          }}
        >
          <div
            style={{
              width: Math.max(6, Math.round(height * 0.006)),
              height: Math.max(6, Math.round(height * 0.006)),
              backgroundColor: accent,
              transform: "rotate(45deg)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: labelSize,
              letterSpacing: "0.12em",
              lineHeight: 1.4,
              color: theme.colors.fg,
            }}
          >
            <span style={{ color: accent, fontWeight: 500 }}>
              {String(activeIdx + 1).padStart(2, "0")}
            </span>
            <span style={{ opacity: 0.85 }}>{"  "}{active.title}</span>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export default ProgressBar;
