/**
 * AutoVideo v2 — Animation presets
 * Each preset is a pure function: (frame, durationFrames) → CSSProperties
 */

import { interpolate, Easing } from 'remotion';
import type React from 'react';

export type AnimationPreset =
  | 'none' | 'fade' | 'fade-up' | 'fade-down' | 'fade-left' | 'fade-right'
  | 'scale' | 'zoom-in' | 'zoom-out' | 'blur-in' | 'blur-out' | 'auto';

interface AnimConfig {
  preset: AnimationPreset;
  duration: number;  // seconds
  easing?: string;
}

// ─── Easing map ───────────────────────────────────────────────────────────────

const easings: Record<string, (t: number) => number> = {
  'ease-out':   Easing.out(Easing.cubic),
  'ease-in':    Easing.in(Easing.cubic),
  'ease-in-out':Easing.inOut(Easing.cubic),
  'linear':     Easing.linear,
  'spring':     Easing.out(Easing.back(1.5)),
};

function getEasing(name?: string) {
  return easings[name ?? 'ease-out'] ?? easings['ease-out'];
}

// ─── Preset implementations ───────────────────────────────────────────────────

type StyleFn = (progress: number) => React.CSSProperties;

const ENTER_PRESETS: Record<string, StyleFn> = {
  none: () => ({}),

  fade: (p) => ({ opacity: p }),

  'fade-up': (p) => ({
    opacity: p,
    transform: `translateY(${(1 - p) * 40}px)`,
  }),

  'fade-down': (p) => ({
    opacity: p,
    transform: `translateY(${-(1 - p) * 40}px)`,
  }),

  'fade-left': (p) => ({
    opacity: p,
    transform: `translateX(${(1 - p) * 60}px)`,
  }),

  'fade-right': (p) => ({
    opacity: p,
    transform: `translateX(${-(1 - p) * 60}px)`,
  }),

  scale: (p) => ({
    opacity: p,
    transform: `scale(${0.8 + p * 0.2})`,
  }),

  'zoom-in': (p) => ({
    opacity: p,
    transform: `scale(${1.15 - p * 0.15})`,
  }),

  'blur-in': (p) => ({
    opacity: p,
    filter: `blur(${(1 - p) * 12}px)`,
  }),
};

const EXIT_PRESETS: Record<string, StyleFn> = {
  none: () => ({}),

  fade: (p) => ({ opacity: 1 - p }),

  'fade-up': (p) => ({
    opacity: 1 - p,
    transform: `translateY(${-p * 30}px)`,
  }),

  'fade-down': (p) => ({
    opacity: 1 - p,
    transform: `translateY(${p * 30}px)`,
  }),

  'zoom-out': (p) => ({
    opacity: 1 - p,
    transform: `scale(${1 - p * 0.1})`,
  }),

  'blur-out': (p) => ({
    opacity: 1 - p,
    filter: `blur(${p * 10}px)`,
  }),
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute enter animation CSS at a given frame.
 * @param frame  current frame (local to block, starts at 0)
 * @param fps
 * @param config enter animation config
 */
export function enterStyle(
  frame: number,
  fps: number,
  config: AnimConfig,
): React.CSSProperties {
  if (config.preset === 'none' || config.preset === 'auto') return {};
  const durationFrames = config.duration * fps;
  if (durationFrames <= 0) return {};

  const progress = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: getEasing(config.easing),
  });

  const fn = ENTER_PRESETS[config.preset] ?? ENTER_PRESETS['fade'];
  return fn(progress);
}

/**
 * Compute exit animation CSS at a given frame.
 * @param frame        current frame (local to block)
 * @param totalFrames  total block duration in frames
 * @param fps
 * @param config       exit animation config
 */
export function exitStyle(
  frame: number,
  totalFrames: number,
  fps: number,
  config: AnimConfig,
): React.CSSProperties {
  if (config.preset === 'none' || config.preset === 'auto') return {};
  const durationFrames = config.duration * fps;
  if (durationFrames <= 0) return {};

  const exitStart = totalFrames - durationFrames;
  if (frame < exitStart) return {};

  const progress = interpolate(frame, [exitStart, totalFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: getEasing(config.easing),
  });

  // Map exit preset names (remove '-out' suffix if present)
  const presetKey = config.preset.replace(/-out$/, '');
  const fn = EXIT_PRESETS[config.preset] ?? EXIT_PRESETS[presetKey] ?? EXIT_PRESETS['fade'];
  return fn(progress);
}

/**
 * Combined enter + exit style for a block frame.
 */
export function blockAnimStyle(
  frame: number,
  totalFrames: number,
  fps: number,
  enter: AnimConfig,
  exit: AnimConfig,
): React.CSSProperties {
  return {
    ...enterStyle(frame, fps, enter),
    ...exitStyle(frame, totalFrames, fps, exit),
  };
}
