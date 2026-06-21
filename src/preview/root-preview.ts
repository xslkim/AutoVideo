/**
 * AutoVideo — Root.tsx generator for preview mode (Remotion Studio)
 *
 * Generates a Remotion Root.tsx file that registers each block as an
 * independent `<Composition id="B01" ...>`, `<Composition id="B02" ...>`, etc.
 * This allows Remotion Studio to display all blocks in the left sidebar
 * for easy per-block scrubbing.
 *
 * Reuses `BlockComposition` (same component as render mode) so that
 * Studio preview and final render are visually identical.
 *
 * Per §6.5:
 * - Blocks with `audio.durationSec` use real TTS duration as hold time
 * - Blocks without audio use `narration.explicitDurationSec ?? minHoldSec`
 *   as fallback hold; audio `<Audio>` is NOT mounted (BlockComposition
 *   already handles this by checking `block.audio`)
 *
 * @see PRD §6.5 — preview stage
 * @see docs/archive/cli/TASKS.md T7.1, T7.2
 */

import path from "node:path";
import type { Script } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RootPreviewOptions {
  /** The parsed script.json object */
  script: Script;
  /** Minimum hold seconds (from render config, default 1.5) */
  minHoldSec?: number;
  /** Block ID to focus on (via default composition) */
  targetBlockId?: string;
  /** Absolute path to the build output directory */
  buildDir: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the fallback duration in frames for a block that may not have
 * timing data yet (e.g. before render stage has run).
 */
function computeDurationFrames(
  block: Script["blocks"][number],
  fps: number,
  minHoldSec: number,
): number {
  // If timing is already computed (render stage already ran), use it directly
  if (block.timing) {
    return block.timing.frames;
  }

  // Fallback: compute from audio / explicitDuration / minHold
  const holdSec = Math.max(
    block.audio?.durationSec ?? 0,
    block.narration.explicitDurationSec ?? 0,
    minHoldSec,
  );

  // Use default enter/exit durations from PRD §3.8
  const enterSec = block.enter === "none" ? 0 : 0.5;
  const exitSec = block.exit === "none" ? 0 : 0.3;
  const totalSec = enterSec + holdSec + exitSec;

  return Math.round(totalSec * fps);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the Root.tsx string for Remotion Studio preview mode.
 *
 * The generated file:
 * - Imports `registerRoot` and `Composition` from 'remotion'
 * - Imports `BlockComposition` from the remotion directory
 * - Inlines minimal script data (block IDs + frame counts) so
 *   `calculateMetadata` can resolve duration synchronously
 * - Registers each block as an independent Composition so Studio
 *   shows them in the left sidebar
 *
 * @param options.script — The parsed script.json
 * @param options.minHoldSec — Minimum hold duration (default 1.5)
 * @param options.targetBlockId — Block ID to set as default composition
 * @returns The Root.tsx file content as a string
 */
export function generatePreviewRoot(options: RootPreviewOptions): string {
  const { script, targetBlockId, buildDir } = options;
  const minHoldSec = options.minHoldSec ?? 1.5;
  const { meta, blocks } = script;

  // Compute relative path from buildDir back to the AutoVideo root's remotion/ directory
  const remotionDir = path.resolve(
    new URL(".", import.meta.url).pathname,
    "../../remotion"
  );
  const relRemotionDir = path.relative(buildDir, remotionDir);

  // Build minimal block data for calculateMetadata
  const blockData = blocks.map((block) => ({
    id: block.id,
    frames: computeDurationFrames(block, meta.fps, minHoldSec),
  }));

  // Inlined script data for calculateMetadata
  const scriptJsonLiteral = JSON.stringify(
    {
      meta: {
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
      },
      blocks: blockData,
    },
    null,
    2,
  );

  // Generate one <Composition> per block
  const compositionEntries = blocks
    .map((block, i) => {
      const frames = blockData[i].frames;
      const blockId = block.id;
      return `    <Composition
      id="${blockId}"
      component={BlockComposition}
      durationInFrames={${frames}}
      fps={script.meta.fps}
      width={script.meta.width}
      height={script.meta.height}
      defaultProps={{ blockId: '${blockId}' }}
      calculateMetadata={() => {
        const block = script.blocks.find(b => b.id === '${blockId}');
        return { durationInFrames: block.frames };
      }}
    />`;
    })
    .join("\n");

  // Determine the default composition (for --block targeting)
  // When targetBlockId is set, we put that composition first so Studio opens it
  // This is a hint; Studio may or may not honor it depending on version
  const defaultBlockId = targetBlockId ?? blocks[0]?.id ?? "B01";

  return `/**
 * AutoVideo — Preview Root (auto-generated)
 *
 * Each block is registered as an independent Composition
 * for Remotion Studio sidebar navigation.
 */

import { registerRoot, Composition } from 'remotion';
import { BlockComposition } from '${relRemotionDir}/VideoComposition';

const script = ${scriptJsonLiteral};

export const Root = () => (
  <>
${compositionEntries}
  </>
);
registerRoot(Root);
`;
}