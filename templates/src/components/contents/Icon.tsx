/**
 * AutoVideo v2 — Icon content component (Lucide icons)
 */
import React from 'react';
import { interpolate } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

interface IconSpec {
  name: string;       // e.g. "lucide:sparkles"
  size?: number;      // fraction of rect short-side (0–1)
  color?: string;     // theme token or CSS color
  stroke?: number;
  anim?: 'none' | 'pulse' | 'rotate' | 'bounce';
}

interface Props {
  spec: IconSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

export const IconContent: React.FC<Props> = ({ spec, frame, fps, rect, theme }) => {
  const color = spec.color === 'accent'  ? theme.accent
              : spec.color === 'accent2' ? theme.accent2
              : spec.color === 'danger'  ? theme.danger
              : spec.color === 'muted'   ? theme.fgMuted
              : spec.color ?? theme.accent;

  // Animation transform
  const transform = (() => {
    switch (spec.anim ?? 'none') {
      case 'pulse': {
        const scale = 1 + 0.05 * Math.sin((frame / fps) * Math.PI * 2);
        return `scale(${scale})`;
      }
      case 'rotate':
        return `rotate(${(frame / fps) * 30}deg)`;
      case 'bounce': {
        const offset = Math.abs(Math.sin((frame / fps) * Math.PI * 1.5)) * 20;
        return `translateY(${-offset}px)`;
      }
      default:
        return undefined;
    }
  })();

  // The icon name format: "lucide:sparkles" → dynamically import from lucide-react
  const iconName = (spec.name ?? 'lucide:circle').replace(/^lucide:/, '');

  // Convert kebab-case to PascalCase for lucide import
  const ComponentName = iconName
    .split('-')
    .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

  let IconComponent: React.FC<any> | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lucide = require('lucide-react');
    IconComponent = lucide[ComponentName] ?? null;
  } catch (_e) { /* lucide not installed */ }

  const iconSize = Math.min(rect.w, rect.h) * (spec.size ?? 0.3) * 1920; // approx px

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ transform }}>
        {IconComponent ? (
          <IconComponent
            size={iconSize}
            color={color}
            strokeWidth={spec.stroke ?? 2}
          />
        ) : (
          /* Fallback: colored circle */
          <div style={{
            width: iconSize, height: iconSize, borderRadius: '50%',
            background: color, opacity: 0.8,
          }} />
        )}
      </div>
    </div>
  );
};
