/**
 * AutoVideo — Library component: CodeBlock
 *
 * Editor-style code panel: title tab, language badge, line numbers and a
 * deterministic micro-tokenizer (keywords / strings / comments) painted with
 * theme.colors.code. The narration beat (lineTimings, or an even rhythm when
 * empty) walks a highlight bar down the lines.
 * Registry entry: see src/ai/visual-registry.ts ("CodeBlock").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, availHeight, frames, space, typeSize } from "../tokens";
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

export interface CodeBlockSpec extends AccentOverride {
  /** Tab / file name shown in the panel header, e.g. "train.py". */
  title?: string;
  /** Language badge, e.g. "ts". Purely decorative — no real highlighting. */
  language?: string;
  /** Source code, "\n"-separated. Blank lines are preserved. */
  code: string;
}

export type CodeBlockProps = LibraryProps<CodeBlockSpec>;

// ---------------------------------------------------------------------------
// Micro-tokenizer — deterministic, regex-only, no grammar
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

/**
 * Split one source line into coloured spans. Order of the alternation
 * matters: comments first (they eat the rest of the line), then strings,
 * then word tokens. Anything unmatched falls through as plain text.
 */
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CodeBlock: React.FC<CodeBlockProps> = ({
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

  const lines = spec.code.split("\n");
  const count = lines.length;

  // ---- Beat schedule over code lines --------------------------------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const active = activeIndexAt(schedule, frame / fps);

  // ---- Type & geometry ----------------------------------------------------
  // Fit the font so the whole listing stays inside 62% of the safe area.
  const baseCodeSize = typeSize(height, "code");
  const lineHeightRatio = 1.62;
  const maxListH = availH * 0.62;
  const fitSize = Math.min(
    baseCodeSize,
    (maxListH / Math.max(1, count)) / lineHeightRatio,
  );
  const codeSize = Math.max(fitSize, height * 0.012); // never microscopic
  const lineH = codeSize * lineHeightRatio;
  const headerH = space(height, 5.5);
  const padX = space(height, 3);
  const padY = space(height, 2.5);
  const listH = count * lineH;

  const panelWidth = Math.min(width * 0.8, width - 2 * width * 0.0625);
  const panelH = headerH + padY * 2 + listH;
  const panelLeft = (width - panelWidth) / 2;
  const panelTop = Math.max(availH * 0.08, (availH - panelH) / 2);

  const panelIn = clamp01(springIn(frame, fps, 0, "gentle"));
  const headerP = clamp01(springIn(frame, fps, frames(0.15, fps), "gentle"));

  const gutterW = space(height, 5);
  const dot = space(height, 1.2);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash behind the panel */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 40%, ${accent} 0%, transparent 60%)`,
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
        {/* Header: window dots + file tab + language badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: headerH,
            paddingLeft: padX,
            paddingRight: padX,
            borderBottom: `1px solid ${theme.colors.muted}33`,
            opacity: headerP,
          }}
        >
          {[theme.colors.muted, theme.colors.muted, accent].map((c, i) => (
            <div
              key={i}
              style={{
                width: dot,
                height: dot,
                borderRadius: "50%",
                backgroundColor: c,
                opacity: i < 2 ? 0.5 : 0.9,
                marginRight: space(height, 1),
              }}
            />
          ))}
          {spec.title ? (
            <div
              style={{
                marginLeft: space(height, 1.5),
                fontFamily: theme.fonts.mono,
                fontSize: typeSize(height, "label"),
                color: theme.colors.muted,
                lineHeight: 1.4,
              }}
            >
              {spec.title}
            </div>
          ) : null}
          <div style={{ flex: 1 }} />
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

        {/* Code lines */}
        <div style={{ padding: `${padY}px 0` }}>
          {lines.map((line, i) => {
            const enter = staggeredSpring(frame, fps, i, {
              baseSec: 0.3,
              stepSec: DUR.staggerDenseSec,
              preset: "snappy",
            });
            const p = clamp01(enter);
            const isActive = i === active;
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  height: lineH,
                  opacity: p,
                  transform: `translateX(${(1 - p) * -space(height, 1.5)}px)`,
                }}
              >
                {/* Current-line highlight plate + rail */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: accent,
                    opacity: isActive ? 0.12 : 0,
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: Math.max(3, Math.round(height * 0.003)),
                    backgroundColor: accent,
                    opacity: isActive ? 1 : 0,
                  }}
                />

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
                    color: isActive ? accent : code.comment,
                    opacity: isActive ? 1 : 0.55,
                    textAlign: "right",
                    paddingRight: space(height, 1.5),
                  }}
                >
                  {i + 1}
                </div>

                {/* Tokenized source */}
                <div
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: codeSize,
                    lineHeight: `${lineH}px`,
                    whiteSpace: "pre",
                    // All lines stay readable; lines ahead of the narration
                    // beat dim so the current line reads as the spotlight.
                    color: code.fg,
                    opacity: active === -1 || i <= active ? 1 : 0.45,
                  }}
                >
                  {tokenizeLine(line).map((tok, j) => (
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default CodeBlock;
