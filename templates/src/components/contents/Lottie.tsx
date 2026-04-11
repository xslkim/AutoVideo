/**
 * AutoVideo v2 — Lottie animation content component
 * Requires: npm install @remotion/lottie
 */
import React from 'react';
import { staticFile } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

interface LottieSpec {
  src: string;
  loop?: boolean;
  speed?: number;
}

interface Props {
  spec: LottieSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

export const LottieContent: React.FC<Props> = ({ spec, theme }) => {
  let LottieComp: React.FC<any> | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Lottie } = require('@remotion/lottie');
    LottieComp = Lottie;
  } catch (_e) { /* not installed */ }

  if (!LottieComp || !spec.src) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: theme.bgCard, borderRadius: theme.borderRadius,
      }}>
        <span style={{ fontFamily: theme.fonts.body, color: theme.fgMuted, fontSize: 32 }}>
          🎞 Lottie: {spec.src || '(no src)'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <LottieComp
        src={spec.src.startsWith('http') ? spec.src : staticFile(spec.src)}
        loop={spec.loop ?? false}
        playbackRate={spec.speed ?? 1}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
