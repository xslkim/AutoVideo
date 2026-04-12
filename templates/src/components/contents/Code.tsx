/**
 * AutoVideo v2 — Code content component
 *
 * Renders syntax-highlighted code with line-by-line reveal animation.
 *
 * IMPORTANT: This component does NOT run shiki at render time (Remotion renders
 * in a sandboxed browser). Instead, Stage 3 pre-processes code files with shiki
 * and stores tokenized output in spec.__lines as:
 *
 *   __lines: Array<{ raw: string; tokens: Array<{ text: string; color: string }> }>
 *
 * Stage 3 (scripts/preprocess-code.mjs) writes these into blocks.json.
 * If __lines is missing, the component falls back to plain monospace rendering.
 */
import React from 'react';
import { interpolate } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Token {
  text: string;
  color: string;
}

interface CodeLine {
  raw: string;
  tokens: Token[];
}

interface Highlight {
  line: number;    // 1-based, relative to the displayed range
  color?: string;  // 'accent' | 'accent2' | 'danger' | any hex
}

interface Annotation {
  line: number;
  text: string;
  side?: 'left' | 'right';
}

interface CodeSpec {
  source: string;
  range?: [number, number] | null;
  language?: string;
  reveal?: {
    mode: 'line-by-line' | 'typewriter' | 'all-at-once';
    linesPerSecond?: number;
    cursor?: boolean;
  };
  highlights?: Highlight[];
  annotations?: Annotation[];
  // Injected by Stage 3 (scripts/preprocess-code.mjs)
  __lines?: CodeLine[];
}

interface Props {
  spec: CodeSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CodeContent: React.FC<Props> = ({ spec, frame, fps, rect, theme }) => {
  const { reveal = { mode: 'line-by-line', linesPerSecond: 3, cursor: true }, highlights = [] } = spec;

  // Use pre-tokenized lines from Stage 3, or fall back to plain text
  const codeLines: CodeLine[] = spec.__lines ?? [
    { raw: `// Source: ${spec.source}`, tokens: [{ text: `// Source: ${spec.source}`, color: theme.fgMuted }] },
    { raw: '// (run Stage 3 to preprocess code)', tokens: [{ text: '// (run Stage 3 to preprocess code)', color: theme.fgMuted }] },
  ];

  // ── Reveal logic ──────────────────────────────────────────────────────────

  const visibleCount = (() => {
    if (reveal.mode === 'all-at-once') return codeLines.length;
    const rate = reveal.linesPerSecond ?? 3;
    return Math.min(Math.ceil((frame / fps) * rate) + 1, codeLines.length);
  })();

  const showCursor = (reveal.cursor ?? true) && visibleCount <= codeLines.length;

  // ── Scroll: keep the latest lines visible ────────────────────────────────

  const fontSize = theme.sizes.code;
  const lineHeight = fontSize * 1.6;
  // Estimate max lines that fit in the rect (rect.h is normalized; assume 1080px height)
  const rectHeightPx = rect.h * 1080 * 0.85; // leave room for header
  const maxVisibleLines = Math.max(1, Math.floor(rectHeightPx / lineHeight));
  const startLine = Math.max(0, visibleCount - maxVisibleLines);
  const displayLines = codeLines.slice(startLine, visibleCount);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const resolveColor = (c: string | undefined): string => {
    if (!c || c === 'accent')  return theme.accent;
    if (c === 'accent2')       return theme.accent2;
    if (c === 'danger')        return theme.danger;
    return c;
  };

  const lineEnterProgress = (lineIdx: number): number => {
    if (reveal.mode === 'all-at-once') return 1;
    const rate = reveal.linesPerSecond ?? 3;
    const absIdx = startLine + lineIdx;
    const appearFrame = (absIdx / rate) * fps;
    return interpolate(frame, [appearFrame - 3, appearFrame + 8], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#0d1117',
      borderRadius: 12,
      padding: '20px 28px',
      boxSizing: 'border-box',
      fontFamily: theme.fonts.mono,
      fontSize,
      lineHeight: `${lineHeight}px`,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Window chrome */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
          <div key={i} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />
        ))}
        <span style={{ marginLeft: 10, fontSize: fontSize * 0.75, color: theme.fgMuted, fontFamily: theme.fonts.mono }}>
          {spec.source}{spec.range ? ` : ${spec.range[0]}–${spec.range[1]}` : ''}
        </span>
      </div>

      {/* Code lines */}
      {displayLines.map((line, i) => {
        const absLineNum = startLine + i + 1;
        const displayLineNum = absLineNum + (spec.range?.[0] ?? 1) - 1;
        const isHighlighted = highlights.some(h => h.line === absLineNum);
        const highlightColor = highlights.find(h => h.line === absLineNum)?.color;
        const isLastVisible = i === displayLines.length - 1;
        const opacity = lineEnterProgress(i);
        const annotation = spec.annotations?.find(a => a.line === absLineNum);

        return (
          <div
            key={absLineNum}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 20,
              opacity,
              background: isHighlighted ? `${resolveColor(highlightColor)}1a` : 'transparent',
              borderLeft: isHighlighted ? `3px solid ${resolveColor(highlightColor)}` : '3px solid transparent',
              paddingLeft: isHighlighted ? 8 : 11,
              position: 'relative',
            }}
          >
            {/* Line number */}
            <span style={{
              color: theme.fgMuted,
              userSelect: 'none',
              minWidth: 28,
              textAlign: 'right',
              flexShrink: 0,
              fontSize: fontSize * 0.85,
            }}>
              {displayLineNum}
            </span>

            {/* Tokenized code */}
            <span style={{ color: theme.fg, whiteSpace: 'pre', flex: 1 }}>
              {line.tokens.length > 0
                ? line.tokens.map((tok, ti) => (
                    <span key={ti} style={{ color: tok.color }}>{tok.text}</span>
                  ))
                : line.raw
              }
              {/* Blinking cursor on last visible line */}
              {isLastVisible && showCursor && (
                <span style={{
                  display: 'inline-block',
                  width: 2,
                  height: fontSize,
                  background: theme.accent,
                  verticalAlign: 'text-bottom',
                  marginLeft: 2,
                  opacity: Math.round(frame / 15) % 2 === 0 ? 1 : 0,
                }} />
              )}
            </span>

            {/* Side annotation bubble */}
            {annotation && (
              <span style={{
                position: 'absolute',
                [annotation.side === 'left' ? 'right' : 'left']: '100%',
                top: 0,
                background: theme.accent,
                color: theme.bg,
                fontSize: fontSize * 0.7,
                padding: '2px 8px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                opacity,
              }}>
                {annotation.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
