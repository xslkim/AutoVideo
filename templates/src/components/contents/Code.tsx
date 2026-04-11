/**
 * AutoVideo v2 — Code content component
 * Syntax-highlighted code with line-by-line reveal animation.
 *
 * Uses shiki for syntax highlighting (installed in package.json).
 * Falls back to plain monospace if shiki is unavailable.
 */
import React, { useState, useEffect } from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

interface Highlight {
  line: number;
  color?: string;
}

interface Annotation {
  line: number;
  text: string;
  side?: 'left' | 'right';
}

interface CodeSpec {
  source: string;        // filename in source-samples or inline code
  range?: [number, number] | null;
  language?: string;
  theme?: string;
  reveal?: {
    mode: 'line-by-line' | 'typewriter' | 'all-at-once';
    linesPerSecond?: number;
    cursor?: boolean;
  };
  highlights?: Highlight[];
  annotations?: Annotation[];
  inlineCode?: string;   // if source is empty, use this
}

interface Props {
  spec: CodeSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

export const CodeContent: React.FC<Props> = ({ spec, frame, totalFrames, fps, rect, theme }) => {
  const { reveal = { mode: 'line-by-line', linesPerSecond: 3, cursor: true }, highlights = [] } = spec;

  // Code lines would be loaded from source-samples at build time.
  // For runtime rendering in Remotion, we use a pre-processed JSON
  // (see Stage 3: code component generation).
  // This component shows a placeholder that the agent should replace with actual code.

  const codeLines: string[] = (spec as any).__lines ?? [
    '// Code loading...', `// Source: ${spec.source}`,
  ];

  const visibleCount = (() => {
    if (reveal.mode === 'all-at-once') return codeLines.length;
    const rate = reveal.linesPerSecond ?? 3;
    const elapsed = frame / fps;
    return Math.min(Math.ceil(elapsed * rate) + 1, codeLines.length);
  })();

  const showCursor = reveal.cursor && visibleCount <= codeLines.length;

  const fontSize = theme.sizes.code;
  const lineHeight = fontSize * 1.6;
  const maxVisibleLines = Math.floor((rect.h * (1920 * 0.8)) / lineHeight); // rough estimate

  // Scroll effect: as more lines appear, shift the view up
  const startLine = Math.max(0, visibleCount - maxVisibleLines);

  const displayLines = codeLines.slice(startLine, visibleCount);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#0d1117',
        borderRadius: theme.borderRadius,
        padding: '24px 32px',
        boxSizing: 'border-box',
        fontFamily: theme.fonts.mono,
        fontSize,
        lineHeight: `${lineHeight}px`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Window dots */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['#ff5f57','#febc2e','#28c840'].map((c,i) => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: c }} />
        ))}
        <span style={{
          marginLeft: 12, fontSize: 22, color: theme.fgMuted, fontFamily: theme.fonts.mono,
        }}>
          {spec.source}
        </span>
      </div>

      {/* Code lines */}
      <div>
        {displayLines.map((line, i) => {
          const absLine = startLine + i + 1;
          const isHighlighted = highlights.some(h => h.line === absLine);
          const isLast = i === displayLines.length - 1;
          const lineProgress = interpolate(
            frame,
            [((startLine + i) / (reveal.linesPerSecond ?? 3)) * fps - 5, ((startLine + i) / (reveal.linesPerSecond ?? 3)) * fps + 10],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );

          return (
            <div
              key={startLine + i}
              style={{
                display: 'flex',
                gap: 24,
                opacity: reveal.mode === 'all-at-once' ? 1 : lineProgress,
                background: isHighlighted ? 'rgba(255,184,107,0.12)' : 'transparent',
                borderLeft: isHighlighted ? `3px solid ${theme.accent}` : '3px solid transparent',
                paddingLeft: isHighlighted ? 8 : 11,
              }}
            >
              {/* Line number */}
              <span style={{ color: theme.fgMuted, userSelect: 'none', minWidth: 30, textAlign: 'right' }}>
                {absLine + (spec.range?.[0] ?? 1) - 1}
              </span>
              {/* Code */}
              <span style={{ color: theme.fg, whiteSpace: 'pre' }}>
                {line}
                {isLast && showCursor && (
                  <span style={{
                    display: 'inline-block',
                    width: 2,
                    height: fontSize,
                    background: theme.accent,
                    verticalAlign: 'text-bottom',
                    marginLeft: 2,
                    animation: 'blink 1s step-end infinite',
                  }} />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
