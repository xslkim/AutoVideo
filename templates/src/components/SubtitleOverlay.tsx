/**
 * AutoVideo v2 — SubtitleOverlay
 *
 * Sync design:
 *   - `frame` = useCurrentFrame() inside the block's Sequence (0 = block audio start)
 *   - `sub.startMs / endMs` = ms relative to the block's audio start (same zero-point)
 *   - Conversion: currentMs = (frame / fps) * 1000
 *
 * Behaviour:
 *   - Between subtitle segments: persists the LAST active subtitle (no flash-to-black)
 *   - At block enter/exit: fades entire strip with the block animation
 *   - Short crossfade between consecutive segments
 *   - Allows 2-line wrapping so long Chinese sentences are never clipped
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
  const safeArea = theme.subtitleSafeArea;

  if (!subtitles || subtitles.length === 0) return null;

  const currentMs = (frame / fps) * 1000;

  // ── Find the active subtitle ──────────────────────────────────────────────
  let activeIdx = subtitles.findIndex(
    (s) => currentMs >= s.startMs && currentMs < s.endMs
  );

  // Between segments or after last segment: persist the most-recently-started
  // subtitle instead of disappearing (prevents disorienting flicker).
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
              // wrap at word/char boundaries — no ellipsis-clipping for Chinese
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              textAlign: 'center',
              // hard-limit: at most 2 visual lines
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
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
