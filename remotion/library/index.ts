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
export { KineticTitle } from "./components/KineticTitle";
export { QuoteCard } from "./components/QuoteCard";
export { BentoGrid } from "./components/BentoGrid";
export { GradientStage } from "./components/GradientStage";
export { NumberTicker } from "./components/NumberTicker";
export { ChartGrow } from "./components/ChartGrow";
export { FlowArrow } from "./components/FlowArrow";
export { MorphBadge } from "./components/MorphBadge";
export { CodeWindow } from "./components/CodeWindow";
export { TimelineRuler } from "./components/TimelineRuler";
export { DoodleMark } from "./components/DoodleMark";
export { Icon } from "./components/Icon";
export { ProgressBar } from "./components/ProgressBar";
export { Watermark } from "./components/Watermark";
export { EndCard } from "./components/EndCard";

export type { TitleCardSpec, TitleCardProps } from "./components/TitleCard.js";
export type { KeyPointsSpec, KeyPointsProps } from "./components/KeyPoints.js";
export type { CodeBlockSpec, CodeBlockProps } from "./components/CodeBlock.js";
export type { FlowDiagramSpec, FlowDiagramProps } from "./components/FlowDiagram.js";
export type { DataBarsSpec, DataBarsProps } from "./components/DataBars.js";
export type { KineticTitleSpec, KineticTitleProps } from "./components/KineticTitle.js";
export type { QuoteCardSpec, QuoteCardProps } from "./components/QuoteCard.js";
export type { BentoCardSpec, BentoGridSpec, BentoGridProps } from "./components/BentoGrid.js";
export type { GradientStageSpec, GradientStageProps } from "./components/GradientStage.js";
export type { NumberTickerSpec, NumberTickerProps } from "./components/NumberTicker.js";
export type { ChartGrowSpec, ChartGrowSeries, ChartGrowProps } from "./components/ChartGrow.js";
export type { FlowArrowSpec, FlowArrowProps } from "./components/FlowArrow.js";
export type { MorphBadgeSpec, MorphBadgeProps } from "./components/MorphBadge.js";
export type { CodeWindowSpec, CodeWindowProps } from "./components/CodeWindow.js";
export type { TimelineRulerSpec, TimelineRulerProps } from "./components/TimelineRuler.js";
export type { DoodleMarkSpec, DoodleMarkProps, DoodleMarkItem, DoodleMarkType, DoodleTarget } from "./components/DoodleMark.js";
export type { IconSpec, IconProps } from "./components/Icon.js";
export type { ProgressBarSpec, ProgressBarProps, ProgressBarChapter } from "./components/ProgressBar.js";
export type { WatermarkSpec, WatermarkProps, WatermarkPosition } from "./components/Watermark.js";
export type { EndCardSpec, EndCardProps } from "./components/EndCard.js";

// Icon name list and alias resolution are pure data/functions (icon-data.ts
// has no remotion dependency), exported for the web icon picker and docs.
export { ICON_NAMES, resolveIconName } from "./components/icon-data";
export type { IconName } from "./components/icon-data.js";

export type { LibraryProps, AccentOverride } from "./props.js";

export {
  TYPE, LAYOUT, DUR, typeSize, space, gridUnit, availHeight, frames,
  ELEVATION, elevation, GRADIENTS, gradient, STAGGER,
} from "./tokens";
export type { TypeToken, ElevationLevel, GradientToken, StaggerToken } from "./tokens.js";

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
  blurInStyle,
  maskRevealStyle,
  zoomSettleStyle,
  slideMaskStyle,
} from "./motion";
export type {
  SpringPreset,
  BeatWindow,
  PresetStyle,
  MaskRevealDirection,
  SlideMaskDirection,
} from "./motion.js";
