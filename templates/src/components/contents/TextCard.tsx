/**
 * AutoVideo v2 — TextCard content component
 */
import React from 'react';
import { interpolate } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

interface TextCardLine {
  text: string;
  style?: 'hero' | 'title' | 'body' | 'caption' | 'mono';
  color?: string;
}

interface TextCardSpec {
  lines: TextCardLine[];
  align?: 'left' | 'center' | 'right';
  background?: string;
}

interface Props {
  spec: TextCardSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

export const TextCardContent: React.FC<Props> = ({ spec, frame, totalFrames, fps, rect, theme }) => {
  const { lines = [], align = 'center', background } = spec;

  // Stagger each line's entrance
  const lineCount = lines.length;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        justifyContent: 'center',
        padding: '5%',
        gap: 24,
        boxSizing: 'border-box',
      }}
    >
      {lines.map((line, i) => {
        const staggerDelay = (i / lineCount) * 0.4 * fps;
        const progress = interpolate(frame, [staggerDelay, staggerDelay + 0.5 * fps], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        const fontSize = (() => {
          switch (line.style) {
            case 'hero':    return theme.sizes.hero;
            case 'title':   return theme.sizes.title;
            case 'caption': return theme.sizes.caption;
            case 'mono':    return theme.sizes.code;
            default:        return theme.sizes.body;
          }
        })();

        const color = line.color === 'accent'  ? theme.accent
                    : line.color === 'accent2' ? theme.accent2
                    : line.color === 'danger'  ? theme.danger
                    : line.color === 'muted'   ? theme.fgMuted
                    : line.color ?? theme.fg;

        const fontFamily = line.style === 'mono' ? theme.fonts.mono : theme.fonts.body;

        return (
          <div
            key={i}
            style={{
              opacity: progress,
              transform: `translateY(${(1 - progress) * 30}px)`,
              fontFamily,
              fontSize,
              color,
              fontWeight: line.style === 'hero' || line.style === 'title' ? 700 : 400,
              lineHeight: 1.2,
              textAlign: align,
              letterSpacing: line.style === 'hero' ? '-0.02em' : 'normal',
            }}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
};
