/**
 * AutoVideo v2 — Image content component with optional Ken Burns effect
 */
import React from 'react';
import { Img, staticFile, interpolate } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

interface KenBurns {
  from: number;  // start scale
  to: number;    // end scale
  anchor?: 'center' | 'top-left' | 'bottom-right';
}

interface ImageSpec {
  src: string;
  source?: 'user' | 'ai-generated' | 'url';
  fit?: 'contain' | 'cover' | 'stretch';
  kenBurns?: KenBurns;
  altText?: string;
}

interface Props {
  spec: ImageSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

export const ImageContent: React.FC<Props> = ({ spec, frame, totalFrames, theme }) => {
  const { src, fit = 'contain', kenBurns } = spec;

  const scale = kenBurns
    ? interpolate(frame, [0, totalFrames], [kenBurns.from, kenBurns.to], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;

  const transformOrigin = (() => {
    switch (kenBurns?.anchor) {
      case 'top-left':     return 'top left';
      case 'bottom-right': return 'bottom right';
      default:             return 'center center';
    }
  })();

  if (!src) {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: theme.bgCard,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: theme.borderRadius,
      }}>
        <span style={{ fontFamily: theme.fonts.body, color: theme.fgMuted, fontSize: 32 }}>
          🖼 图片未找到
        </span>
      </div>
    );
  }

  const imgSrc = src.startsWith('http') ? src : staticFile(src);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: theme.borderRadius }}>
      <Img
        src={imgSrc}
        style={{
          width: '100%',
          height: '100%',
          objectFit: fit === 'stretch' ? 'fill' : fit,
          transform: `scale(${scale})`,
          transformOrigin,
        }}
      />
    </div>
  );
};
