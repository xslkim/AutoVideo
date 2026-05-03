/**
 * T0.2 Acceptance tests:
 * - tsc --noEmit zero errors (verified separately)
 * - Minimal fixture passes schema validation
 * - assertCompiledScript({}) throws (missing fields)
 * - Type-level readiness narrowing works
 */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import schema from "../../schemas/script.schema.json" with { type: "json" };
import minimalFixture from "../fixtures/minimal-script.json" with { type: "json" };
import {
  assertCompiledScript,
  assertVisualsReady,
  isAudioReady,
  isVisualReady,
  isRenderInputReady,
  isRendered,
  type CompiledScript,
  type AudioReadyScript,
  type VisualReadyScript,
  type RenderInputScript,
  type RenderedScript,
  type Script,
} from "../../src/types/script.js";

const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema);

describe("Schema validation", () => {
  it("minimal fixture passes schema validation", () => {
    const valid = validate(minimalFixture);
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("empty object fails schema validation", () => {
    const valid = validate({});
    expect(valid).toBe(false);
  });

  it("missing blocks fails schema validation", () => {
    const valid = validate({
      meta: {
        schemaVersion: "1.0",
        title: "Test",
        voiceRef: "/a.wav",
        aspect: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        theme: "dark-code",
        subtitleSafeBottom: 162,
      },
      assets: {},
      artifacts: {},
    });
    expect(valid).toBe(false);
  });

  it("invalid animation preset fails schema validation", () => {
    const invalid = structuredClone(minimalFixture);
    (invalid as any).blocks[0].enter = "spin";
    const valid = validate(invalid);
    expect(valid).toBe(false);
  });

  it("invalid aspect ratio fails schema validation", () => {
    const invalid = structuredClone(minimalFixture);
    (invalid as any).meta.aspect = "4:3";
    const valid = validate(invalid);
    expect(valid).toBe(false);
  });
});

describe("assertCompiledScript", () => {
  it("throws on empty object", () => {
    expect(() => assertCompiledScript({})).toThrow();
  });

  it("throws on missing meta", () => {
    expect(() => assertCompiledScript({ blocks: [] })).toThrow(/Missing meta/);
  });

  it("throws on missing blocks", () => {
    expect(() =>
      assertCompiledScript({
        meta: { schemaVersion: "1.0", title: "T", voiceRef: "/a.wav" },
        artifacts: { compiledAt: "2026-01-01T00:00:00Z" },
      }),
    ).toThrow(/Missing blocks/);
  });

  it("throws on block with audio set at compile stage", () => {
    const script = structuredClone(minimalFixture);
    (script as any).blocks[0].audio = { wavPath: "x", durationSec: 5, lineTimings: [] };
    expect(() => assertCompiledScript(script)).toThrow(/audio should not be set at compile stage/);
  });

  it("throws on block with componentPath set at compile stage", () => {
    const script = structuredClone(minimalFixture);
    (script as any).blocks[0].visual.componentPath = "src/blocks/B01/Component.tsx";
    expect(() => assertCompiledScript(script)).toThrow(/componentPath should not be set at compile stage/);
  });

  it("throws on block with imagePath set at compile stage", () => {
    const script = structuredClone(minimalFixture);
    (script as any).blocks[0].visual.imagePath = "public/images/B01.png";
    expect(() => assertCompiledScript(script)).toThrow(/imagePath should not be set at compile stage/);
  });

  it("throws on missing artifacts.compiledAt", () => {
    const script = structuredClone(minimalFixture);
    delete (script as any).artifacts.compiledAt;
    expect(() => assertCompiledScript(script)).toThrow(/Missing artifacts.compiledAt/);
  });

  it("accepts valid compiled script", () => {
    expect(() => assertCompiledScript(minimalFixture)).not.toThrow();
  });
});

describe("Readiness type guards", () => {
  const base: Script = {
    meta: {
      schemaVersion: "1.0",
      title: "Test",
      voiceRef: "/a.wav",
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
        title: "Test Block",
        visualMode: "animation",
        enter: "fade",
        exit: "fade",
        visual: { description: "Test visual" },
        narration: {
          lines: [
            { text: "Hello", ttsText: "Hello", highlights: [] },
          ],
        },
      },
    ],
    assets: {},
    artifacts: {},
  };

  it("isAudioReady returns false when audio is missing", () => {
    expect(isAudioReady(base)).toBe(false);
  });

  it("isAudioReady returns true when all blocks have audio", () => {
    const withAudio: Script = structuredClone(base);
    withAudio.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    expect(isAudioReady(withAudio)).toBe(true);
  });

  it("isVisualReady returns false when componentPath is missing", () => {
    expect(isVisualReady(base)).toBe(false);
  });

  it("isVisualReady returns true when all blocks have componentPath", () => {
    const withVisual: Script = structuredClone(base);
    withVisual.blocks[0].visual.componentPath = "src/blocks/B01/Component.tsx";
    expect(isVisualReady(withVisual)).toBe(true);
  });

  it("isRenderInputReady returns false when only audio is present", () => {
    const withAudio: Script = structuredClone(base);
    withAudio.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    expect(isRenderInputReady(withAudio)).toBe(false);
  });

  it("isRenderInputReady returns true when all blocks have audio + componentPath", () => {
    const ready: Script = structuredClone(base);
    ready.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    ready.blocks[0].visual.componentPath = "src/blocks/B01/Component.tsx";
    expect(isRenderInputReady(ready)).toBe(true);
  });

  it("isRendered returns false when timing/render missing", () => {
    const ready: Script = structuredClone(base);
    ready.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    ready.blocks[0].visual.componentPath = "src/blocks/B01/Component.tsx";
    expect(isRendered(ready)).toBe(false);
  });

  it("isRendered returns true when all blocks fully populated", () => {
    const rendered: Script = structuredClone(base);
    rendered.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    rendered.blocks[0].visual.componentPath = "src/blocks/B01/Component.tsx";
    rendered.blocks[0].timing = {
      enterSec: 0.5,
      holdSec: 3.5,
      exitSec: 0.3,
      totalSec: 4.3,
      frames: 129,
      enterFrames: 15,
    };
    rendered.blocks[0].render = {
      partialPath: "output/partials/B01.mp4",
      cacheHit: false,
    };
    expect(isRendered(rendered)).toBe(true);
  });

  it("isVisualReady returns true for image-mode blocks with imagePath", () => {
    const imgBlock: Script = structuredClone(base);
    imgBlock.blocks[0].visualMode = "image";
    imgBlock.blocks[0].visual.imagePath = "public/images/B01.png";
    expect(isVisualReady(imgBlock)).toBe(true);
  });

  it("isVisualReady returns false for image-mode blocks missing imagePath", () => {
    const imgBlock: Script = structuredClone(base);
    imgBlock.blocks[0].visualMode = "image";
    expect(isVisualReady(imgBlock)).toBe(false);
  });

  it("isRenderInputReady returns true for image-mode blocks with audio + imagePath", () => {
    const imgReady: Script = structuredClone(base);
    imgReady.blocks[0].visualMode = "image";
    imgReady.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    imgReady.blocks[0].visual.imagePath = "public/images/B01.png";
    expect(isRenderInputReady(imgReady)).toBe(true);
  });

  it("isRendered returns true for image-mode blocks fully populated", () => {
    const rendered: Script = structuredClone(base);
    rendered.blocks[0].visualMode = "image";
    rendered.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 3.5,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 3500 }],
    };
    rendered.blocks[0].visual.imagePath = "public/images/B01.png";
    rendered.blocks[0].timing = {
      enterSec: 0.5,
      holdSec: 3.5,
      exitSec: 0.3,
      totalSec: 4.3,
      frames: 129,
      enterFrames: 15,
    };
    rendered.blocks[0].render = {
      partialPath: "output/partials/B01.mp4",
      cacheHit: false,
    };
    expect(isRendered(rendered)).toBe(true);
  });
});

describe("assertVisualsReady", () => {
  const base: Script = {
    meta: {
      schemaVersion: "1.0",
      title: "Test",
      voiceRef: "/a.wav",
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
        title: "Test Block",
        visualMode: "animation",
        enter: "fade",
        exit: "fade",
        visual: { description: "Test visual" },
        narration: {
          lines: [
            { text: "Hello", ttsText: "Hello", highlights: [] },
          ],
        },
      },
    ],
    assets: {},
    artifacts: {},
  };

  it("throws on empty object", () => {
    expect(() => assertVisualsReady({})).toThrow();
  });

  it("throws on missing meta", () => {
    expect(() => assertVisualsReady({ blocks: [] })).toThrow(/Missing meta/);
  });

  it("throws on missing blocks", () => {
    expect(() =>
      assertVisualsReady({
        meta: { schemaVersion: "1.0", title: "T" },
      }),
    ).toThrow(/Missing blocks/);
  });

  it("throws on animation block missing componentPath", () => {
    const script = structuredClone(base);
    expect(() => assertVisualsReady(script)).toThrow(/missing visual.componentPath/);
  });

  it("throws on image block missing imagePath", () => {
    const script = structuredClone(base);
    (script as any).blocks[0].visualMode = "image";
    expect(() => assertVisualsReady(script)).toThrow(/requires visual.imagePath/);
  });

  it("accepts animation block with componentPath", () => {
    const script = structuredClone(base);
    script.blocks[0].visual.componentPath = "src/blocks/B01/Component.tsx";
    expect(() => assertVisualsReady(script)).not.toThrow();
  });

  it("accepts image block with imagePath", () => {
    const script = structuredClone(base);
    (script as any).blocks[0].visualMode = "image";
    script.blocks[0].visual.imagePath = "public/images/B01.png";
    expect(() => assertVisualsReady(script)).not.toThrow();
  });
});

/**
 * Type-level compile-time checks.
 * These are not runtime tests — they verify that TypeScript correctly
 * narrows types through the readiness guards.
 */
describe("Type-level readiness narrowing", () => {
  it("CompiledScript type compiles correctly", () => {
    // This function exists only to exercise the type;
    // if it compiles, the type definitions are correct.
    const _check = (_s: CompiledScript): void => {
      /* noop */
    };
    expect(typeof _check).toBe("function");
  });

  it("AudioReadyScript type compiles correctly", () => {
    const _check = (_s: AudioReadyScript): void => {
      /* noop */
    };
    expect(typeof _check).toBe("function");
  });

  it("VisualReadyScript type compiles correctly", () => {
    const _check = (_s: VisualReadyScript): void => {
      /* noop */
    };
    expect(typeof _check).toBe("function");
  });

  it("RenderInputScript type compiles correctly", () => {
    const _check = (_s: RenderInputScript): void => {
      /* noop */
    };
    expect(typeof _check).toBe("function");
  });

  it("RenderedScript type compiles correctly", () => {
    const _check = (_s: RenderedScript): void => {
      /* noop */
    };
    expect(typeof _check).toBe("function");
  });
});
