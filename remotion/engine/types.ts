/**
 * AutoVideo — Remotion layer type definitions
 *
 * Self-contained type definitions for the Remotion rendering layer.
 * These mirror the types from src/types/script.ts but are standalone
 * to avoid cross-layer import issues in the webpack bundler.
 */

// ---------------------------------------------------------------------------
// Animation presets
// ---------------------------------------------------------------------------

export type AnimationPreset =
  | "fade"
  | "fade-up"
  | "fade-down"
  | "slide-left"
  | "slide-right"
  | "zoom-in"
  | "zoom-out"
  | "none";

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
  fonts: { sans: string; mono: string };
  spacing: { unit: number };
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
  text: string;
  ttsText: string;
  highlights: { start: number; end: number }[];
}

// ---------------------------------------------------------------------------
// Component props
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

export interface BlockFrameProps {
  enter: AnimationPreset;
  exit: AnimationPreset;
  enterFrames: number;
  exitFrames: number;
  durationInFrames: number;
  fps: number;
  children: React.ReactNode;
}

export interface SubtitleOverlayProps {
  lines: NarrationLine[];
  lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
  audioStartFrame: number;
  frame: number;
  fps: number;
  theme: Theme;
}