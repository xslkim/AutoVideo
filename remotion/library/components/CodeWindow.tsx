/**
 * AutoVideo — Library component: CodeWindow
 *
 * macOS-style code window: traffic-light chrome with a centred filename, an
 * optional typewriter reveal (char-by-char, blinking block cursor), and a
 * narration-beat highlight that *glides* from line to line with a spring
 * instead of jumping (CodeBlock's scan jumps). Optional diff mode paints
 * added lines green / removed lines red with git-style +/− gutter markers
 * and a header stat pill; highlightLines keep a persistent accent emphasis.
 * Registry entry: see src/ai/visual-registry.ts ("CodeWindow").
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
  clamp01,
  resolveBeatSchedule,
  springIn,
  staggeredSpring,
} from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface CodeWindowSpec extends AccentOverride {
  /** Source code, "\n"-separated. Blank lines are preserved. */
  code: string;
  /** Language badge, e.g. "ts". Purely decorative — no real highlighting. */
  language?: string;
  /** File name centred in the window title bar, e.g. "train.py". */
  filename?: string;
  /** 1-based line numbers that keep a persistent accent emphasis plate. */
  highlightLines?: number[];
  /** Diff mode: 1-based added lines go green, removed lines red. */
  diff?: { added?: number[]; removed?: number[] };
  /** Typewriter reveal: lines type out char by char under a block cursor. */
  typewriter?: boolean;
}

export type CodeWindowProps = LibraryProps<CodeWindowSpec>;

// ---------------------------------------------------------------------------
// Micro-tokenizer — deterministic, regex-only, no grammar (same rules and
// palette slots as CodeBlock; duplicated because CodeBlock keeps it private)
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "import", "from", "export", "default", "class", "extends", "new", "await",
  "async", "try", "catch", "throw", "switch", "case", "break", "continue",
  "def", "lambda", "None", "True", "False", "in", "is", "not", "and", "or",
  "fn", "pub", "struct", "impl", "match", "use", "mod", "type", "interface",
  "enum", "package", "func", "go", "chan", "select",
]);

interface Token {
  text: string;
  kind: "keyword" | "string" | "comment" | "plain";
}

function tokenizeLine(line: string): Token[] {
  const re =
    /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_][A-Za-z0-9_]*)/g;
  const tokens: Token[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > cursor) {
      tokens.push({ text: line.slice(cursor, m.index), kind: "plain" });
    }
    const kind: Token["kind"] = m[1] !== undefined
      ? "comment"
      : m[2] !== undefined
        ? "string"
        : KEYWORDS.has(m[3]) ? "keyword" : "plain";
    tokens.push({ text: m[0], kind });
    cursor = m.index + m[0].length;
  }
  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor), kind: "plain" });
  }
  return tokens;
}

// GitHub-dark diff colours — semantic, theme-independent.
const DIFF_GREEN = "#3fb950";
const DIFF_GREEN_BG = "rgba(63,185,80,0.15)";
const DIFF_RED = "#f85149";
const DIFF_RED_BG = "rgba(248,81,73,0.15)";
// macOS traffic lights.
const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CodeWindow: React.FC<CodeWindowProps> = ({
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
  const code = theme.colors.code;
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;

  const lines = spec.code.split("\n");
  const count = lines.length;
  const durationSec = durationInFrames / fps;
  const tSec = frame / fps;

  const typewriter = spec.typewriter ?? false;
  const addedSet = new Set(spec.diff?.added ?? []);
  const removedSet = new Set(spec.diff?.removed ?? []);
  const hlSet = new Set(spec.highlightLines ?? []);
  const hasDiff = addedSet.size + removedSet.size > 0;

  // ---- Typewriter schedule --------------------------------------------------
  // Line i starts typing once lines before it are done (chars / speed plus a
  // short line pause). Pure function of frame — no wall clock anywhere.
  const CPS = 46;
  const TYPE_BASE_SEC = 0.55;
  const LINE_PAUSE_SEC = 0.09;
  const lineStartSec: number[] = [];
  {
    let acc = TYPE_BASE_SEC;
    for (const l of lines) {
      lineStartSec.push(acc);
      acc += l.length / CPS + LINE_PAUSE_SEC;
    }
  }
  const charsShown = lines.map((l, i) =>
    typewriter
      ? Math.max(0, Math.min(l.length, Math.floor((tSec - lineStartSec[i]) * CPS)))
      : l.length,
  );
  // Typing head: first line not yet complete (last line once all typed).
  let headLine = count - 1;
  for (let i = 0; i < count; i++) {
    if (charsShown[i] < lines[i].length) {
      headLine = i;
      break;
    }
  }
  const blinkHalf = Math.max(1, frames(0.53, fps));
  const cursorOn = Math.floor(frame / blinkHalf) % 2 === 0;

  // ---- Beat schedule → gliding scan line ------------------------------------
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const beatActive = activeIndexAt(schedule, tSec);
  // In typewriter mode the scan never runs ahead of the typing head.
  const scanMax = typewriter ? headLine : count - 1;
  const active = beatActive === -1 ? -1 : Math.min(beatActive, scanMax);
  const prevLine = Math.max(0, active - 1);
  const beatStartFrame =
    active > 0
      ? schedule[active].startSec * fps
      : active === 0
        ? schedule[0].startSec * fps
        : 0;
  // Spring 0→1 since the current beat started → the plate sweeps smoothly
  // from the previous line onto the freshly narrated one.
  const glideP = active >= 0 ? clamp01(springIn(frame, fps, beatStartFrame, "snappy")) : 0;
  const scanPos = active === -1 ? 0 : prevLine + (active - prevLine) * glideP;
  const scanLine = Math.round(scanPos);

  // ---- Type & geometry ------------------------------------------------------
  const baseCodeSize = typeSize(height, "code");
  const lineHeightRatio = 1.62;
  const maxListH = availH * 0.64;
  const fitSize = Math.min(
    baseCodeSize,
    (maxListH / Math.max(1, count)) / lineHeightRatio,
  );
  const codeSize = Math.max(fitSize, height * 0.012);
  const lineH = codeSize * lineHeightRatio;
  const headerH = space(height, 5.5);
  const padX = space(height, 3);
  const padY = space(height, 2.5);
  const listH = count * lineH;
  const gutterW = space(height, 5);
  const markerW = hasDiff ? space(height, 2.5) : 0;

  const panelWidth = Math.min(width * 0.82, width - marginX * 2);
  const panelH = headerH + padY * 2 + listH;
  const panelLeft = (width - panelWidth) / 2;
  const panelTop = Math.max(availH * 0.08, (availH - panelH) / 2);

  const panelIn = clamp01(springIn(frame, fps, 0, "gentle"));
  const headerP = clamp01(springIn(frame, fps, frames(0.12, fps), "gentle"));
  const dotSize = space(height, 1.4);
  const railW = Math.max(3, Math.round(height * 0.003));

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash behind the window */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 38%, ${accent} 0%, transparent 58%)`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: panelTop,
          left: panelLeft,
          width: panelWidth,
          backgroundColor: code.bg,
          borderRadius: space(height, 1.75),
          overflow: "hidden",
          opacity: panelIn,
          transform: `translateY(${(1 - panelIn) * space(height, 3)}px) scale(${0.97 + panelIn * 0.03})`,
          boxShadow: `0 ${space(height, 2)}px ${space(height, 6)}px rgba(0,0,0,0.45)`,
        }}
      >
        {/* Title bar: traffic lights + centred filename + badges */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            height: headerH,
            paddingLeft: padX,
            paddingRight: padX,
            borderBottom: `1px solid ${theme.colors.muted}33`,
            opacity: headerP,
          }}
        >
          {LIGHTS.map((c, i) => {
            const pop = springIn(frame, fps, frames(0.18 + i * 0.07, fps), "pop");
            return (
              <div
                key={i}
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: "50%",
                  backgroundColor: c,
                  opacity: clamp01(pop),
                  transform: `scale(${0.4 + 0.6 * pop})`,
                  marginRight: space(height, 1),
                }}
              />
            );
          })}

          {spec.filename ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                textAlign: "center",
                fontFamily: theme.fonts.mono,
                fontSize: typeSize(height, "label"),
                color: theme.colors.muted,
                lineHeight: 1.4,
                pointerEvents: "none",
              }}
            >
              {spec.filename}
            </div>
          ) : null}

          <div style={{ flex: 1 }} />

          {hasDiff ? (
            <div
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: typeSize(height, "label") * 0.85,
                lineHeight: 1.3,
                marginRight: spec.language ? space(height, 1.5) : 0,
              }}
            >
              <span style={{ color: DIFF_GREEN }}>+{addedSet.size}</span>
              <span style={{ color: theme.colors.muted }}> </span>
              <span style={{ color: DIFF_RED }}>−{removedSet.size}</span>
            </div>
          ) : null}
          {spec.language ? (
            <div
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: typeSize(height, "label") * 0.85,
                color: accent,
                border: `1px solid ${accent}`,
                borderRadius: space(height, 0.75),
                padding: `${space(height, 0.4)}px ${space(height, 1.2)}px`,
                lineHeight: 1.3,
                opacity: 0.9,
              }}
            >
              {spec.language}
            </div>
          ) : null}
        </div>

        {/* Code lines, with the gliding scan plate painted underneath */}
        <div style={{ position: "relative", padding: `${padY}px 0` }}>
          {active >= 0 ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: padY + scanPos * lineH,
                height: lineH,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: accent,
                  opacity: 0.12,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: railW,
                  backgroundColor: accent,
                  opacity: 0.9,
                }}
              />
            </div>
          ) : null}

          {lines.map((line, i) => {
            const lineNo = i + 1;
            const enter = typewriter
              ? 1
              : clamp01(
                  staggeredSpring(frame, fps, i, {
                    baseSec: 0.35,
                    stepSec: DUR.staggerDenseSec,
                    preset: "snappy",
                  }),
                );
            const isAdded = addedSet.has(lineNo);
            const isRemoved = removedSet.has(lineNo);
            const isHl = hlSet.has(lineNo);
            const isHead = typewriter && i === headLine;
            // Non-typewriter mode dims lines ahead of the narration beat so
            // the scan reads as a spotlight; typing mode reveals instead.
            const dimAhead = !typewriter && beatActive !== -1 && i > Math.max(beatActive, scanLine);
            const textOpacity = (isRemoved ? 0.75 : 1) * (dimAhead ? 0.5 : 1);
            const revealed = line.slice(0, charsShown[i]);

            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  height: lineH,
                  opacity: enter,
                  transform: typewriter
                    ? undefined
                    : `translateX(${(1 - enter) * -space(height, 1.5)}px)`,
                }}
              >
                {/* Diff / persistent emphasis plates */}
                {isAdded ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: DIFF_GREEN_BG,
                      pointerEvents: "none",
                    }}
                  />
                ) : null}
                {isRemoved ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: DIFF_RED_BG,
                      pointerEvents: "none",
                    }}
                  />
                ) : null}
                {isHl ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: accent,
                      opacity: 0.07,
                      pointerEvents: "none",
                    }}
                  />
                ) : null}

                {/* Line number gutter */}
                <div
                  style={{
                    width: gutterW,
                    flexShrink: 0,
                    paddingLeft: padX,
                    boxSizing: "border-box",
                    fontFamily: theme.fonts.mono,
                    fontSize: codeSize * 0.78,
                    lineHeight: 1,
                    color: i === scanLine && active >= 0 ? accent : code.comment,
                    opacity: i === scanLine && active >= 0 ? 1 : 0.55,
                    textAlign: "right",
                    paddingRight: space(height, 1.5),
                  }}
                >
                  {lineNo}
                </div>

                {/* Diff +/− marker column (only in diff mode) */}
                {hasDiff ? (
                  <div
                    style={{
                      width: markerW,
                      flexShrink: 0,
                      fontFamily: theme.fonts.mono,
                      fontSize: codeSize * 0.85,
                      lineHeight: 1,
                      textAlign: "center",
                      color: isAdded ? DIFF_GREEN : isRemoved ? DIFF_RED : "transparent",
                    }}
                  >
                    {isAdded ? "+" : isRemoved ? "−" : "·"}
                  </div>
                ) : null}

                {/* Tokenized source (+ typewriter cursor on the head line) */}
                <div
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: codeSize,
                    lineHeight: `${lineH}px`,
                    whiteSpace: "pre",
                    color: code.fg,
                    opacity: textOpacity,
                  }}
                >
                  {tokenizeLine(revealed).map((tok, j) => (
                    <span
                      key={j}
                      style={{
                        color:
                          tok.kind === "keyword"
                            ? code.keyword
                            : tok.kind === "string"
                              ? code.string
                              : tok.kind === "comment"
                                ? code.comment
                                : undefined,
                      }}
                    >
                      {tok.text}
                    </span>
                  ))}
                  {isHead ? (
                    <div
                      style={{
                        display: "inline-block",
                        width: codeSize * 0.58,
                        height: codeSize * 1.12,
                        backgroundColor: accent,
                        opacity: cursorOn ? 0.9 : 0,
                        verticalAlign: "text-bottom",
                      }}
                    />
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

export default CodeWindow;
