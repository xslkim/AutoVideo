/**
 * AutoVideo — Theme tokens & font loading
 *
 * Implements the Theme interface from §4 and loads CJK + emoji fonts
 * via @remotion/google-fonts for consistent rendering in Remotion.
 */

import { loadFont as loadNotoSansSC } from "@remotion/google-fonts/NotoSansSC";
import { loadFont as loadNotoColorEmoji } from "@remotion/google-fonts/NotoColorEmoji";

import type { Theme } from "../../src/types/script.js";

// ---------------------------------------------------------------------------
// Font loading — eager, side-effect
// ---------------------------------------------------------------------------

loadNotoSansSC();
loadNotoColorEmoji();

// ---------------------------------------------------------------------------
// dark-code theme
// ---------------------------------------------------------------------------

const DARK_CODE: Theme = {
  name: "dark-code",
  colors: {
    bg: "#0d1117",
    fg: "#e6edf3",
    accent: "#58a6ff",
    muted: "#8b949e",
    code: {
      bg: "#161b22",
      fg: "#e6edf3",
      keyword: "#ff7b72",
      string: "#a5d6ff",
      comment: "#8b949e",
    },
  },
  fonts: {
    sans: "Noto Sans SC, Noto Sans, sans-serif",
    mono: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
  },
  spacing: {
    unit: 8,
  },
  subtitle: {
    fontFamily: "Noto Sans SC, Noto Sans, Noto Color Emoji, sans-serif",
    fontSizePct: 0.04,
    lineHeight: 1.5,
    maxWidthPct: 0.8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingPx: 12,
  },
};

// ---------------------------------------------------------------------------
// Theme registry
// ---------------------------------------------------------------------------

const THEMES: Record<string, Theme> = {
  "dark-code": DARK_CODE,
};

/**
 * Look up a theme by name.
 *
 * @throws if the theme name is not registered.
 */
export function getTheme(name: string): Theme {
  const theme = THEMES[name];
  if (!theme) {
    throw new Error(
      `Unknown theme "${name}". Available: ${Object.keys(THEMES).join(", ")}`,
    );
  }
  return theme;
}