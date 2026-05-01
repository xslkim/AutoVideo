/**
 * AutoVideo — Canonical type definitions for script.json
 *
 * Based on PRD §4 "数据模型：script.json"
 */

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
// Block — the core unit of a script
// ---------------------------------------------------------------------------

export interface Block {
  /** Block ID, e.g. "B01" */
  id: string;
  /** Human-readable block title */
  title: string;
  /** Entrance animation preset */
  enter: AnimationPreset;
  /** Exit animation preset */
  exit: AnimationPreset;

  visual: {
    /** Raw visual description text (fed to LLM) */
    description: string;
    /** Path to generated .tsx component (filled in Stage 3 — visuals) */
    componentPath?: string;
  };

  narration: {
    lines: NarrationLine[];
    /** Explicit duration from @duration directive (e.g. 8 means 8 seconds) */
    explicitDurationSec?: number;
  };

  /** Stage 2 (tts) fills this */
  audio?: {
    /** POSIX path relative to build out dir, always "public/audio/{id}.wav" */
    wavPath: string;
    /** Total merged WAV duration in seconds (includes trailing 200ms silence per line) */
    durationSec: number;
    /** Per-line timing offsets relative to block audio origin (0ms) */
    lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
  };

  /** Stage 4 (render) fills this */
  timing?: {
    enterSec: number;
    holdSec: number;
    exitSec: number;
    totalSec: number;
    frames: number;
    /** = round(enterSec * fps) — used by SubtitleOverlay and Audio offset */
    enterFrames: number;
  };

  /** Stage 4 (render) fills this — partial mp4 cache info */
  render?: {
    /** POSIX path relative to build out dir, always "output/partials/{id}.mp4" */
    partialPath: string;
    /** Whether this render used cached partial (true = cp, false = real render) */
    cacheHit: boolean;
  };
}

// ---------------------------------------------------------------------------
// Script — the canonical IR
// ---------------------------------------------------------------------------

export interface Script {
  meta: {
    schemaVersion: "1.0";
    title: string;
    /** Absolute path to reference audio (resolved during compile; default: B00.wav next to meta.md) */
    voiceRef: string;
    aspect: AspectRatio;
    /** Video width in pixels */
    width: number;
    /** Video height in pixels */
    height: number;
    /** Frames per second */
    fps: number;
    /** Visual theme name */
    theme: string;
    /** Bottom pixel height reserved for subtitles, computed from resolution */
    subtitleSafeBottom: number;
  };
  blocks: Block[];
  /** Local asset manifest: relative POSIX path (relative to project.json dir) → "assets/{hash}.ext" */
  assets: Record<string, string>;
  artifacts: {
    compiledAt?: string;
    audioGeneratedAt?: string;
    visualsGeneratedAt?: string;
    renderedAt?: string;
  };
}

// ---------------------------------------------------------------------------
// Stage-specific readiness types
// ---------------------------------------------------------------------------

/**
 * Output of compile stage.
 * No audio, no componentPath, no timing, no render.
 */
export type CompiledScript = Omit<
  Script,
  "blocks"
> & {
  blocks: Array<
    Omit<Block, "audio" | "timing" | "render"> & {
      visual: Omit<Block["visual"], "componentPath">;
      audio?: undefined;
      timing?: undefined;
      render?: undefined;
    }
  >;
  artifacts: Omit<Script["artifacts"], "audioGeneratedAt" | "visualsGeneratedAt" | "renderedAt"> & {
    compiledAt: string;
  };
};

/**
 * Output of tts stage.
 * All blocks have audio populated.
 */
export type AudioReadyScript = Omit<
  Script,
  "blocks"
> & {
  blocks: Array<
    Omit<Block, "audio"> & {
      audio: NonNullable<Block["audio"]>;
      timing?: undefined;
      render?: undefined;
    }
  >;
  artifacts: Omit<Script["artifacts"], "audioGeneratedAt" | "renderedAt"> & {
    compiledAt: string;
    audioGeneratedAt: string;
  };
};

/**
 * Output of visuals stage.
 * All blocks have visual.componentPath populated.
 */
export type VisualReadyScript = Omit<
  Script,
  "blocks"
> & {
  blocks: Array<
    Omit<Block, "visual" | "audio"> & {
      visual: Omit<Block["visual"], "componentPath"> & {
        componentPath: string;
      };
      audio?: NonNullable<Block["audio"]>;
      timing?: undefined;
      render?: undefined;
    }
  >;
  artifacts: Omit<Script["artifacts"], "visualsGeneratedAt" | "renderedAt"> & {
    compiledAt: string;
    visualsGeneratedAt: string;
    audioGeneratedAt?: string;
  };
};

/**
 * Input to render stage.
 * All blocks have audio + componentPath, but timing not yet computed.
 */
export type RenderInputScript = Omit<
  Script,
  "blocks"
> & {
  blocks: Array<
    Omit<Block, "audio" | "visual" | "timing" | "render"> & {
      visual: Omit<Block["visual"], "componentPath"> & {
        componentPath: string;
      };
      audio: NonNullable<Block["audio"]>;
      timing?: undefined;
      render?: undefined;
    }
  >;
  artifacts: Omit<Script["artifacts"], "renderedAt">;
};

/**
 * Output of render stage.
 * All blocks have audio + componentPath + timing + render.partialPath.
 */
export type RenderedScript = Omit<
  Script,
  "blocks"
> & {
  blocks: Array<
    Omit<Block, "audio" | "visual" | "timing" | "render"> & {
      visual: Omit<Block["visual"], "componentPath"> & {
        componentPath: string;
      };
      audio: NonNullable<Block["audio"]>;
      timing: NonNullable<Block["timing"]>;
      render: NonNullable<Block["render"]>;
    }
  >;
  artifacts: Script["artifacts"] & {
    compiledAt: string;
    renderedAt: string;
  };
};

// ---------------------------------------------------------------------------
// Type guards for readiness types
// ---------------------------------------------------------------------------

/**
 * Asserts that a Script is a valid CompiledScript.
 * Throws on missing required fields.
 */
export function assertCompiledScript(data: unknown): asserts data is CompiledScript {
  if (typeof data !== "object" || data === null) {
    throw new Error("Expected object");
  }
  const s = data as Record<string, unknown>;

  if (typeof s.meta !== "object" || s.meta === null) {
    throw new Error("Missing meta");
  }
  const meta = s.meta as Record<string, unknown>;
  if (meta.schemaVersion !== "1.0") throw new Error("Missing or invalid meta.schemaVersion");
  if (typeof meta.title !== "string") throw new Error("Missing meta.title");
  if (typeof meta.voiceRef !== "string") throw new Error("Missing meta.voiceRef");
  if (!Array.isArray(s.blocks)) throw new Error("Missing blocks");

  for (let i = 0; i < (s.blocks as unknown[]).length; i++) {
    const block = (s.blocks as Record<string, unknown>[])[i];
    if (typeof block.id !== "string") throw new Error(`Block ${i}: missing id`);
    if (typeof block.title !== "string") throw new Error(`Block ${i}: missing title`);
    if (typeof block.visual !== "object" || block.visual === null) throw new Error(`Block ${i}: missing visual`);
    const visual = block.visual as Record<string, unknown>;
    if (typeof visual.description !== "string") throw new Error(`Block ${i}: missing visual.description`);
    if (visual.componentPath !== undefined) {
      throw new Error(`Block ${i}: visual.componentPath should not be set at compile stage`);
    }
    if (block.audio !== undefined) throw new Error(`Block ${i}: audio should not be set at compile stage`);
    if (block.timing !== undefined) throw new Error(`Block ${i}: timing should not be set at compile stage`);
    if (block.render !== undefined) throw new Error(`Block ${i}: render should not be set at compile stage`);
  }

  const artifacts = s.artifacts as Record<string, unknown> | undefined;
  if (!artifacts || typeof artifacts.compiledAt !== "string") {
    throw new Error("Missing artifacts.compiledAt");
  }
}

/**
 * Type guard: checks if a Script is AudioReady (all blocks have audio).
 */
export function isAudioReady(script: Script): script is AudioReadyScript {
  return script.blocks.every((b) => b.audio !== undefined);
}

/**
 * Type guard: checks if a Script is VisualReady (all blocks have componentPath).
 */
export function isVisualReady(script: Script): script is VisualReadyScript {
  return script.blocks.every((b) => b.visual.componentPath !== undefined);
}

/**
 * Type guard: checks if a Script is RenderInput (all blocks have audio + componentPath).
 */
export function isRenderInputReady(script: Script): script is RenderInputScript {
  return script.blocks.every(
    (b) => b.audio !== undefined && b.visual.componentPath !== undefined,
  );
}

/**
 * Type guard: checks if a Script is fully Rendered (all blocks have audio + componentPath + timing + render).
 */
export function isRendered(script: Script): script is RenderedScript {
  return script.blocks.every(
    (b) =>
      b.audio !== undefined &&
      b.visual.componentPath !== undefined &&
      b.timing !== undefined &&
      b.render !== undefined,
  );
}

// ---------------------------------------------------------------------------
// LLM-generated component props interface
// ---------------------------------------------------------------------------

export interface AnimationProps {
  /** In-block frame (0-based); fallback for useCurrentFrame() */
  frame: number;
  /** Total number of frames for this block */
  durationInFrames: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Bottom subtitle safe area height in pixels */
  subtitleSafeBottom: number;
  /** Current theme */
  theme: Theme;
  /** Frames per second */
  fps: number;
}

// ---------------------------------------------------------------------------
// System-side rendering shell props
// ---------------------------------------------------------------------------

export interface BlockFrameProps {
  /** Entrance animation preset */
  enter: AnimationPreset;
  /** Exit animation preset */
  exit: AnimationPreset;
  /** Number of frames for entrance animation */
  enterFrames: number;
  /** Number of frames for exit animation */
  exitFrames: number;
  /** Total frames for this block (enter + hold + exit) */
  durationInFrames: number;
  /** Frames per second */
  fps: number;
  /** Block content (DynamicComponent + SubtitleOverlay + Audio) */
  children: unknown;
}

export interface SubtitleOverlayProps {
  /** Narration lines with highlight info */
  lines: NarrationLine[];
  /** Per-line timing offsets (ms) */
  lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
  /** Frame at which audio (and thus subtitles) start = enterFrames */
  audioStartFrame: number;
  /** Current in-block frame */
  frame: number;
  /** Frames per second */
  fps: number;
  /** Current theme */
  theme: Theme;
}
