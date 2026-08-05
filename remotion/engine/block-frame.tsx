/**
 * AutoVideo — BlockFrame
 *
 * Wraps block content (dynamic component + subtitle overlay + audio)
 * with enter/exit animation presets.
 *
 * @see PRD §4 — BlockFrameProps interface
 * @see PRD §6.4 step 3 — render structure
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  AbsoluteFill,
  interpolate,
  Easing,
} from "remotion";
import type { AnimationPreset, BlockFrameProps } from "./types.js";

// ---------------------------------------------------------------------------
// Animation preset → CSS transform / opacity mapping
// ---------------------------------------------------------------------------

/** Ease-out: fast start, gentle settle — how something arriving on screen should move. */
const ENTER_EASING = Easing.out(Easing.cubic);
/** Ease-in: slow start, accelerating away — how something leaving should move. */
const EXIT_EASING = Easing.in(Easing.cubic);

function getEnterStyle(
  preset: AnimationPreset,
  progress: number,
): React.CSSProperties {
  // progress: 0 → 1 (start → fully entered). A linear `progress` here reads as
  // mechanical — every block used to snap in at constant velocity.
  const eased = ENTER_EASING(progress);

  switch (preset) {
    case "fade":
      return { opacity: eased };
    case "fade-up":
      return {
        opacity: eased,
        transform: `translateY(${interpolate(eased, [0, 1], [40, 0])}px)`,
      };
    case "fade-down":
      return {
        opacity: eased,
        transform: `translateY(${interpolate(eased, [0, 1], [-40, 0])}px)`,
      };
    case "slide-left":
      return {
        transform: `translateX(${interpolate(eased, [0, 1], [-100, 0])}%)`,
      };
    case "slide-right":
      return {
        transform: `translateX(${interpolate(eased, [0, 1], [100, 0])}%)`,
      };
    case "zoom-in":
      return {
        opacity: eased,
        transform: `scale(${interpolate(eased, [0, 1], [0.5, 1])})`,
      };
    case "zoom-out":
      return {
        opacity: eased,
        transform: `scale(${interpolate(eased, [0, 1], [1.5, 1])})`,
      };
    case "none":
      return {};
    default:
      return { opacity: eased };
  }
}

function getExitStyle(
  preset: AnimationPreset,
  progress: number,
): React.CSSProperties {
  // progress: 0 → 1 (start exit → fully exited)
  const eased = EXIT_EASING(progress);

  switch (preset) {
    case "fade":
      return { opacity: 1 - eased };
    case "fade-up":
      return {
        opacity: 1 - eased,
        transform: `translateY(${interpolate(eased, [0, 1], [0, -40])}px)`,
      };
    case "fade-down":
      return {
        opacity: 1 - eased,
        transform: `translateY(${interpolate(eased, [0, 1], [0, 40])}px)`,
      };
    case "slide-left":
      return {
        transform: `translateX(${interpolate(eased, [0, 1], [0, 100])}%)`,
      };
    case "slide-right":
      return {
        transform: `translateX(${interpolate(eased, [0, 1], [0, -100])}%)`,
      };
    case "zoom-in":
      return {
        opacity: 1 - eased,
        transform: `scale(${interpolate(eased, [0, 1], [1, 1.5])})`,
      };
    case "zoom-out":
      return {
        opacity: 1 - eased,
        transform: `scale(${interpolate(eased, [0, 1], [1, 0.5])})`,
      };
    case "none":
      return {};
    default:
      return { opacity: 1 - eased };
  }
}

// ---------------------------------------------------------------------------
// BlockFrame component
// ---------------------------------------------------------------------------

export const BlockFrame: React.FC<BlockFrameProps> = ({
  enter,
  exit,
  enterFrames,
  exitFrames,
  durationInFrames,
  children,
}) => {
  const frame = useCurrentFrame();

  // Calculate animation style based on current frame position
  let animStyle: React.CSSProperties = {};

  if (frame < enterFrames && enterFrames > 0) {
    // Entrance phase
    const progress = frame / enterFrames;
    animStyle = getEnterStyle(enter, progress);
  } else if (frame >= durationInFrames - exitFrames && exitFrames > 0) {
    // Exit phase
    const progress = (frame - (durationInFrames - exitFrames)) / exitFrames;
    animStyle = getExitStyle(exit, Math.min(progress, 1));
  }

  return React.createElement(
    AbsoluteFill,
    { style: animStyle },
    children,
  );
};