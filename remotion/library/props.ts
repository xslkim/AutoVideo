/**
 * AutoVideo — Library shared prop contract
 *
 * Every prefab component receives the full AnimationProps field set by name
 * (the assembly wrapper forwards each one explicitly) plus one JSON-
 * serializable `spec` object carrying pure content data. Specs must never
 * contain functions, class instances or React nodes — they are inlined into
 * machine-generated wrappers via JSON.stringify.
 */

import type { Theme, LineTimingSec } from "../engine/types.js";

export interface LibraryProps<Spec> {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: Theme;
  fps: number;
  lineTimings: LineTimingSec[];
  /** Pure-data content specification (JSON-serializable). */
  spec: Spec;
}

/** Spec fields every component accepts for colour accents. */
export interface AccentOverride {
  /** Defaults to theme.colors.accent. */
  accent?: string;
}
