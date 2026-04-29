/**
 * AutoVideo v2 — BlockComposition
 * Self-contained composition for a single block: visual + audio + subtitles.
 * Used by Root.tsx; each block is rendered as its own MP4.
 */
import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { BlockFrame } from './engine/block-frame';
import { getTheme } from './engine/theme';
import blocksData from '../blocks.json';

interface BlockCompositionProps {
  blockId: string;
}

export const BlockComposition: React.FC<BlockCompositionProps> = ({ blockId }) => {
  const block = blocksData.blocks.find((b) => b.id === blockId);
  if (!block) return null;

  const theme = getTheme(blocksData.meta.theme);

  return (
    <AbsoluteFill style={{ background: theme.bgDeep, fontFamily: theme.fonts.body }}>
      <BlockFrame block={block} />
      {block.timing?.audioPath && (
        <Audio src={staticFile(block.timing.audioPath)} />
      )}
    </AbsoluteFill>
  );
};
