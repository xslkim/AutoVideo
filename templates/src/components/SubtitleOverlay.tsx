/**
 * AutoVideo v2 — SubtitleOverlay
 *
 * Sync design:
 *   - `frame` = useCurrentFrame() inside the block's Sequence (0 = block audio start)
 *   - `sub.startMs / endMs` = ms relative to the block's audio start (same zero-point)
 *   - Conversion: currentMs = (frame / fps) * 1000
 *
 * Behaviour:
 *   - Each subtitle occupies its own non-overlapping time window (char-count proportional)
 *   - Between subtitle segments: persists the last active subtitle (no flash-to-black)
 *   - At block enter/exit: fades entire strip with the block animation
 *   - Short crossfade when switching between segments
 *   - Positioned at the bottom of the screen
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

const CROSSFADE_FRAMES = 6;  // ~0.2s at 30fps

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  subtitles,
  frame,
  fps,
  enterDurationFrames,
  exitDurationFrames,
  totalFrames,
}) => {
  const theme = getTheme();

  if (!subtitles || subtitles.length === 0) return null;

  const currentMs = (frame / fps) * 1000;

  // ── Find the active subtitle ──────────────────────────────────────────────
  let activeIdx = subtitles.findIndex(
    (s) => currentMs >= s.startMs && currentMs < s.endMs
  );

  // Between segments or after last segment: persist the most-recently-started subtitle
  if (activeIdx === -1) {
    for (let i = subtitles.length - 1; i >= 0; i--) {
      if (currentMs >= subtitles[i].startMs) {
        activeIdx = i;
        break;
      }
    }
  }

  if (activeIdx === -1) return null;  // before first subtitle

  // More than 300ms past the last subtitle's end → hide
  const lastSub = subtitles[subtitles.length - 1];
  if (currentMs > lastSub.endMs + 300) return null;

  const sub = subtitles[activeIdx];

  // ── Block-level opacity: tied to enter/exit animation ────────────────────
  const blockOpacity = (() => {
    const fadeInEnd    = Math.max(enterDurationFrames, 1);
    const fadeOutStart = Math.max(totalFrames - exitDurationFrames, 0);
    if (frame < fadeInEnd) {
      return interpolate(frame, [0, fadeInEnd], [0, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    }
    if (frame > fadeOutStart) {
      return interpolate(frame, [fadeOutStart, totalFrames], [1, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    }
    return 1;
  })();

  // ── Per-segment crossfade when a new segment appears ─────────────────────
  const segStartFrame = Math.round((sub.startMs / 1000) * fps);
  const segProgress   = Math.max(0, frame - segStartFrame);
  const segOpacity    = interpolate(segProgress, [0, CROSSFADE_FRAMES], [0.35, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const finalOpacity = blockOpacity * segOpacity;

  // Font size: prefer theme.sizes.narration (new), fall back to subtitle
  const sizes = theme.sizes as Record<string, number>;
  const fontSize = sizes.narration ?? sizes.subtitle ?? 56;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          bottom: '4%',
          left: '5%',
          right: '5%',
          display: 'flex',
          justifyContent: 'center',
          opacity: finalOpacity,
        }}
      >
        <div
          style={{
            background: theme.subtitleBg,
            borderRadius: 10,
            padding: '12px 32px',
            maxWidth: '100%',
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: theme.fonts.body,
              fontSize,
              color: theme.subtitleFg,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              textAlign: 'center',
            }}
          >
            {sub.text}
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
