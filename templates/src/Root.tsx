/**
 * AutoVideo v2 — Root composition
 */
import React from 'react';
import { Composition } from 'remotion';
import { Video } from './Video';
import blocksData from '../blocks.json';

export const RemotionRoot: React.FC = () => {
  // Compute total duration from timing
  const blocks = blocksData.blocks;
  let totalFrames = 0;
  for (const b of blocks) {
    const end = (b.timing?.startFrame ?? 0) + (b.timing?.frames ?? 0);
    if (end > totalFrames) totalFrames = end;
  }
  if (totalFrames === 0) totalFrames = 900; // default 30s

  const { resolution, fps } = blocksData.meta;

  return (
    <Composition
      id="Video"
      component={Video}
      durationInFrames={totalFrames}
      fps={fps}
      width={resolution.w}
      height={resolution.h}
    />
  );
};
