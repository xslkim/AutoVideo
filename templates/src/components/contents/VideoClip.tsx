/**
 * AutoVideo v2 — VideoClip content component
 */
import React from 'react';
import { Video, staticFile } from 'remotion';
import type { Theme } from '../../engine/theme';
import type { Rect } from '../../engine/rect';

interface VideoSpec {
  src: string;
  muted?: boolean;
  startTime?: number;
  speed?: number;
}

interface Props {
  spec: VideoSpec;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
  theme: Theme;
}

export const VideoContent: React.FC<Props> = ({ spec, theme }) => {
  if (!spec.src) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: theme.bgCard, borderRadius: theme.borderRadius,
      }}>
        <span style={{ fontFamily: theme.fonts.body, color: theme.fgMuted, fontSize: 32 }}>
          🎬 视频文件未找到
        </span>
      </div>
    );
  }

  const src = spec.src.startsWith('http') ? spec.src : staticFile(spec.src);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: theme.borderRadius }}>
      <Video
        src={src}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        muted={spec.muted ?? true}
        startFrom={Math.round((spec.startTime ?? 0) * 30)}
        playbackRate={spec.speed ?? 1}
      />
    </div>
  );
};
