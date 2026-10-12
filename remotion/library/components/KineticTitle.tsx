/**
 * AutoVideo — Library component: KineticTitle
 *
 * High-energy kinetic-typography headline: the title is split into chars or
 * words and every unit pops in with a staggered spring — rising from below,
 * scaling up with a whisper of overshoot and (optionally) sharpening out of
 * a blur — so the line cascades into place. An accent kicker chip sits above
 * the title and an optional muted subtitle enters once the last unit has
 * started moving. Registry entry: see src/ai/visual-registry.ts
 * ("KineticTitle").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import { clamp01, enterProgress, springIn } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface KineticTitleSpec extends AccentOverride {
  /** Headline text; "\n" starts a new line (the cascade continues across lines). */
  title: string;
  /** Optional muted line under the title. */
  subtitle?: string;
  /** Small accent chip above the title, e.g. "核心概念". */
  kicker?: string;
  /** Text alignment of the whole block. Default "center". */
  align?: "center" | "left";
  /**
   * Split the title per character or per word. Default "char" (best for CJK);
   * "word" suits space-separated titles.
   */
  by?: "char" | "word";
  /** Blur each unit while it enters. Default true. */
  blurIn?: boolean;
}

export type KineticTitleProps = LibraryProps<KineticTitleSpec>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split one title line into animatable units. `null` marks a word gap (from
 * whitespace) that is rendered as a fixed-width spacer and never animated.
 * Array.from keeps surrogate pairs intact.
 */
function splitUnits(line: string, by: "char" | "word"): (string | null)[] {
  if (by === "word") {
    const words = line.split(/\s+/).filter((w) => w.length > 0);
    const out: (string | null)[] = [];
    words.forEach((w, i) => {
      if (i > 0) out.push(null);
      out.push(w);
    });
    return out;
  }
  return Array.from(line).map((c) => (/\s/.test(c) ? null : c));
}

type RenderUnit = { kind: "gap" } | { kind: "unit"; text: string; index: number };

/** Attach a global stagger index to every real unit, across all lines. */
function indexUnits(lines: (string | null)[][]): { units: RenderUnit[][]; count: number } {
  let running = 0;
  const units = lines.map((line) =>
    line.map((u): RenderUnit =>
      u === null ? { kind: "gap" } : { kind: "unit", text: u, index: running++ },
    ),
  );
  return { units, count: running };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const KineticTitle: React.FC<KineticTitleProps> = ({
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
  const by = spec.by ?? "char";
  const blurIn = spec.blurIn ?? true;
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;
  const contentWidth = width - marginX * 2;

  // ---- Beat timeline (block-relative frames) ------------------------------
  const kickerDelay = frames(0.08, fps);
  const titleBase = spec.kicker ? frames(0.32, fps) : frames(0.12, fps);
  const unitStepSec = by === "word" ? DUR.staggerSec : DUR.staggerDenseSec;
  const unitStepFrames = frames(unitStepSec, fps);

  // ---- Type & geometry ------------------------------------------------------
  const titleLines = spec.title.split("\n").filter((l) => l.trim().length > 0);
  const { units: unitsPerLine, count: unitCount } = indexUnits(
    titleLines.map((l) => splitUnits(l, by)),
  );
  const titleSize = typeSize(height, "display");
  const subtitleSize = typeSize(height, "subtitle");
  const kickerSize = typeSize(height, "label");
  const gapW = Math.round(titleSize * 0.28);
  const maxBlur = Math.max(4, Math.round(height * 0.007));
  const rise = space(height, 4);

  // Content cluster height → optically centred slightly above middle.
  const chipPadY = space(height, 1.2);
  const kickerH = spec.kicker ? kickerSize * 1.4 + chipPadY * 2 + space(height, 3) : 0;
  const titleH = titleLines.length * titleSize * 1.22;
  const subtitleH = spec.subtitle ? subtitleSize * 1.5 + space(height, 3) : 0;
  const clusterH = kickerH + titleH + subtitleH;
  const clusterTop = availH * LAYOUT.heroCenterPct - clusterH / 2;

  const justifyContent = align === "center" ? "center" : "flex-start";
  const textAlign = align === "center" ? ("center" as const) : ("left" as const);

  // ---- Animated values ------------------------------------------------------
  const kickerP = springIn(frame, fps, kickerDelay, "pop");
  const kickerC = clamp01(kickerP);
  // The subtitle waits until the last unit has at least started moving.
  const lastUnitDelay = titleBase + unitStepFrames * Math.max(0, unitCount - 1);
  const subtitleDelay = lastUnitDelay + frames(0.45, fps);
  const subtitleP = enterProgress(frame, subtitleDelay, frames(DUR.enterSec, fps));

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash behind the headline — whisper-quiet layer opacity */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 38%, ${accent} 0%, transparent 55%)`,
          opacity: 0.06,
          pointerEvents: "none",
        }}
      />

      {/* Centred content cluster */}
      <div
        style={{
          position: "absolute",
          top: clusterTop,
          left: marginX,
          width: contentWidth,
          display: "flex",
          flexDirection: "column",
          alignItems: justifyContent,
        }}
      >
        {spec.kicker ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              paddingTop: chipPadY,
              paddingBottom: chipPadY,
              paddingLeft: space(height, 2.5),
              paddingRight: space(height, 2.5),
              marginBottom: space(height, 3),
              border: `${Math.max(1, Math.round(height * 0.0014))}px solid ${accent}`,
              borderRadius: kickerSize * 1.4,
              backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
              fontFamily: theme.fonts.mono,
              fontSize: kickerSize,
              letterSpacing: "0.14em",
              lineHeight: 1.4,
              color: accent,
              fontWeight: 500,
              opacity: kickerC,
              transform: `translateY(${(1 - kickerC) * -space(height, 1)}px) scale(${0.5 + 0.5 * kickerP})`,
              transformOrigin: "50% 50%",
            }}
          >
            {spec.kicker}
          </div>
        ) : null}

        {unitsPerLine.map((units, li) => (
          <div
            key={li}
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent,
              width: "100%",
              fontFamily: theme.fonts.sans,
              fontSize: titleSize,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.22,
              color: theme.colors.fg,
              textAlign,
            }}
          >
            {units.map((u, ui) => {
              if (u.kind === "gap") {
                return <span key={ui} style={{ display: "inline-block", width: gapW }} />;
              }
              const p = springIn(frame, fps, titleBase + u.index * unitStepFrames, "pop");
              const c = clamp01(p);
              return (
                <span
                  key={ui}
                  style={{
                    display: "inline-block",
                    opacity: c,
                    transform:
                      `translateY(${((1 - p) * rise).toFixed(2)}px) ` +
                      `scale(${(0.55 + 0.45 * p).toFixed(4)}) ` +
                      `rotate(${((1 - c) * 4).toFixed(2)}deg)`,
                    transformOrigin: "50% 100%",
                    filter: blurIn ? `blur(${((1 - c) * maxBlur).toFixed(2)}px)` : undefined,
                  }}
                >
                  {u.text}
                </span>
              );
            })}
          </div>
        ))}

        {spec.subtitle ? (
          <div
            style={{
              marginTop: space(height, 3),
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

export default KineticTitle;
