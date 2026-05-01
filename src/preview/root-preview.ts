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
 * @see TASKS.md T7.1
 */

import type { Script } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RootPreviewOptions {
  /** The parsed script.json object */
  script: Script;
  /** Minimum hold seconds (from render config, default 1.5) */
  minHoldSec?: number;
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

  // Use default enter/exit durations matching render config defaults
  const enterSec = block.enter === "none" ? 0 : 0.5;
  const exitSec = block.exit === "none" ? 0 : 0.3;
  const totalSec = enterSec + holdSec + exitSec;

  return Math.round(totalSec * fps);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the Root.tsx string for Remotion preview mode (Studio).
 *
 * The generated file:
 * - Imports `registerRoot` and `Composition` from 'remotion'
 * - Imports `BlockComposition` from the remotion directory
 * - Registers each block as an independent Composition with `id` = block ID
 * - Uses `calculateMetadata` with inlined script data for per-block duration
 *
 * @param options.script — The parsed script.json
 * @param options.minHoldSec — Minimum hold seconds (default 1.5)
 * @returns The Root.tsx file content as a string
 */
export function generatePreviewRoot(options: RootPreviewOptions): string {
  const { script, minHoldSec = 1.5 } = options;
  const { meta, blocks } = script;

  // Build inline script data with timing info for calculateMetadata.
  // Each block includes its computed duration in frames.
  const scriptData = {
    meta: {
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
    },
    blocks: blocks.map((b) => ({
      id: b.id,
      frames: computeDurationFrames(b, meta.fps, minHoldSec),
    })),
  };

  const scriptJsonLiteral = JSON.stringify(scriptData, null, 2);

  const lines: string[] = [];

  // Header comment
  lines.push(`/**`);
  lines.push(` * AutoVideo — Preview Root (auto-generated)`);
  lines.push(` *`);
  lines.push(` * Each block is registered as an independent Composition`);
  lines.push(` * for Remotion Studio sidebar navigation.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import { registerRoot, Composition } from 'remotion';`);
  lines.push(`import { BlockComposition } from '../../remotion/VideoComposition';`);
  lines.push(``);
  lines.push(`const script = ${scriptJsonLiteral};`);
  lines.push(``);

  // Open Root component
  lines.push(`export const Root = () => (`);
  lines.push(`  <>`);

  // Register each block as an independent Composition
  for (const block of blocks) {
    const frames = computeDurationFrames(block, meta.fps, minHoldSec);

    lines.push(`    <Composition`);
    lines.push(`      id="${block.id}"`);
    lines.push(`      component={BlockComposition}`);
    lines.push(`      durationInFrames={${frames}}`);
    lines.push(`      fps={script.meta.fps}`);
    lines.push(`      width={script.meta.width}`);
    lines.push(`      height={script.meta.height}`);
    lines.push(`      defaultProps={{ blockId: '${block.id}' }}`);
    lines.push(`      calculateMetadata={() => {`);
    lines.push(`        const block = script.blocks.find(b => b.id === '${block.id}');`);
    lines.push(`        return { durationInFrames: block.frames };`);
    lines.push(`      }}`);
    lines.push(`    />`);
  }

  lines.push(`  </>`);
  lines.push(`);`);
  lines.push(`registerRoot(Root);`);
  lines.push(``);

  return lines.join("\n");
}