/**
 * AutoVideo — Block directive parser
 *
 * Parses @enter, @exit, @duration, @visual directives from block headers.
 * Duration only accepts `<number>s` format per PRD §3.5.
 *
 * PRD references: §3.5 (块指令)
 */

import type { AnimationPreset, ANIMATION_PRESETS, VisualMode } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedDirectives {
  enter: AnimationPreset;
  exit: AnimationPreset;
  explicitDurationSec?: number;
  visualMode: VisualMode;
  /** Image source path for image mode (e.g. "./assets/hero.png"). Set → use local file; absent → call API. */
  imageSource?: string;
  /** Video source path for video mode (e.g. "./assets/demo.mp4"). Always set for video mode. */
  videoSource?: string;
}

export class DirectiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectiveError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PRESETS: readonly string[] = [
  "fade",
  "fade-up",
  "fade-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
  "none",
];

const DEFAULT_ENTER: AnimationPreset = "fade";
const DEFAULT_EXIT: AnimationPreset = "fade";
const DEFAULT_VISUAL_MODE: VisualMode = "animation";

const VALID_VISUAL_MODES: readonly string[] = ["animation", "image", "video"];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse directive lines from a block header.
 *
 * Input: lines between the `>>>` title line and `--- visual ---` delimiter.
 * Lines may include @type, @rect, @style, @align etc. which are ignored
 * (they are from the old format and not part of the current spec).
 *
 * Only @enter, @exit, @duration, @visual are parsed per PRD §3.5.
 */
export function parseDirectives(lines: string[]): ParsedDirectives {
  let enter: AnimationPreset = DEFAULT_ENTER;
  let exit: AnimationPreset = DEFAULT_EXIT;
  let explicitDurationSec: number | undefined;
  let visualMode: VisualMode = DEFAULT_VISUAL_MODE;
  let imageSource: string | undefined;
  let videoSource: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("@")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.substring(1, colonIdx).trim().toLowerCase(); // strip leading @
    const value = trimmed.substring(colonIdx + 1).trim();

    switch (key) {
      case "enter": {
        if (!VALID_PRESETS.includes(value)) {
          throw new DirectiveError(
            `Invalid @enter preset "${value}". Must be one of: ${VALID_PRESETS.join(", ")}`,
          );
        }
        enter = value as AnimationPreset;
        break;
      }
      case "exit": {
        if (!VALID_PRESETS.includes(value)) {
          throw new DirectiveError(
            `Invalid @exit preset "${value}". Must be one of: ${VALID_PRESETS.join(", ")}`,
          );
        }
        exit = value as AnimationPreset;
        break;
      }
      case "duration": {
        // Only accept `<number>s` format (PRD §3.5)
        const match = value.match(/^(\d+(?:\.\d+)?)s$/);
        if (!match) {
          throw new DirectiveError(
            `Invalid @duration "${value}". Must be in format "<number>s" (e.g. "8s", "1.5s"). ` +
              `Pure numbers, milliseconds, and compound durations (1m20s) are not supported.`,
          );
        }
        explicitDurationSec = parseFloat(match[1]);
        if (explicitDurationSec <= 0) {
          throw new DirectiveError(
            `@duration must be positive, got "${value}"`,
          );
        }
        break;
      }
      case "visual": {
        // Match "image(./path)" syntax for local image mode
        const imgMatch = value.match(/^image\((.+?)\)$/);
        if (imgMatch) {
          visualMode = "image";
          imageSource = imgMatch[1].trim();
        } else {
          // Match "video(./path)" syntax for local video mode
          const vidMatch = value.match(/^video\((.+?)\)$/);
          if (vidMatch) {
            visualMode = "video";
            videoSource = vidMatch[1].trim();
          } else if (VALID_VISUAL_MODES.includes(value)) {
            visualMode = value as VisualMode;
          } else {
            console.warn(
              `Invalid @visual "${value}". Must be one of: ${VALID_VISUAL_MODES.join(", ")}. Falling back to "${DEFAULT_VISUAL_MODE}".`,
            );
          }
        }
        break;
      }
      // Ignore unknown directives (like @type, @rect, @style, @align from old format)
    }
  }

  return {
    enter,
    exit,
    visualMode,
    ...(explicitDurationSec !== undefined ? { explicitDurationSec } : {}),
    ...(imageSource !== undefined ? { imageSource } : {}),
    ...(videoSource !== undefined ? { videoSource } : {}),
  };
}