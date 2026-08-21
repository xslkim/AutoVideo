/**
 * AutoVideo — Prefab animation component library (barrel)
 *
 * Self-contained: imports only react / remotion / library-internal relative
 * paths / types from ../engine/types. Generated wrappers import from here as
 * `../../../remotion/library`.
 *
 * Two import-specifier rules keep every consumer working at once:
 * - VALUE re-exports are extensionless — the Remotion webpack config has no
 *   extensionAlias, so "./components/TitleCard.js" would fail to resolve at
 *   bundle time (same convention as remotion/VideoComposition.tsx).
 * - TYPE re-exports keep `.js` — they are erased at transpile time, and the
 *   extension satisfies the repo's NodeNext type-check.
 *
 * NOTE: type re-exports must use `export type` — the render pipeline
 * type-checks with isolatedModules, which forbids re-exporting types
 * through a plain `export { … }`.
 */

export { TitleCard } from "./components/TitleCard";
export { KeyPoints } from "./components/KeyPoints";
export { CodeBlock } from "./components/CodeBlock";
export { FlowDiagram } from "./components/FlowDiagram";
export { DataBars } from "./components/DataBars";

export type { TitleCardSpec, TitleCardProps } from "./components/TitleCard.js";
export type { KeyPointsSpec, KeyPointsProps } from "./components/KeyPoints.js";
export type { CodeBlockSpec, CodeBlockProps } from "./components/CodeBlock.js";
export type { FlowDiagramSpec, FlowDiagramProps } from "./components/FlowDiagram.js";
export type { DataBarsSpec, DataBarsProps } from "./components/DataBars.js";

export type { LibraryProps, AccentOverride } from "./props.js";

export { TYPE, LAYOUT, DUR, typeSize, space, gridUnit, availHeight, frames } from "./tokens";
export type { TypeToken } from "./tokens.js";

export {
  EASE,
  SPRINGS,
  clamp01,
  enterProgress,
  springIn,
  staggerDelay,
  staggeredSpring,
  breathe,
  exitProgress,
  resolveBeatSchedule,
  activeIndexAt,
} from "./motion";
export type { SpringPreset, BeatWindow } from "./motion.js";
