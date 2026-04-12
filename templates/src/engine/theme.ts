/**
 * AutoVideo v2 — Global Theme
 * All visual tokens: colors, fonts, sizes, safe areas.
 */

export interface Theme {
  name: string;
  bg: string;
  bgDeep: string;
  bgCard: string;
  fg: string;
  fgMuted: string;
  accent: string;
  accent2: string;
  danger: string;
  fonts: {
    body: string;
    mono: string;
    display: string;
  };
  sizes: Record<string, number>;  // hero | title | body | subtitle | code
  subtitleSafeArea: { x: number; y: number; w: number; h: number };
  codeTheme: string;
  borderRadius: number;
  subtitleBg: string;
  subtitleFg: string;
}

const THEMES: Record<string, Theme> = {
  'dark-code': {
    name: 'dark-code',
    bg:      '#0d1117',
    bgDeep:  '#05080c',
    bgCard:  '#161b22',
    fg:      '#e6edf3',
    fgMuted: '#8b949e',
    accent:  '#ffb86b',
    accent2: '#7ee787',
    danger:  '#ff7b72',
    fonts: {
      body:    '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
      mono:    '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      display: '"Noto Serif SC", "Source Han Serif SC", serif',
    },
    sizes: {
      hero:     120,   // was 108 — large title cards
      title:    80,    // was 64
      subtitle: 60,    // was 48 — main content labels
      body:     52,    // was 38 — primary narration/explanation text
      caption:  40,    // was 28
      code:     44,    // was 32 — code blocks
      narration: 56,   // subtitle strip at bottom
    },
    // Bottom strip: y=0.82, h=0.14 — gives ~150px at 1080p, enough for 2 lines
    subtitleSafeArea: { x: 0.04, y: 0.82, w: 0.92, h: 0.14 },
    codeTheme: 'github-dark',
    borderRadius: 14,
    subtitleBg: 'rgba(0,0,0,0.72)',
    subtitleFg: '#e6edf3',
  },
  'light': {
    name: 'light',
    bg:      '#f6f8fa',
    bgDeep:  '#ffffff',
    bgCard:  '#ffffff',
    fg:      '#1f2328',
    fgMuted: '#656d76',
    accent:  '#d97706',
    accent2: '#16a34a',
    danger:  '#dc2626',
    fonts: {
      body:    '"Noto Sans SC", "PingFang SC", sans-serif',
      mono:    '"JetBrains Mono", monospace',
      display: '"Noto Serif SC", serif',
    },
    sizes: {
      hero:     120,
      title:    80,
      subtitle: 60,
      body:     52,
      caption:  40,
      code:     44,
      narration: 56,
    },
    subtitleSafeArea: { x: 0.04, y: 0.82, w: 0.92, h: 0.14 },
    codeTheme: 'github-light',
    borderRadius: 14,
    subtitleBg: 'rgba(255,255,255,0.85)',
    subtitleFg: '#1f2328',
  },
};

/** Get theme by name, with 'dark-code' as fallback */
export function getTheme(name?: string): Theme {
  return THEMES[name ?? 'dark-code'] ?? THEMES['dark-code'];
}

export default THEMES['dark-code'];
