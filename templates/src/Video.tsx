/**
 * AutoVideo v2 — Main Video composition
 * Reads blocks.json and assembles all BlockFrame sequences.
 */
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { BlockFrame } from './engine/block-frame';
import { getTheme } from './engine/theme';
import type { Block } from '../types/block';

// blocks.json is imported at build time
// The agent generates this via Stage 1 + Stage 2 + Stage 4
import blocksData from '../blocks.json';

export const Video: React.FC = () => {
  const { fps } = useVideoConfig();
  const theme = getTheme(blocksData.meta.theme);
  const blocks: Block[] = blocksData.blocks;

  return (
    <AbsoluteFill style={{ background: theme.bgDeep, fontFamily: theme.fonts.body }}>
      {blocks.map((block) => {
        const startFrame = block.timing?.startFrame ?? 0;
        const frames     = block.timing?.frames ?? fps * 5;

        return (
          <Sequence
            key={block.id}
            from={startFrame}
            durationInFrames={frames}
            name={`${block.id}: ${block.title}`}
          >
            <BlockFrame block={block} />
          </Sequence>
        );
      })}

      {/* Master audio track (concatenated by Stage 4) */}
      {/* The agent creates public/audio/master.wav in Stage 4 */}
      <Audio src={staticFile('audio/master.wav')} />
    </AbsoluteFill>
  );
};
