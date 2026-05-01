/**
 * AutoVideo — Root.tsx generator for render mode
 *
 * Generates a Remotion Root.tsx file that registers a single parameterized
 * Composition (`id="Block"`) with `calculateMetadata` to set per-block
 * duration from script.json timing data.
 *
 * This file is written to `<build out>/remotion-root.tsx` by the render
 * stage. It is distinct from the preview Root.tsx (T6.5).
 *
 * @see PRD §6.4 step 3 — Root.tsx (render mode)
 * @see TASKS.md T6.1
 */

import type { Script } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RootRenderOptions {
  /** The parsed script.json object */
  script: Script;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the Root.tsx string for Remotion render mode.
 *
 * The generated file:
 * - Imports `registerRoot` and `Composition` from 'remotion'
 * - Imports `BlockComposition` from the remotion directory
 * - Imports script.json from public/ (for Remotion staticFile access)
 * - Registers a single `id="Block"` Composition with `calculateMetadata`
 *   that resolves per-block timing from `inputProps.blockId`
 *
 * @param options.script — The parsed script.json
 * @returns The Root.tsx file content as a string
 */
export function generateRenderRoot(options: RootRenderOptions): string {
  const { script } = options;
  const { meta, blocks } = script;

  // The first block's ID is used as defaultProps
  const firstBlockId = blocks[0]?.id ?? "B01";

  // We inline the script data as a JSON literal so calculateMetadata
  // can access it synchronously without a fetch.
  // This avoids async issues in calculateMetadata.
  const scriptJsonLiteral = JSON.stringify(
    {
      meta: {
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
      },
      blocks: blocks.map((b) => ({
        id: b.id,
        timing: b.timing
          ? { frames: b.timing.frames }
          : undefined,
      })),
    },
    null,
    2,
  );

  const lines: string[] = [];

  lines.push(`import { registerRoot, Composition } from 'remotion';`);
  lines.push(`import { BlockComposition } from '../../remotion/VideoComposition';`);
  lines.push(``);
  lines.push(`const script = ${scriptJsonLiteral};`);
  lines.push(``);
  lines.push(`export const Root = () => (`);
  lines.push(`  <Composition`);
  lines.push(`    id="Block"`);
  lines.push(`    component={BlockComposition}`);
  lines.push(`    durationInFrames={1}`);
  lines.push(`    fps={script.meta.fps}`);
  lines.push(`    width={script.meta.width}`);
  lines.push(`    height={script.meta.height}`);
  lines.push(`    defaultProps={{ blockId: '${firstBlockId}' }}`);
  lines.push(`    calculateMetadata={({ inputProps }) => {`);
  lines.push(`      const props = inputProps ?? { blockId: '${firstBlockId}' };`);
  lines.push(`      const block = script.blocks.find(b => b.id === props.blockId);`);
  lines.push(`      return { durationInFrames: block?.timing?.frames ?? 1, props };`);
  lines.push(`    }}`);
  lines.push(`  />`);
  lines.push(`);`);
  lines.push(`registerRoot(Root);`);
  lines.push(``);

  return lines.join("\n");
}