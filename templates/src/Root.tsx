/**
 * AutoVideo v2 — Root
 * Registers one independent Remotion composition per block.
 * Each composition is rendered separately; final video is assembled by ffmpeg concat.
 */
import React from 'react';
import { Composition } from 'remotion';
import { BlockComposition } from './BlockComposition';
import blocksData from '../blocks.json';

export const RemotionRoot: React.FC = () => {
  const { resolution, fps } = blocksData.meta;

  return (
    <>
      {blocksData.blocks.map((block) => (
        <Composition
          key={block.id}
          id={block.id}
          component={BlockComposition}
          defaultProps={{ blockId: block.id }}
          durationInFrames={Math.max(block.timing?.frames ?? 1, 1)}
          fps={fps}
          width={resolution.w}
          height={resolution.h}
        />
      ))}
    </>
  );
};
