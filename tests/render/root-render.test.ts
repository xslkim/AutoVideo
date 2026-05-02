/**
 * T6.1 — Root.tsx generator (render mode) acceptance tests
 *
 * Acceptance criteria:
 * - Snapshot test: generated Root.tsx string matches snapshot
 *
 * @see TASKS.md T6.1
 */

import { describe, it, expect } from "vitest";
import { generateRenderRoot } from "../../src/render/root-render.js";
import type { Script } from "../../src/types/script.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMinimalScript(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Minimal Test",
      voiceRef: "/path/to/B00.wav",
      aspect: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      theme: "dark-code",
      subtitleSafeBottom: 162,
    },
    blocks: [
      {
        id: "B01",
        title: "Hello",
        enter: "fade",
        exit: "fade",
        visual: { description: "Test visual" },
        narration: { lines: [] },
        timing: {
          enterSec: 0.5,
          holdSec: 3,
          exitSec: 0.3,
          totalSec: 3.8,
          frames: 114,
          enterFrames: 15,
        },
      },
      {
        id: "B02",
        title: "World",
        enter: "fade-up",
        exit: "slide-left",
        visual: { description: "Test visual 2", componentPath: "src/blocks/B02/Component.tsx" },
        narration: { lines: [] },
        timing: {
          enterSec: 0.5,
          holdSec: 5,
          exitSec: 0.3,
          totalSec: 5.8,
          frames: 174,
          enterFrames: 15,
        },
      },
    ],
    assets: {},
    artifacts: {},
  };
}

function create9x16Script(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Vertical Video",
      voiceRef: "/path/to/B00.wav",
      aspect: "9:16",
      width: 1080,
      height: 1920,
      fps: 60,
      theme: "light",
      subtitleSafeBottom: 288,
    },
    blocks: [
      {
        id: "B01",
        title: "Intro",
        enter: "zoom-in",
        exit: "zoom-out",
        visual: { description: "Vertical intro" },
        narration: { lines: [] },
        timing: {
          enterSec: 0.5,
          holdSec: 10,
          exitSec: 0.3,
          totalSec: 10.8,
          frames: 648,
          enterFrames: 30,
        },
      },
    ],
    assets: {},
    artifacts: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateRenderRoot", () => {
  it("generates a valid Root.tsx string for a 2-block script", () => {
    const script = createMinimalScript();
    const result = generateRenderRoot({ script, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    // Basic structural assertions
    expect(result).toContain("import { registerRoot, Composition } from 'remotion';");
    expect(result).toContain("import { BlockComposition } from './remotion/VideoComposition';");
    expect(result).toContain('id="Block"');
    expect(result).toContain('component={BlockComposition}');
    expect(result).toContain("durationInFrames={1}");
    expect(result).toContain("fps={script.meta.fps}");
    expect(result).toContain("width={script.meta.width}");
    expect(result).toContain("height={script.meta.height}");
    expect(result).toContain("defaultProps={{ blockId: 'B01' }}");
    expect(result).toContain("calculateMetadata");
    expect(result).toContain("props: inputProps");
    expect(result).toContain("resolved.blockId");
    expect(result).toContain("block?.timing?.frames");
    expect(result).toContain("registerRoot(Root)");

    // Should contain inlined script data for both blocks
    expect(result).toContain('"B01"');
    expect(result).toContain('"B02"');
    expect(result).toContain("114");
    expect(result).toContain("174");

    // Snapshot
    expect(result).toMatchSnapshot();
  });

  it("generates correct Root.tsx for 9:16 vertical video at 60fps", () => {
    const script = create9x16Script();
    const result = generateRenderRoot({ script, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    // The inlined script should have the correct meta
    expect(result).toContain('"fps": 60');
    expect(result).toContain('"width": 1080');
    expect(result).toContain('"height": 1920');
    expect(result).toContain("648"); // frames for the block
    expect(result).toContain("defaultProps={{ blockId: 'B01' }}");

    // Snapshot
    expect(result).toMatchSnapshot();
  });

  it("includes all block IDs in the inlined script data", () => {
    const script = createMinimalScript();
    const result = generateRenderRoot({ script, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    // Both blocks must appear in the inlined data
    expect(result).toMatch(/"id":\s*"B01"/);
    expect(result).toMatch(/"id":\s*"B02"/);
  });

  it("handles single-block script", () => {
    const script: Script = {
      meta: {
        schemaVersion: "1.0",
        title: "Single Block",
        voiceRef: "/path/to/B00.wav",
        aspect: "1:1",
        width: 1080,
        height: 1080,
        fps: 30,
        theme: "dark-code",
        subtitleSafeBottom: 162,
      },
      blocks: [
        {
          id: "B03",
          title: "Only Block",
          enter: "none",
          exit: "none",
          visual: { description: "Single" },
          narration: { lines: [] },
          timing: {
            enterSec: 0,
            holdSec: 5,
            exitSec: 0,
            totalSec: 5,
            frames: 150,
            enterFrames: 0,
          },
        },
      ],
      assets: {},
      artifacts: {},
    };

    const result = generateRenderRoot({ script, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    expect(result).toContain("defaultProps={{ blockId: 'B03' }}");
    expect(result).toContain('"B03"');
    expect(result).toContain("150");
    expect(result).toMatchSnapshot();
  });
});