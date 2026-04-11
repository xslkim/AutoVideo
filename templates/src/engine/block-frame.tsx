/**
 * AutoVideo v2 — BlockFrame
 * The universal wrapper for every block in the video.
 * Handles: Rect positioning, enter/exit animation, content routing, subtitle overlay.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Audio, staticFile } from 'remotion';
import { rectToCss } from './rect';
import { blockAnimStyle } from './animations';
import { SubtitleOverlay } from '../components/SubtitleOverlay';
import { ContentRouter } from '../components/ContentRouter';
import type { Block } from '../../types/block';

interface BlockFrameProps {
  block: Block;
}

export const BlockFrame: React.FC<BlockFrameProps> = ({ block }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const totalFrames = block.timing?.frames ?? 0;
  const { enter, exit, rect, content } = block.visual;

  const animStyle = blockAnimStyle(frame, totalFrames, fps, enter, exit);
  const posStyle  = rectToCss(rect);

  return (
    <AbsoluteFill>
      {/* Main content */}
      <div
        style={{
          ...posStyle,
          ...animStyle,
          willChange: 'transform, opacity',
        }}
      >
        <ContentRouter
          content={content}
          block={block}
          frame={frame}
          totalFrames={totalFrames}
          fps={fps}
          rect={rect}
        />
      </div>

      {/* Subtitle overlay (outside the rect, uses its own safe area) */}
      {block.subtitles && block.subtitles.length > 0 && (
        <SubtitleOverlay
          subtitles={block.subtitles}
          frame={frame}
          fps={fps}
          enterDurationFrames={Math.round((enter.duration ?? 0.5) * fps)}
          exitDurationFrames={Math.round((exit.duration ?? 0.3) * fps)}
          totalFrames={totalFrames}
        />
      )}
    </AbsoluteFill>
  );
};
