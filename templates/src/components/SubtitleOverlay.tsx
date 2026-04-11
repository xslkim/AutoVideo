/**
 * AutoVideo v2 — SubtitleOverlay
 * Single-line subtitle renderer with smooth transitions and emphasis highlighting.
 */

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { getTheme } from '../engine/theme';
import type { SubtitleEntry } from '../../types/block';

interface SubtitleOverlayProps {
  subtitles: SubtitleEntry[];
  frame: number;
  fps: number;
  enterDurationFrames: number;
  exitDurationFrames: number;
  totalFrames: number;
}

const CROSSFADE_FRAMES = 5;  // ~0.17s at 30fps

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  subtitles,
  frame,
  fps,
  enterDurationFrames,
  exitDurationFrames,
  totalFrames,
}) => {
  const theme = getTheme();
  const safeArea = theme.subtitleSafeArea;

  if (!subtitles || subtitles.length === 0) return null;

  const currentMs = (frame / fps) * 1000;

  // Find the active subtitle segment
  const activeIdx = subtitles.findIndex(
    (s) => currentMs >= s.startMs && currentMs < s.endMs
  );

  if (activeIdx === -1) return null;

  const sub = subtitles[activeIdx];

  // Subtitle block opacity: fade in/out at enter/exit of the entire block
  const blockOpacity = (() => {
    const fadeInEnd  = enterDurationFrames;
    const fadeOutStart = totalFrames - exitDurationFrames;
    if (frame < fadeInEnd) {
      return interpolate(frame, [0, fadeInEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    }
    if (frame > fadeOutStart) {
      return interpolate(frame, [fadeOutStart, totalFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    }
    return 1;
  })();

  // Per-segment crossfade
  const segStartFrame = Math.round((sub.startMs / 1000) * fps);
  const segProgress = frame - segStartFrame;
  const segOpacity = interpolate(segProgress, [0, CROSSFADE_FRAMES], [0.3, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const finalOpacity = blockOpacity * segOpacity;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left:   `${safeArea.x * 100}%`,
          top:    `${safeArea.y * 100}%`,
          width:  `${safeArea.w * 100}%`,
          height: `${safeArea.h * 100}%`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: finalOpacity,
        }}
      >
        <div
          style={{
            background: theme.subtitleBg,
            borderRadius: 8,
            padding: '8px 24px',
            maxWidth: '100%',
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: theme.fonts.body,
              fontSize: theme.sizes.subtitle,
              color: theme.subtitleFg,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}
          >
            {renderWithEmphases(sub.text, sub.emphases ?? [], theme.accent)}
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};

function renderWithEmphases(
  text: string,
  emphases: Array<{ start: number; end: number }>,
  accentColor: string,
): React.ReactNode {
  if (!emphases || emphases.length === 0) return text;

  const sorted = [...emphases].sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let last = 0;

  for (const e of sorted) {
    if (e.start > last) nodes.push(text.slice(last, e.start));
    nodes.push(
      <span key={e.start} style={{ color: accentColor, fontWeight: 700 }}>
        {text.slice(e.start, e.end)}
      </span>
    );
    last = e.end;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
