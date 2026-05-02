/**
 * T7.1 — Root.tsx generator (preview mode) acceptance tests
 *
 * Acceptance criteria:
 * - Snapshot test: generated Root.tsx string matches snapshot
 * - Each block is registered as an independent Composition with id = block ID
 * - Blocks with audio use real TTS duration
 * - Blocks without audio use fallback (explicitDurationSec or minHoldSec)
 * - Handles single-block and multi-block scripts
 *
 * @see TASKS.md T7.1
 */

import { describe, it, expect } from "vitest";
import { generatePreviewRoot } from "../../src/preview/root-preview.js";
import type { Script } from "../../src/types/script.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two-block script with full timing + audio data.
 * Simulates a script that has been through tts + render stages.
 */
function createTwoBlockScriptWithAudio(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Test Video",
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
        audio: {
          wavPath: "public/audio/B01.wav",
          durationSec: 4.2,
          lineTimings: [
            { lineIndex: 0, startMs: 0, endMs: 2000 },
            { lineIndex: 1, startMs: 2200, endMs: 4000 },
          ],
        },
        timing: {
          enterSec: 0.5,
          holdSec: 4.2,
          exitSec: 0.3,
          totalSec: 5.0,
          frames: 150,
          enterFrames: 15,
        },
      },
      {
        id: "B02",
        title: "World",
        enter: "fade-up",
        exit: "slide-left",
        visual: {
          description: "Test visual 2",
          componentPath: "src/blocks/B02/Component.tsx",
        },
        narration: { lines: [] },
        audio: {
          wavPath: "public/audio/B02.wav",
          durationSec: 6.0,
          lineTimings: [
            { lineIndex: 0, startMs: 0, endMs: 3000 },
            { lineIndex: 1, startMs: 3200, endMs: 5800 },
          ],
        },
        timing: {
          enterSec: 0.5,
          holdSec: 6.0,
          exitSec: 0.3,
          totalSec: 6.8,
          frames: 204,
          enterFrames: 15,
        },
      },
    ],
    assets: {},
    artifacts: {},
  };
}

/**
 * Script with blocks that have NO audio or timing (post-compile, pre-tts).
 * Tests fallback duration calculation.
 */
function createScriptNoAudio(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "No Audio Yet",
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
        title: "No audio block",
        enter: "fade",
        exit: "fade",
        visual: { description: "Test visual" },
        narration: { lines: [] },
        // No audio, no timing — fallback to minHoldSec (1.5s)
        // enter=0.5 + hold=1.5 + exit=0.3 = 2.3s → 69 frames
      },
      {
        id: "B02",
        title: "Explicit duration block",
        enter: "fade-up",
        exit: "none",
        visual: { description: "Test visual 2" },
        narration: {
          lines: [],
          explicitDurationSec: 8,
        },
        // No audio, no timing — fallback to explicitDurationSec=8
        // enter=0.5 + hold=8 + exit=0 (none) = 8.5s → 255 frames
      },
    ],
    assets: {},
    artifacts: {},
  };
}

/**
 * Single-block script at 9:16, 60fps.
 */
function createSingleBlockVerticalScript(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Vertical",
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
        title: "Vertical Block",
        enter: "zoom-in",
        exit: "zoom-out",
        visual: { description: "Vertical visual" },
        narration: { lines: [] },
        audio: {
          wavPath: "public/audio/B01.wav",
          durationSec: 10,
          lineTimings: [],
        },
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

/**
 * Script with mixed blocks — some with audio, some without.
 */
function createMixedScript(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Mixed",
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
        id: "B01",
        title: "With Audio",
        enter: "fade",
        exit: "fade",
        visual: { description: "Has audio" },
        narration: { lines: [] },
        audio: {
          wavPath: "public/audio/B01.wav",
          durationSec: 3.0,
          lineTimings: [],
        },
        timing: {
          enterSec: 0.5,
          holdSec: 3.0,
          exitSec: 0.3,
          totalSec: 3.8,
          frames: 114,
          enterFrames: 15,
        },
      },
      {
        id: "B02",
        title: "No Audio",
        enter: "none",
        exit: "none",
        visual: { description: "No audio" },
        narration: { lines: [] },
        // No audio, no timing, no explicitDuration — fallback minHoldSec=2
        // enter=0 (none) + hold=2 + exit=0 (none) = 2s → 60 frames
      },
    ],
    assets: {},
    artifacts: {},
  };
}

// ---------------------------------------------------------------------------
// Helpers — extract Compositions from generated Root.tsx string
// ---------------------------------------------------------------------------

/**
 * Extract all Composition blocks from the generated Root.tsx.
 * Returns a map of blockId → { durationInFrames, ... }.
 */
function parseCompositions(rootTx: string) {
  const result = new Map<string, { durationInFrames: number }>();

  // Match each <Composition ... /> block
  const compRegex = /<Composition\s+([\s\S]*?)\/>/g;
  let match;
  while ((match = compRegex.exec(rootTx)) !== null) {
    const body = match[1];
    const idMatch = body.match(/id="([^"]+)"/);
    const durMatch = body.match(/durationInFrames={(\d+)}/);
    if (idMatch && durMatch) {
      result.set(idMatch[1], {
        durationInFrames: parseInt(durMatch[1], 10),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generatePreviewRoot", () => {
  it("generates a valid preview Root.tsx for a 2-block script with audio", () => {
    const script = createTwoBlockScriptWithAudio();
    const result = generatePreviewRoot({ script, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    // Should contain two independent Compositions with block IDs
    expect(result).toContain('id="B01"');
    expect(result).toContain('id="B02"');
    expect(result).toContain("component={BlockComposition}");
    expect(result).toContain("registerRoot(Root)");
    expect(result).toContain("import { registerRoot, Composition } from 'remotion'");
    expect(result).toContain("VideoComposition");

    // Extract composition durations
    const comps = parseCompositions(result);
    expect(comps.get("B01")?.durationInFrames).toBe(150);
    expect(comps.get("B02")?.durationInFrames).toBe(204);

    // Snapshot
    expect(result).toMatchSnapshot();
  });

  it("generates correct preview Root.tsx for blocks without audio (fallback duration)", () => {
    const script = createScriptNoAudio();
    const result = generatePreviewRoot({ script, minHoldSec: 1.5, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    const comps = parseCompositions(result);

    // B01: enter=0.5 + hold=1.5 (minHoldSec) + exit=0.3 = 2.3s → 69 frames
    expect(comps.get("B01")?.durationInFrames).toBe(69);

    // B02: enter=0.5 + hold=8 (explicitDurationSec) + exit=0 (none) = 8.5s → 255 frames
    expect(comps.get("B02")?.durationInFrames).toBe(255);

    // Snapshot
    expect(result).toMatchSnapshot();
  });

  it("generates correct preview Root.tsx for single-block 9:16 at 60fps", () => {
    const script = createSingleBlockVerticalScript();
    const result = generatePreviewRoot({ script, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    const comps = parseCompositions(result);

    expect(comps.get("B01")?.durationInFrames).toBe(648);
    expect(result).toContain("fps={script.meta.fps}");
    expect(result).toContain("width={script.meta.width}");
    expect(result).toContain("height={script.meta.height}");

    // Snapshot
    expect(result).toMatchSnapshot();
  });

  it("handles mixed blocks (with and without audio)", () => {
    const script = createMixedScript();
    const result = generatePreviewRoot({ script, minHoldSec: 2, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    const comps = parseCompositions(result);

    // B01 has timing → 114 frames
    expect(comps.get("B01")?.durationInFrames).toBe(114);

    // B02: none + minHold=2 + none = 2s → 60 frames
    expect(comps.get("B02")?.durationInFrames).toBe(60);

    // Snapshot
    expect(result).toMatchSnapshot();
  });

  it("respects custom minHoldSec", () => {
    const script = createScriptNoAudio();
    const result = generatePreviewRoot({ script, minHoldSec: 3, buildDir: "/home/ubuntu/AutoVideo/build/test" });

    const comps = parseCompositions(result);

    // B01: enter=0.5 + hold=3 + exit=0.3 = 3.8s → 114 frames
    expect(comps.get("B01")?.durationInFrames).toBe(114);

    // B02: enter=0.5 + hold=8 (explicitDuration > minHold) + exit=0 (none) = 8.5s → 255 frames
    expect(comps.get("B02")?.durationInFrames).toBe(255);
  });
});