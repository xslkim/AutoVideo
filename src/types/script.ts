/**
 * AutoVideo — Canonical type definitions for script.json
 *
 * Based on PRD §4 "数据模型：script.json"
 */

// ---------------------------------------------------------------------------
// Progress event — used by onProgress callbacks across CLI modules
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  /** Overall completion percentage (0-100) */
  percent: number;
  /** Human-readable step description */
  step: string;
  /** Current stage identifier */
  stage: string;
  /** Current block being processed, if applicable */
  blockId?: string;
}

// ---------------------------------------------------------------------------
// Visual mode — animation (Claude-generated Component.tsx) vs image (AI-generated PNG)
// ---------------------------------------------------------------------------

export type VisualMode = 'animation' | 'image';

// ---------------------------------------------------------------------------
// Animation preset — union literal type
// ---------------------------------------------------------------------------

export const ANIMATION_PRESETS = [
  "fade",
  "fade-up",
  "fade-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
  "none",
] as const;

export type AnimationPreset = (typeof ANIMATION_PRESETS)[number];

// ---------------------------------------------------------------------------
// Aspect ratio — union literal type
// ---------------------------------------------------------------------------

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface Theme {
  name: string;
  colors: {
    bg: string;
    fg: string;
    accent: string;
    muted: string;
    code: {
      bg: string;
      fg: string;
      keyword: string;
      string: string;
      comment: string;
    };
  };
  fonts: {
    sans: string;
    mono: string;
  };
  spacing: {
    unit: number;
  };
  subtitle: {
    fontFamily: string;
    fontSizePct: number;
    lineHeight: number;
    maxWidthPct: number;
    backgroundColor: string;
    paddingPx: number;
  };
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

export interface NarrationLine {
  /** Raw text including ** markers */
  text: string;
  /** Plain text for TTS (markers stripped) */
  ttsText: string;
  /** Highlight ranges based on ttsText character offsets (markers stripped) */
  highlights: { start: number; end: number }[];
}

// ---------------------------------------------------------------------------
// Block — core unit of content
// ---------------------------------------------------------------------------

export interface Block {
  id: string; // "B01"
  title: string;
  enter: AnimationPreset;
  exit: AnimationPreset;

  visualMode: VisualMode; // 缺省 'animation'，图片模式为 'image'

  visual: {
    description: string; // --- visual --- raw text, fed to LLM
    componentPath?: string; // Stage 3 fills (generated .tsx path)
    imagePath?: string; // Stage 3 fills for image mode (POSIX relative to build dir)
  };

  narration: {
    lines: NarrationLine[];
    explicitDurationSec?: number; // @duration
  };

  // Stage 2 fills
  audio?: {
    wavPath: string; // POSIX path relative to build out dir, "public/audio/{id}.wav"
    durationSec: number; // merged WAV actual duration including trailing 200ms silence per line
    lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
  };

  // Stage 4 fills
  timing?: {
    enterSec: number;
    holdSec: number;
    exitSec: number;
    totalSec: number;
    frames: number;
    enterFrames: number;
  };

  // Stage 4 fills (partial mp4 cache info)
  render?: {
    partialPath: string; // POSIX path relative to build out dir, "output/partials/{id}.mp4"
    cacheHit: boolean;
  };
}

// ---------------------------------------------------------------------------
// Script — top-level IR
// ---------------------------------------------------------------------------

export interface Script {
  meta: {
    schemaVersion: "1.0";
    title: string;
    voiceRef: string; // absolute path to reference audio (resolved at compile)
    aspect: "16:9" | "9:16" | "1:1";
    width: number;
    height: number;
    fps: number;
    theme: string;
    subtitleSafeBottom: number;
  };
  blocks: Block[];
  assets: Record<string, string>; // relative POSIX path → "assets/{hash}.ext"
  artifacts: {
    compiledAt?: string;
    audioGeneratedAt?: string;
    visualsGeneratedAt?: string;
    renderedAt?: string;
  };
}

// ---------------------------------------------------------------------------
// Stage-specific readiness types (TypeScript branded for static safety)
// ---------------------------------------------------------------------------

/** compile output; no audio / componentPath / timing */
export interface CompiledScript extends Script {
  blocks: Block[]; // blocks have no audio, no componentPath, no timing
}

/** tts output; all blocks contain `audio` */
export interface AudioReadyScript extends Script {
  blocks: (Block & { audio: NonNullable<Block["audio"]> })[];
}

/** visuals output; all blocks contain visual.componentPath (animation) or visual.imagePath (image) */
export interface VisualReadyScript extends Script {
  blocks: (Block & { visual: { description: string; componentPath?: string; imagePath?: string } })[];
}

/** render input prerequisite; all blocks contain audio + (componentPath | imagePath), but timing not yet calculated */
export interface RenderInputScript extends Script {
  blocks: (Block & {
    audio: NonNullable<Block["audio"]>;
    visual: { description: string; componentPath?: string; imagePath?: string };
  })[];
}

/** render complete; all blocks contain audio + (componentPath | imagePath) + timing + render */
export interface RenderedScript extends Script {
  blocks: (Block & {
    audio: NonNullable<Block["audio"]>;
    visual: { description: string; componentPath?: string; imagePath?: string };
    timing: NonNullable<Block["timing"]>;
    render: NonNullable<Block["render"]>;
  })[];
}

// ---------------------------------------------------------------------------
// LLM-generated component props interface
// ---------------------------------------------------------------------------

export interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: Theme;
  fps: number;
}

// ---------------------------------------------------------------------------
// System-side rendering shell interfaces
// ---------------------------------------------------------------------------

export interface BlockFrameProps {
  enter: AnimationPreset;
  exit: AnimationPreset;
  enterFrames: number;
  exitFrames: number;
  durationInFrames: number;
  fps: number;
  children: unknown;
}

export interface SubtitleOverlayProps {
  lines: NarrationLine[];
  lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
  audioStartFrame: number;
  frame: number;
  fps: number;
  theme: Theme;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Type guard: checks if a Script has been compiled (has meta, blocks with visual/narration).
 */
export function isCompiled(script: Script): script is CompiledScript {
  return (
    script.meta.schemaVersion === "1.0" &&
    Array.isArray(script.blocks) &&
    script.blocks.length > 0 &&
    script.blocks.every(
      (b) =>
        typeof b.id === "string" &&
        typeof b.title === "string" &&
        typeof b.visual?.description === "string" &&
        Array.isArray(b.narration?.lines),
    )
  );
}

/**
 * Type guard: checks if a Script has audio ready (all blocks have audio with wavPath and durationSec).
 */
export function isAudioReady(script: Script): script is AudioReadyScript {
  return script.blocks.every(
    (b) =>
      b.audio !== undefined &&
      typeof b.audio.wavPath === "string" &&
      typeof b.audio.durationSec === "number" &&
      Array.isArray(b.audio.lineTimings),
  );
}

/**
 * Type guard: checks if a Script has visuals ready.
 * Animation blocks require visual.componentPath; image blocks require visual.imagePath.
 */
export function isVisualReady(script: Script): script is VisualReadyScript {
  return script.blocks.every((b) => {
    if (b.visualMode === 'image') {
      return b.visual.imagePath !== undefined && typeof b.visual.imagePath === 'string';
    }
    return b.visual.componentPath !== undefined && typeof b.visual.componentPath === 'string';
  });
}

/**
 * Asserts that a Script has visuals ready.
 * Animation blocks require visual.componentPath; image blocks require visual.imagePath.
 * Throws descriptive error if not.
 */
export function assertVisualsReady(data: unknown): asserts data is VisualReadyScript {
  if (typeof data !== "object" || data === null) {
    throw new Error("Expected object for VisualReadyScript");
  }
  const s = data as Record<string, unknown>;

  if (typeof s.meta !== "object" || s.meta === null) {
    throw new Error("Missing meta");
  }
  const meta = s.meta as Record<string, unknown>;
  if (meta.schemaVersion !== "1.0") throw new Error("Missing or invalid meta.schemaVersion");
  if (typeof meta.title !== "string") throw new Error("Missing meta.title");
  if (!Array.isArray(s.blocks)) throw new Error("Missing blocks");

  for (let i = 0; i < (s.blocks as unknown[]).length; i++) {
    const block = (s.blocks as Record<string, unknown>[])[i];
    if (typeof block.id !== "string") throw new Error(`Block ${i}: missing id`);

    if (typeof block.visual !== "object" || block.visual === null) {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing visual`);
    }
    const visual = block.visual as Record<string, unknown>;
    const vmode = typeof block.visualMode === 'string' ? block.visualMode : 'animation';

    if (vmode === 'image') {
      if (typeof visual.imagePath !== "string") {
        throw new Error(`Block ${i} (${block.id ?? "unknown"}): image mode requires visual.imagePath`);
      }
    } else {
      if (typeof visual.componentPath !== "string") {
        throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing visual.componentPath`);
      }
    }
  }
}

/**
 * Type guard: checks if a Script is RenderInput ready (all blocks have audio + visual).
 * Animation blocks require visual.componentPath; image blocks require visual.imagePath.
 */
export function isRenderInputReady(script: Script): script is RenderInputScript {
  return (
    isAudioReady(script) &&
    script.blocks.every((b) => {
      if (b.visualMode === 'image') {
        return b.visual.imagePath !== undefined && typeof b.visual.imagePath === 'string';
      }
      return b.visual.componentPath !== undefined && typeof b.visual.componentPath === 'string';
    })
  );
}

/**
 * Type guard: checks if a Script is fully Rendered (all blocks have audio + visual + timing + render).
 */
export function isRendered(script: Script): script is RenderedScript {
  return script.blocks.every(
    (b) =>
      b.audio !== undefined &&
      (b.visual.componentPath !== undefined || b.visual.imagePath !== undefined) &&
      b.timing !== undefined &&
      b.render !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Assertion helpers (with descriptive errors)
// ---------------------------------------------------------------------------

/**
 * Asserts that a Script is RenderInput ready (all blocks have audio + componentPath).
 * When `blockIds` is provided, only validates those specific blocks; other blocks
 * are allowed to be incomplete (e.g. during staged / partial rendering).
 * Throws descriptive error if not.
 */
export function assertRenderInputReady(
  data: unknown,
  blockIds?: Set<string>,
): asserts data is RenderInputScript {
  if (typeof data !== "object" || data === null) {
    throw new Error("Expected object for RenderInputScript");
  }
  const s = data as Record<string, unknown>;

  if (typeof s.meta !== "object" || s.meta === null) {
    throw new Error("Missing meta");
  }
  const meta = s.meta as Record<string, unknown>;
  if (meta.schemaVersion !== "1.0") throw new Error("Missing or invalid meta.schemaVersion");
  if (typeof meta.title !== "string") throw new Error("Missing meta.title");
  if (!Array.isArray(s.blocks)) throw new Error("Missing blocks");

  for (let i = 0; i < (s.blocks as unknown[]).length; i++) {
    const block = (s.blocks as Record<string, unknown>[])[i];
    if (typeof block.id !== "string") throw new Error(`Block ${i}: missing id`);
    if (typeof block.title !== "string") throw new Error(`Block ${i}: missing title`);

    // When a block-ID filter is active, skip validation for blocks outside the target set.
    if (blockIds && !blockIds.has(block.id as string)) continue;

    if (typeof block.visual !== "object" || block.visual === null) {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing visual`);
    }
    const visual = block.visual as Record<string, unknown>;
    const vmode = typeof block.visualMode === 'string' ? block.visualMode : 'animation';
    if (vmode === 'image') {
      if (typeof visual.imagePath !== "string") {
        throw new Error(`Block ${i} (${block.id ?? "unknown"}): image mode requires visual.imagePath`);
      }
    } else {
      if (typeof visual.componentPath !== "string") {
        throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing visual.componentPath (required for render)`);
      }
    }

    if (typeof block.audio !== "object" || block.audio === null) {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing audio (required for render)`);
    }
    const audio = block.audio as Record<string, unknown>;
    if (typeof audio.wavPath !== "string") {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing audio.wavPath`);
    }
    if (typeof audio.durationSec !== "number") {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing audio.durationSec`);
    }
  }
}
/**
 * Asserts that a Script is Compiled (has meta, blocks with visual/narration).
 * Throws descriptive error if not.
 */
export function assertCompiledScript(data: unknown): asserts data is CompiledScript {
  if (typeof data !== "object" || data === null) {
    throw new Error("Expected object for CompiledScript");
  }
  const s = data as Record<string, unknown>;

  if (typeof s.meta !== "object" || s.meta === null) {
    throw new Error("Missing meta");
  }
  const meta = s.meta as Record<string, unknown>;
  if (meta.schemaVersion !== "1.0") throw new Error("Missing or invalid meta.schemaVersion");
  if (typeof meta.title !== "string") throw new Error("Missing meta.title");
  if (!Array.isArray(s.blocks)) throw new Error("Missing blocks");
  if (s.blocks.length === 0) throw new Error("blocks array is empty");

  for (let i = 0; i < (s.blocks as unknown[]).length; i++) {
    const block = (s.blocks as Record<string, unknown>[])[i];
    if (typeof block.id !== "string") throw new Error(`Block ${i}: missing id`);
    if (typeof block.title !== "string") throw new Error(`Block ${i}: missing title`);

    if (typeof block.visual !== "object" || block.visual === null) {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing visual`);
    }
    const visual = block.visual as Record<string, unknown>;
    if (typeof visual.description !== "string") {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing visual.description`);
    }

    if (typeof block.narration !== "object" || block.narration === null) {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing narration`);
    }
    const narration = block.narration as Record<string, unknown>;
    if (!Array.isArray(narration.lines)) {
      throw new Error(`Block ${i} (${block.id ?? "unknown"}): missing narration.lines`);
    }

    // Audio and visual fields may be pre-populated from prior runs;
    // allow them to persist so stages can be run independently.
  }

  if (typeof s.artifacts !== "object" || s.artifacts === null || !(s.artifacts as Record<string, unknown>).compiledAt) {
    throw new Error("Missing artifacts.compiledAt");
  }
}
