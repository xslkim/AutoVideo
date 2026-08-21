/**
 * AutoVideo — visuals command (Stage 3)
 *
 * PRD §6.3 — Generate React components from visual descriptions via Claude.
 *
 * Flow:
 *   1. Validate script.json is CompiledScript readiness (no audio required)
 *   2. Compute promptVersion / assetHashesJson / claudeModel
 *   3. p-limit(anthropic.concurrency) for block-level concurrency
 *   4. Per block: cache lookup → miss → generate → validate (static + smoke)
 *      → failure: retry up to 5 rounds with error feedback → put cache → write file
 *   5. Failure: 5 rounds exhausted → AbortController cancels in-flight → exit + recovery command
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { CacheStore, type ComponentKey } from "../cache/store.js";
import {
  generateComponent,
  type AnthropicConfig,
  type ComponentGenInput,
  type ComponentGenResult,
} from "../ai/component-gen.js";
import {
  generateAssembly,
  buildAssemblySystemPrompt,
  type AssemblyGenInput,
} from "../ai/assembly-gen.js";
import { buildAssemblyWrapper } from "../ai/assembly-wrapper.js";
import { buildRegistryDocs } from "../ai/visual-registry.js";
import { generateImage, generateLocalImage } from "../ai/image-gen.js";
import {
  validateComponent,
  renderComponentStill,
  cleanupStill,
  classifyRenderError,
  type ValidateComponentOptions,
} from "../ai/validate.js";
import { assessVisualMetrics, checkNarrationSyncContract } from "../ai/visual-metrics.js";
import { reviewVisual } from "../ai/visual-review.js";
import { syncRemotionRuntime } from "../render/sync-runtime.js";
import { enumeratesNarration } from "../compile/sync-lint.js";
import { DEFAULT_VISUAL_QUALITY } from "../config/defaults.js";
import {
  assertCompiledScript,
  type Script,
  type Block,
  type ProgressEvent,
} from "../types/script.js";
import type { AutoVideoConfig } from "../config/defaults.js";

// ── Error class ───────────────────────────────────────────────────────

export class VisualsError extends Error {
  code: string;
  constructor(message: string, code = "ERR_VISUALS_FAILED") {
    super(message);
    this.name = "VisualsError";
    this.code = code;
  }
}

// ── Options ───────────────────────────────────────────────────────────

export interface VisualsOptions {
  /** Path to script.json */
  scriptPath: string;
  /** Fully merged configuration */
  config: AutoVideoConfig;
  /** Only process these block IDs */
  blockIds?: string[];
  /** Force cache miss for all/specified blocks */
  force?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Dry run — show plan but don't execute */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface VisualsResult {
  /** The updated script with componentPath fields populated */
  script: Script;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of Claude API calls made */
  apiCalls: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
/** Consecutive assembly failures before the loop switches to free generation. */
const MAX_ASSEMBLY_FAILURES = 2;
const RETRY_BASE_DELAY_MS = 60_000; // 60s base, doubles each attempt (60s / 120s / 240s / 480s / 960s …)
const POST_REQUEST_DELAY_MS = 0; // disabled — was 20s for Claude Code OAuth rate limit

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function is429(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("429") || err.message.includes("rate_limit");
  }
  return false;
}

/**
 * Cache-key component derived from the prompts we actually send.
 *
 * Hash the prompt we actually send. An earlier version hashed a prompt file
 * that was never shipped, so the fallback constant made every prompt edit a
 * no-op for cached blocks.
 *
 * The hashed material covers BOTH generation channels plus the registry docs
 * they share, so any edit to the free-generation prompt, the assembly prompt,
 * or the component registry invalidates the component cache.
 */
function computePromptVersion(promptMaterial: string): string {
  return crypto.createHash("md5").update(promptMaterial).digest("hex").slice(0, 8);
}

/**
 * Get asset hashes referenced in a block's visual description.
 */
function getAssetHashesForBlock(block: Block, script: Script): string[] {
  const hashes: string[] = [];
  for (const [, buildPath] of Object.entries(script.assets ?? {})) {
    if (block.visual.description.includes(buildPath)) {
      const match = buildPath.match(/^assets\/([a-f0-9]+)\./);
      if (match) {
        hashes.push(match[1]);
      }
    }
  }
  return hashes.sort();
}

/**
 * Build the ComponentKey used for cache lookup.
 */
function buildComponentKey(opts: {
  description: string;
  theme: string;
  width: number;
  height: number;
  promptVersion: string;
  assetHashes: string[];
  claudeModel: string;
  subtitleSafeBottom: number;
}): ComponentKey {
  return {
    descriptionHash: crypto
      .createHash("md5")
      .update(opts.description)
      .digest("hex"),
    theme: opts.theme,
    width: opts.width,
    height: opts.height,
    promptVersion: opts.promptVersion,
    assetHashesJson: JSON.stringify(opts.assetHashes),
    claudeModel: opts.claudeModel,
    subtitleSafeBottom: opts.subtitleSafeBottom,
  };
}

/** A narration line with its block-relative timing (enter included). */
interface NarrationLineSec {
  lineIndex: number;
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Compute the block's timeline the same way render.ts does
 * (computeBlockTimingWithFps), so review stills and the narration context
 * work against the real timeline rather than a smoke-test default.
 */
function blockTimingContext(
  block: Block,
  config: AutoVideoConfig
): { totalSec: number; narrationLineSecs: NarrationLineSec[] } {
  const enterSec =
    block.enter === "none" ? 0 : (config.render?.defaultEnterSec ?? 0.5);
  const exitSec =
    block.exit === "none" ? 0 : (config.render?.defaultExitSec ?? 0.3);
  const holdSec = Math.max(
    block.audio?.durationSec ?? 0,
    block.narration.explicitDurationSec ?? 0,
    config.render?.minHoldSec ?? 1.5
  );
  const lines = block.narration?.lines ?? [];
  const narrationLineSecs = (block.audio?.lineTimings ?? []).map((t) => ({
    lineIndex: t.lineIndex,
    text: lines[t.lineIndex]?.text ?? "",
    startSec: enterSec + t.startMs / 1000,
    endSec: enterSec + t.endMs / 1000,
  }));
  return { totalSec: enterSec + holdSec + exitSec, narrationLineSecs };
}

/**
 * Build the narration timing context appended to the user prompt.
 *
 * Gives the model the actual per-line beats so it can choreograph sensibly,
 * while the emitted component must still read props.lineTimings at runtime
 * (the values below go stale the moment the voiceover is re-synthesized).
 * Returns undefined when the block has no audio timings yet.
 */
function buildNarrationContext(
  block: Block,
  narrationLineSecs: NarrationLineSec[]
): string | undefined {
  if (narrationLineSecs.length === 0) return undefined;

  const rows = narrationLineSecs.map(
    (t) =>
      `  line ${t.lineIndex}: ${t.startSec.toFixed(2)}s – ${t.endSec.toFixed(2)}s  "${t.text}"`
  );

  const parts = [
    "Narration timing (block-relative seconds, enter animation included):",
    ...rows,
    "",
    "These are CURRENT measurements, provided only so you can feel the pacing. Do NOT hardcode them in the component — read props.lineTimings at runtime so the animation stays in sync when the voiceover is re-generated.",
  ];

  if (enumeratesNarration(block.narration?.lines ?? [])) {
    parts.push(
      "Note: the narration ENUMERATES items (第一/第二/… or numbered lines). If the slide shows corresponding items, their highlight/progression MUST follow props.lineTimings so the visual tracks the voiceover item by item."
    );
  }

  return parts.join("\n");
}

/**
 * Pick frame times (block-relative seconds) for the visual-quality review.
 * With narration timings: one entrance frame, midpoints of up to
 * `maxLineFrames` evenly spaced narration lines, and one near-exit frame —
 * so the reviewer sees the visual emphasis per narrated item and can judge
 * narration sync. Without timings: fixed early/mid/late fractions.
 */
export function pickReviewFrameTimes(
  narrationLineSecs: { startSec: number; endSec: number }[],
  totalSec: number,
  maxLineFrames = 4
): number[] {
  const early = totalSec * 0.05;
  const late = totalSec * 0.93;
  const n = narrationLineSecs.length;
  if (n === 0) return [early, totalSec * 0.5, late];

  const lineIdxs: number[] = [];
  if (n <= maxLineFrames) {
    for (let i = 0; i < n; i++) lineIdxs.push(i);
  } else {
    for (let k = 0; k < maxLineFrames; k++) {
      lineIdxs.push(Math.round((k * (n - 1)) / (maxLineFrames - 1)));
    }
  }
  const mids = lineIdxs.map(
    (i) =>
      (narrationLineSecs[i].startSec + narrationLineSecs[i].endSec) / 2
  );
  return [early, ...mids, late];
}

/**
 * Build the default system prompt for free-form component generation.
 *
 * Structure: prefab component library docs (single source: the registry) →
 * design-token summary (mirrors remotion/library/tokens.ts) → one complete
 * gold few-shot example → the hard rules. The library now owns most layout
 * detail, so only the still-applicable core constraints remain.
 */
function buildDefaultSystemPrompt(registryDocs: string): string {
  return `You are a React component generator for educational video slides shown FULLSCREEN to viewers.

Generate a single React component that renders a full-screen visual based on the user's description.

## Technical contract

- Export a default function component
- Accept AnimationProps: { frame, durationInFrames, width, height, subtitleSafeBottom, theme, fps, lineTimings }
- Import ONLY from "react", "remotion", and the prefab library "../../../remotion/library"
- Do NOT import fs, path, child_process, http, https, or any Node built-in
- Do NOT use eval, Function constructor, or require()
- Define \`AnimationProps\` interface inline in the file, then use \`React.FC<AnimationProps>\` or \`(props: AnimationProps)\` — NEVER destructure untyped props like \`({ frame })\` without a type
- Remotion imports MUST be only symbols that exist. Common allowed imports:
  \`interpolate\`, \`spring\`, \`useCurrentFrame\`, \`useVideoConfig\`, \`Easing\`, \`AbsoluteFill\`, \`Sequence\`, \`Img\`, \`Video\`, \`staticFile\`
- Do NOT import invented types/APIs such as \`ContinueProp\`, \`Easing.easeOut\`, \`Easing.cubicOut\` — use \`Easing.ease\`, \`Easing.out(Easing.cubic)\`, \`Easing.inOut(Easing.quad)\` instead
- Use theme.colors for consistent styling — the theme object has EXACTLY this shape:
  { colors: { bg, fg, accent, muted, code: { bg, fg, keyword, string, comment } }, fonts: { sans, mono }, spacing: { unit }, subtitle: { fontFamily, fontSizePct, lineHeight, maxWidthPct, backgroundColor, paddingPx } }
  IMPORTANT: Use theme.colors.bg (NOT background), theme.colors.fg (NOT text), theme.colors.accent, theme.colors.muted (NOT secondary).
- Return ONLY the component source as TSX code, no markdown fences

## Prefab component library

The pipeline ships a prefab component library, importable from "../../../remotion/library". PREFER composing these components over hand-rolling layouts they already cover — they are tuned for this pipeline (typography, spacing, staggered entrances, narration sync). Each one takes every AnimationProps field BY NAME (frame={props.frame}, …, lineTimings={props.lineTimings}) plus a \`spec\` object of pure JSON data. Combine them freely, and add your own custom elements for anything the description needs beyond them.

${registryDocs}

## Design tokens (remotion/library/tokens.ts)

The library's sizing system — import \`typeSize\`, \`space\`, \`LAYOUT\`, \`DUR\`, \`frames\` from "../../../remotion/library" instead of reinventing constants:

- Type scale (coefficient × height; 1080p px in parentheses): display 0.104 (≈112) · title 0.058 (≈63) · subtitle 0.036 (≈39) · body 0.027 (≈29) · code 0.023 (≈25) · caption 0.02 (≈22) · label 0.017 (≈18). Use \`typeSize(height, "title")\` etc.
- Spacing: 8 px grid at 1080p — \`space(height, units)\` = units × (height / 135). Use for all gaps, paddings, offsets.
- Layout: side margins = width × 0.0625 (\`LAYOUT.marginXPct\`); content column top ≈ 14 % of available height; long-text measure ≤ 72 % of width.
- Motion durations (seconds; convert with \`frames(sec, fps)\`): entrance 0.6, hero 0.9, stagger step 0.12 (dense 0.05), exit tail 0.5. \`EASE.enter\`/\`EASE.exit\`, \`SPRINGS\` presets and helpers (\`staggeredSpring\`, \`enterProgress\`, \`breathe\`, \`exitProgress\`, \`resolveBeatSchedule\`, \`activeIndexAt\`) are exported from the library.

## Gold example

A complete Component.tsx showing the standard assembly style — a library component does the heavy lifting, custom elements add what only this description needs. Note the named prop forwarding and the inline typed spec:

\`\`\`tsx
import React from "react";
import { AbsoluteFill } from "remotion";
import {
  KeyPoints,
  breathe,
  clamp01,
  space,
  staggeredSpring,
  typeSize,
} from "../../../remotion/library";
import type { KeyPointsSpec } from "../../../remotion/library";

interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: any; fps: number;
  lineTimings: { startSec: number; endSec: number }[];
}

const SPEC: KeyPointsSpec = {
  title: "核心要点",
  points: [
    { title: "查询与键做点积", detail: "得到每个位置的注意力分数" },
    { title: "softmax 归一化" },
    { title: "加权求和值向量", detail: "输出是值的凸组合" },
  ],
};

const Component: React.FC<AnimationProps> = (props) => {
  const { frame, fps, width, height, theme } = props;
  // Custom accent the library does not provide: a breathing marker bar that
  // settles in just before the list, keeping motion alive during the hold.
  const barP = clamp01(staggeredSpring(frame, fps, 0, { preset: "gentle" }));
  const glow = breathe(frame, fps, { min: 0.55, max: 1 });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      <div
        style={{
          position: "absolute",
          top: space(height, 3),
          left: width * 0.0625,
          width: typeSize(height, "label") * 8,
          height: Math.max(3, space(height, 0.75)),
          borderRadius: 2,
          backgroundColor: theme.colors.accent,
          opacity: barP * glow,
        }}
      />
      <KeyPoints
        frame={props.frame}
        durationInFrames={props.durationInFrames}
        width={props.width}
        height={props.height}
        subtitleSafeBottom={props.subtitleSafeBottom}
        theme={props.theme}
        fps={props.fps}
        lineTimings={props.lineTimings}
        spec={SPEC}
      />
    </AbsoluteFill>
  );
};

export default Component;
\`\`\`

## Hard rules (statically validated or design-critical)

FIDELITY TO DESCRIPTION (HIGHEST PRIORITY):
- Render ONLY the elements explicitly described. NO invented chrome: breadcrumbs, navigation rails, side panels, footer strips, step indicators, corner brackets, decorative chips that duplicate titles, or data visualizations that were not requested.
- If the description names text content, use it VERBATIM — never substitute made-up examples or content from elsewhere.
- Filling the canvas means ENLARGING the described elements, never adding unrequested ones. Subtle background treatments (faint grid/glow that does not compete with content) are allowed.

LAYOUT (applies to everything you draw yourself; library components already obey these):
- The available canvas is \`width × (height - subtitleSafeBottom)\`. Reserve the bottom \`subtitleSafeBottom\` pixels for subtitles: the ROOT container MUST be full \`height\` with \`backgroundColor: theme.colors.bg\` (no black bar), but every content element must end above \`height - subtitleSafeBottom\`.
- REQUIRED safe-bottom pattern (statically validated): declare \`const availH = height - subtitleSafeBottom;\` once, then compute EVERY vertical position, height, and stacked gap of the content cluster from \`availH\` (or \`width\`) — NEVER from raw \`height\`. Declaring \`availH\` without using it in the layout math is a HARD validation failure.
- Coverage: the bounding box of all visible elements must cover ≥ 60 % of the available area, achieved by scaling up described elements (respecting explicit sizes in the description). Outer padding ≤ min(width, height) × 0.06.
- Font floors (HARD): no visible text smaller than height × 0.028 (≈ 30 px @1080p); main title ≥ height × 0.07. The floors WIN over the description — drop secondary content rather than shrink below them. Derive every size from the width/height props; never hardcode pixel values.
- NO OVERLAPPING TEXT: stack elements sequentially — each element's y = previous element's bottom + gap ≥ height × 0.02. Sum the vertical budget (title + zones + gaps) before writing JSX; the lowest element's bottom edge must stay ≤ availH.
- HORIZONTAL BOUNDS: every text-bearing element stays fully inside [0, width]. A card centered on \`x\` spans \`x ± cardWidth/2\` — inset the first/last nodes of a horizontal row or shrink edge cards. Decorative glows may bleed off-canvas; text may not.
- Top title band: when the description pins a persistent title at the top, the strip down to titleBottom + 0.03 × height is RESERVED at every frame — relocate shrinking clusters below it explicitly. The band is a constraint only; do NOT render any overlay to "implement" it.
- Single-line labels (pills, badges, tabs) must never wrap: size the font from the LONGEST label (CJK ≈ 1em, ASCII ≈ 0.55em per char) and set whiteSpace: "nowrap".
- \`interpolate()\` inputRange must be CONSTANT frame values (literals, or values derived once from lineTimings/fps) — never a runtime progress variable, which collapses the range and throws. Guard computed ranges with Math.max(start + 1, end).

MOTION:
- Avoid the three failure modes: lockstep entrance (≥ 3 groups MUST start at different delays), dead hold (keep one subtle ambient animation alive after the entrance — a breathing accent, drifting gradient, blinking cursor), and vanishing on the last frame (stagger or ease the exit over the final ~15 % of frames).
- Use spring() for elements that should settle into place; stagger siblings (see DUR.staggerSec).
- Narration sync: \`lineTimings\` is \`{ startSec, endSec }[]\` in block-relative seconds — compare directly against \`frame / fps\`. Whenever the description implies following the voiceover (step-by-step walkthroughs, 第一/第二/第三…), drive progression from lineTimings: anchor on the LAST line whose startSec ≤ t so the highlight survives the silence gaps between lines. Never hardcode narration timestamps — they drift when the voiceover is re-synthesized. Library components already implement this; hand-rolled beats must too.

## Self-check before returning
1. FIDELITY: every visible element corresponds to the description? All text verbatim? Nothing invented?
2. Largest font ≥ height × 0.07? Smallest ≥ height × 0.028? All sizes derived from width/height props?
3. Content coverage ≥ 60 % of the available area? Margins ≤ 6 %? No overlaps, gaps ≥ height × 0.02?
4. Every element ends above availH and inside [0, width]? Persistent top title's band respected at every frame?
5. \`availH\` declared AND used in every vertical computation? Vertical budget summed and within availH?
6. ≥ 3 groups entering at DIFFERENT delays? Something still animating during the hold? An intentional exit?
7. Narration-following beats driven by props.lineTimings (last started line), not hardcoded seconds?
8. Every interpolate() inputRange constant and guarded with Math.max(start + 1, end)?`;
}

// ── Main visuals function ─────────────────────────────────────────────

export async function visuals(options: VisualsOptions): Promise<VisualsResult> {
  const { scriptPath, config, blockIds, force, verbose, dryRun, onProgress, signal } = options;
  const resolvedScriptPath = path.resolve(scriptPath);
  const buildOutDir = path.dirname(resolvedScriptPath);

  const emit = (percent: number, step: string, blockId?: string) => {
    onProgress?.({ percent, step, stage: "visuals", blockId });
  };

  emit(0, "开始视觉生成");

  // Check abort before starting
  if (signal?.aborted) throw new VisualsError("Visuals cancelled", "ERR_CANCELLED");

  // Read and validate script.json
  const scriptRaw = fs.readFileSync(resolvedScriptPath, "utf-8");
  const script: Script = JSON.parse(scriptRaw);

  // Validate basic structure (allow componentPath/audio from prior runs)
  if (!script.meta || !script.blocks || script.blocks.length === 0) {
    throw new VisualsError("Script must have meta and at least one block");
  }
  for (const block of script.blocks) {
    if (!block.id || !block.visual?.description || !block.narration?.lines) {
      throw new VisualsError(`Block ${block.id ?? "?"} is missing required fields`);
    }
  }

  // Filter blocks if --block specified
  let targetBlocks = script.blocks;
  if (blockIds && blockIds.length > 0) {
    targetBlocks = script.blocks.filter((b) => blockIds.includes(b.id));
    if (targetBlocks.length === 0) {
      throw new VisualsError(`No blocks found matching: ${blockIds.join(",")}`);
    }
  }

  // Setup directories
  const blocksDir = path.join(buildOutDir, "src", "blocks");
  fs.mkdirSync(blocksDir, { recursive: true });

  // Compute promptVersion and model. The hash covers BOTH generation channels
  // (free-form TSX prompt + JSON assembly prompt) and the shared registry
  // docs, so any prompt or registry edit invalidates the component cache.
  const registryDocs = buildRegistryDocs();
  const systemPrompt = buildDefaultSystemPrompt(registryDocs);
  const promptVersion = computePromptVersion(
    systemPrompt + buildAssemblySystemPrompt(registryDocs) + registryDocs
  );
  const claudeModel = config.anthropic.model;

  // Setup cache
  const cacheStore = new CacheStore({
    cacheDir: config.cache.dir,
    maxSizeGB: config.cache.maxSizeGB,
    evictTrigger: config.cache.evictTrigger,
  });

  // Agent config for generateComponent (animation mode)
  const anthropicConfig: AnthropicConfig = {
    provider: config.anthropic.provider,
    model: config.anthropic.model,
    maxRetries: config.anthropic.maxRetries,
    baseURL: config.anthropic.baseURL,
    apiKey: config.anthropic.apiKey,
    useCLI: config.anthropic.useCLI,
    cliPath: config.anthropic.cliPath,
    cliTimeoutMs: config.anthropic.cliTimeoutMs,
    thinking: config.anthropic.thinking,
  };

  // Visual review may use a different agent (e.g. generation on deepseek-chat,
  // which has no vision, review on a multimodal model). Unset override fields
  // fall back to the generation config.
  const reviewOverrides = Object.fromEntries(
    Object.entries(config.anthropic.review ?? {}).filter(
      ([, v]) => v !== undefined && v !== ""
    )
  );
  const reviewAgentConfig: AnthropicConfig = { ...anthropicConfig, ...reviewOverrides };

  if (dryRun) {
    console.log(
      `[dry-run] Would process ${targetBlocks.length} block(s): ${targetBlocks.map((b) => b.id).join(", ")}`
    );
    emit(100, "Dry run 完成");
    return { script, cacheHits: 0, apiCalls: 0 };
  }

  emit(5, `准备处理 ${targetBlocks.length} 个块`);

  // AbortController for cancellation on failure
  const abortController = new AbortController();
  // Forward external signal cancellation to internal abort controller
  if (signal) {
    if (signal.aborted) {
      abortController.abort(signal.reason);
      throw new VisualsError("Visuals cancelled", "ERR_CANCELLED");
    }
    signal.addEventListener("abort", () => abortController.abort(signal.reason), { once: true });
  }
  let hasFailed = false;
  const failedBlocks: { id: string; error: string }[] = [];
  let cacheHits = 0;
  let apiCalls = 0;

  // Sync the Remotion runtime (engine files + component library) into the
  // build dir so validation-time renderStill can resolve ../../../remotion/library.
  syncRemotionRuntime(buildOutDir, { logPrefix: "[visuals]" });

  const concurrency = Math.max(config.anthropic.concurrency, config.imageGen.concurrency);
  const limit = pLimit(concurrency);

  // Process each block concurrently — branch by visualMode
  const tasks = targetBlocks.map((block) =>
    limit(async () => {
      if (hasFailed || abortController.signal.aborted) return;

      const blockLabel = block.id;

      // ── Video mode: already set up by compile, skip ──────────────────
      if (block.visualMode === 'video') {
        console.log(`  Block ${blockLabel}: local video already set up by compile`);
        return;
      }

      // ── Html mode: already set up by compile, skip ──────────────────
      if (block.visualMode === 'html') {
        console.log(`  Block ${blockLabel}: local html already set up by compile`);
        return;
      }

      // ── Image mode: local file or API generation ─────────────────────
      if (block.visualMode === 'image') {
        console.log(`Processing block ${blockLabel} (image mode)...`);

        try {
          if (block.imageSource) {
            // Local image: if compile already set up (imagePath + componentPath), skip
            if (block.visual.imagePath && block.visual.componentPath) {
              console.log(`  Block ${blockLabel}: local image already set up by compile`);
            } else {
              await generateLocalImage(block, { buildOutDir });
              console.log(`  Block ${blockLabel}: local image copied`);
            }
          } else {
            // Call image generation API
            const result = await generateImage(block, {
              config: {
                provider: config.imageGen.provider,
                baseURL: config.imageGen.baseURL,
                apiKey: config.imageGen.apiKey,
                model: config.imageGen.model,
                size: config.imageGen.size,
                timeoutMs: config.imageGen.timeoutMs,
                concurrency: config.imageGen.concurrency,
                numSteps: config.imageGen.numSteps,
                cfgScale: config.imageGen.cfgScale,
              },
              buildOutDir,
              meta: { aspect: script.meta.aspect, width: script.meta.width, height: script.meta.height },
              cacheStore,
              force,
              signal: abortController.signal,
              onProgress,
            });
            if (result.cacheHit) { cacheHits++; }
            else { apiCalls++; }
          }

          console.log(`  Block ${blockLabel}: image done`);
        } catch (err: any) {
          const errMsg = err?.message ?? String(err);
          console.error(`✗ Block ${blockLabel}: image generation failed: ${errMsg.slice(0, 200)}`);
          failedBlocks.push({ id: block.id, error: errMsg });
          hasFailed = true;
          abortController.abort();
          return;
        }

        return;
      }

      // ── Animation mode: existing Claude generation path ──────────────
      console.log(`Processing block ${blockLabel}...`);

      // Real timeline for this block (mirrors render-stage timing) — drives
      // the narration context, the review-still duration, and frame sampling.
      const { totalSec, narrationLineSecs } = blockTimingContext(block, config);
      const lineTimingsSec = narrationLineSecs.map(({ startSec, endSec }) => ({
        startSec,
        endSec,
      }));

      const componentDir = path.join(blocksDir, block.id);
      const componentFile = path.join(componentDir, "Component.tsx");
      const relativeComponentPath = `src/blocks/${block.id}/Component.tsx`;

      // Compute cache key
      const assetHashes = getAssetHashesForBlock(block, script);
      const componentKey = buildComponentKey({
        description: block.visual.description,
        theme: script.meta.theme,
        width: script.meta.width,
        height: script.meta.height,
        promptVersion,
        assetHashes,
        claudeModel,
        subtitleSafeBottom: script.meta.subtitleSafeBottom,
      });

      // Check cache (unless --force for this block)
      let cacheHit = false;
      if (!force) {
        const cachedPath = await cacheStore.get("component", componentKey);
        if (cachedPath) {
          if (verbose) {
            console.log(`  Block ${blockLabel}: cache hit`);
          }
          // Copy from cache to component file
          fs.mkdirSync(componentDir, { recursive: true });
          fs.copyFileSync(cachedPath, componentFile);
          cacheHit = true;
          cacheHits++;
        }
      }

      if (!cacheHit) {
        // Cache miss → generate with Claude
        let componentSource = "";
        let previousError: string | null = null;
        let succeeded = false;
        // Visual-quality feedback loop (plan A: metrics; plan B: review)
        const vq = config.visualQuality ?? DEFAULT_VISUAL_QUALITY;
        let reviewRounds = 0;

        // ── Generation channel state machine ─────────────────────────────
        // assembly:"first" starts in assemble mode (LLM emits a JSON spec →
        // mechanical wrapper); a `component: null` fallback or
        // MAX_ASSEMBLY_FAILURES consecutive assembly failures switch to
        // freegen (free TSX) inside the SAME retry loop — the terminal
        // abort branch is untouched. The switch is one-way.
        let mode: "assemble" | "freegen" =
          (vq.assembly ?? "first") === "off" ? "freegen" : "assemble";
        let assembleFailures = 0;
        // Previous artifacts are tracked per channel: the orchestrator gets
        // its JSON back, the free generator gets its TSX back. Keeping them
        // separate guarantees an empty componentSource (zod/JSON parse
        // failure) is never fed into a retryContext.
        let previousJson: string | null = null;
        let previousTsx: string | null = null;
        // Which channel produced the latest failure — freegen error feedback
        // must only fire for freegen failures (an assembly error must not
        // leak into the first freegen retryContext after a fallback switch).
        let lastFailureChannel: "assemble" | "freegen" | null = null;

        // Failure feedback is phrased per channel: the metrics/review copy
        // is written for free generation ("rewrite the component"), which
        // contradicts the orchestrator's JSON-only output channel — assembly
        // failures are rephrased as "adjust the spec / pick another
        // component". Freegen messages stay byte-identical to before.
        const failAttempt = (msg: string): never => {
          throw new VisualsError(
            mode === "assemble"
              ? [
                  "Assembly attempt failed — the generated wrapper (library component + your JSON spec) did not pass validation:",
                  msg,
                  `You cannot edit code. Fix this by adjusting the JSON spec (reword or shorten text, change item counts/values) or pick a different registered component. If no component can satisfy this description, return {"component": null, "reason": "…"}.`,
                ].join("\n")
              : msg
          );
        };

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (hasFailed || abortController.signal.aborted) return;

          try {
            // Reset per-attempt source so a throwing generation call can
            // never leak a stale artifact into the retry bookkeeping below.
            componentSource = "";

            if (verbose) {
              console.log(
                mode === "assemble"
                  ? `  Block ${blockLabel}: assembling from component library (attempt ${attempt + 1})...`
                  : `  Block ${blockLabel}: generating component (attempt ${attempt + 1})...`
              );
            }

            const narrationContext = buildNarrationContext(block, narrationLineSecs);

            if (mode === "assemble") {
              // Channel ①: JSON assembly — the model picks a prefab
              // component and fills its spec; the wrapper is mechanical.
              const assemblyInput: AssemblyGenInput = {
                visualDescription: block.visual.description,
                narrationContext,
                registryDocs,
              };
              if (previousError !== null) {
                assemblyInput.retryContext = {
                  // When the previous attempt never produced parseable JSON
                  // (generateAssembly threw), there is no artifact to show —
                  // say so instead of feeding back an empty string or TSX.
                  previousJson:
                    previousJson ??
                    "(previous response was not valid assembly JSON — see the error)",
                  errorMessage: previousError,
                };
              }

              const assembly = await generateAssembly(
                assemblyInput,
                anthropicConfig,
                abortController.signal
              );
              apiCalls++;

              if (assembly.kind === "fallback") {
                // The model declared no library component fits — switch to
                // free generation immediately, inside this same attempt.
                // Not a failure: no error feedback, no failure count.
                if (verbose) {
                  console.log(
                    `  Block ${blockLabel}: no library component fits (${assembly.reason}) — falling back to free generation`
                  );
                }
                mode = "freegen";
              } else {
                previousJson = JSON.stringify({
                  component: assembly.component,
                  props: assembly.props,
                });
                componentSource = buildAssemblyWrapper(
                  assembly.component,
                  assembly.props
                );
              }
            }

            if (mode === "freegen") {
              // Channel ②: free TSX generation (also the fallback channel).
              const input: ComponentGenInput = {
                visualDescription: block.visual.description,
                systemPrompt,
                narrationContext,
              };

              // On retry, feed back previous source + error. previousTsx is
              // only set by a failed freegen attempt that actually produced
              // source, so an empty string never reaches the retryContext.
              if (previousTsx !== null) {
                input.retryContext = {
                  previousTsx,
                  errorMessage: previousError ?? "",
                };
              } else if (
                previousError !== null &&
                lastFailureChannel === "freegen"
              ) {
                // generateComponent itself threw (empty/unparseable
                // response): no TSX to show, but the error must still be fed
                // back or the model retries blind. Placeholder stands in for
                // the missing artifact (legacy fed an empty string).
                input.retryContext = {
                  previousTsx:
                    "(previous generation produced no component source — see the error)",
                  errorMessage: previousError,
                };
              }

              const result: ComponentGenResult = await generateComponent(
                input,
                anthropicConfig,
                abortController.signal
              );
              componentSource = result.tsx;
              apiCalls++;
            }

            // Write component to disk for validation
            fs.mkdirSync(componentDir, { recursive: true });
            fs.writeFileSync(componentFile, componentSource, "utf-8");

            // Validate: AST scan + tsc type-check + optional render smoke
            const validateOpts: ValidateComponentOptions = {
              buildOutDir,
              fps: script.meta.fps,
              width: script.meta.width,
              height: script.meta.height,
              // Disable render smoke (requires full Remotion setup)
              runRenderSmoke: false,
            };

            const validation = await validateComponent(
              componentFile,
              validateOpts
            );

            if (!validation.pass) {
              failAttempt(
                `Validation failed: ${validation.errors.filter((e) => e.trim()).join(" | ")}`
              );
            }

            // ── Visual-quality gate (soft) ───────────────────────────────
            // Correctness passed. Render a still once and check deterministic
            // metrics (plan A). A miss feeds actionable feedback into the next
            // retry; on the final attempt we accept the best-effort component
            // rather than failing the whole block.
            const isLastAttempt = attempt === MAX_RETRIES - 1;
            if (vq.enabled && !isLastAttempt) {
              // Narration-sync contract (static, free): a description that
              // declares narration-following intent must yield a component
              // that reads props.lineTimings — catch hardcoded beats here,
              // before spending a still render.
              const syncCheck = checkNarrationSyncContract(
                block.visual.description,
                componentSource
              );
              if (!syncCheck.pass) {
                failAttempt(syncCheck.feedback);
              }

              // Frames sampled at narration-line midpoints (plus entrance and
              // near-exit) so the multimodal review sees the visual emphasis
              // per narrated item, not just three arbitrary points in time.
              // The second frame doubles as the still that the deterministic
              // coverage/edge metrics use.
              const frameTimesSec = pickReviewFrameTimes(
                narrationLineSecs,
                totalSec
              );
              const still = await renderComponentStill(componentFile, {
                buildOutDir,
                width: script.meta.width,
                height: script.meta.height,
                fps: script.meta.fps,
                durationSec: totalSec,
                frameFractions: frameTimesSec.map((t) => t / totalSec),
                lineTimings: lineTimingsSec,
                subtitleSafeBottom: script.meta.subtitleSafeBottom,
              });
              // A render failure is either the component's fault (NaN /
              // TypeError / interpolate·spring misuse — fail and feed the
              // error back for a retry) or an environment problem (broken
              // headless Chrome / bundle timeout — soft-skipped so a flaky
              // environment can't disable the whole gate). Clean up the temp
              // still dir before throwing: this branch sits outside the
              // try/finally below, so without this the temp dir would leak.
              if (!still.ok && classifyRenderError(still.error ?? "") === "component") {
                cleanupStill(still.tempDir);
                failAttempt(
                  `渲染首帧失败（组件代码错误）：${still.error ?? "unknown"}。` +
                    `常见原因：误读 lineTimings 的 .start/.end（应为 .startSec/.endSec，` +
                    `会导致 interpolate(NaN)）、除零、对 undefined 做算术——请检查 frame 相关算式。`,
                );
              }
              const framePaths = still.ok ? still.pngPaths ?? [] : [];
              const pngPath = framePaths[1] ?? framePaths[0];
              if (!pngPath && verbose) {
                console.log(
                  `  Block ${blockLabel}: visual still render skipped (${still.error ?? "unknown"}) — static metrics only`
                );
              }
              try {
                // Static metrics (font sizes, element count) do not need the
                // still, so they run even when the render failed — a broken
                // headless Chrome must not silently disable the whole gate.
                // Assembly mode skips them: the machine-generated wrapper is
                // a thin forwarder that single-file source analysis always
                // misfires on (elementCount etc.); the rendered-PNG coverage
                // metrics and the review below still run.
                const metrics = await assessVisualMetrics({
                  tsxPath: componentFile,
                  pngPath,
                  width: script.meta.width,
                  height: script.meta.height,
                  thresholds: {
                    minFontCoeff: vq.minFontCoeff,
                    minAnyFontCoeff: vq.minAnyFontCoeff,
                    minElements: vq.minElements,
                    minCoverage: vq.minCoverage,
                    maxCoverage: vq.maxCoverage,
                  },
                  safeBottom: script.meta.subtitleSafeBottom,
                  skipStaticMetrics: mode === "assemble",
                });
                if (!metrics.pass) {
                  if (verbose) {
                    console.log(
                      `  Block ${blockLabel}: visual metrics below threshold (coverage ${
                        metrics.image ? Math.round(metrics.image.coverage * 100) : "n/a"
                      }${
                        mode === "assemble"
                          ? ""
                          : `, font ${Math.round(metrics.static.minFontPx)}–${Math.round(
                              metrics.static.maxFontPx
                            )}px, elements ${metrics.static.elementCount}`
                      }) — regenerating`
                    );
                  }
                  failAttempt(metrics.feedback);
                }

                // Plan B: multimodal review (only after metrics pass, capped
                // by maxReviewRounds to bound cost/time). Feeding all sampled
                // frames lets it judge motion across time, not just one still.
                if (framePaths.length > 0 && vq.review && reviewRounds < vq.maxReviewRounds) {
                  const review = await reviewVisual(
                    {
                      pngPaths: framePaths,
                      visualDescription: block.visual.description,
                      frameTimesSec,
                      narrationLines: narrationLineSecs,
                    },
                    reviewAgentConfig,
                    abortController.signal
                  );
                  if (!review.pass) {
                    reviewRounds++;
                    if (verbose) {
                      console.log(
                        `  Block ${blockLabel}: visual review requested changes (round ${reviewRounds}/${vq.maxReviewRounds}) — regenerating`
                      );
                    }
                    failAttempt(review.feedback);
                  }
                }
              } finally {
                cleanupStill(still.tempDir);
              }
            }

            // Validation passed!
            succeeded = true;
            if (verbose) {
              console.log(
                `  Block ${blockLabel}: validation passed on attempt ${attempt + 1}`
              );
            }
            // Cooldown to stay within Claude Code OAuth rate limits
            if (verbose) {
              console.log(
                `  Block ${blockLabel}: waiting ${POST_REQUEST_DELAY_MS / 1000}s cooldown...`
              );
            }
            await sleep(POST_REQUEST_DELAY_MS);
            break;
          } catch (err: any) {
            const errMsg = err?.message ?? String(err);
            lastFailureChannel = mode;
            if (mode === "assemble") {
              // Assembly failure — thrown by generateAssembly itself (bad
              // JSON / registry validation) or by a downstream gate
              // (AST/tsc, render smoke, metrics, review). Both count the
              // same: the wrapper is machine-generated, so a downstream
              // failure signals registry/schema drift or a bad spec, and
              // the orchestrator gets another shot at the JSON. After
              // MAX_ASSEMBLY_FAILURES consecutive failures switch to free
              // generation; the loop itself continues unchanged.
              assembleFailures++;
              if (assembleFailures >= MAX_ASSEMBLY_FAILURES) {
                mode = "freegen";
                console.log(
                  `  Block ${blockLabel}: assembly failed ${assembleFailures}× in a row — falling back to free generation`
                );
              }
            } else if (componentSource) {
              // Freegen channel: keep the TSX that just failed for the next
              // retryContext. Guarded — an empty source (generation threw
              // before producing TSX) must never be fed back.
              previousTsx = componentSource;
            }
            previousError = errMsg;

            if (verbose) {
              console.error(
                `  Block ${blockLabel}: attempt ${attempt + 1} failed: ${errMsg.slice(0, 200)}`
              );
            }

            if (attempt === MAX_RETRIES - 1) {
              // All attempts exhausted → fail
              console.error(
                `✗ Block ${blockLabel}: failed after ${MAX_RETRIES} attempts`
              );
              failedBlocks.push({ id: block.id, error: errMsg });
              hasFailed = true;
              abortController.abort();
              return;
            }

            // Exponential backoff on rate-limit errors; small fixed delay otherwise
            const delayMs = is429(err)
              ? RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
              : 2_000;
            if (verbose) {
              console.log(
                `  Block ${blockLabel}: waiting ${delayMs / 1000}s before retry...`
              );
            }
            await sleep(delayMs);
          }
        }

        if (!succeeded) {
          // Should not reach here, but guard
          failedBlocks.push({
            id: block.id,
            error: previousError ?? "No component generated",
          });
          hasFailed = true;
          abortController.abort();
          return;
        }

        // Put component in cache
        await cacheStore.put("component", componentKey, componentFile, {
          ...componentKey,
        });
      }

      // Update script: set componentPath
      const blockInScript = script.blocks.find((b) => b.id === block.id);
      if (blockInScript) {
        blockInScript.visual.componentPath = relativeComponentPath;
      }

      console.log(`  Block ${blockLabel}: done`);
    })
  );

  await Promise.all(tasks);

  // Write updated script.json
  script.artifacts = script.artifacts || {};
  if (failedBlocks.length === 0) {
    script.artifacts.visualsGeneratedAt = new Date().toISOString();
  }
  fs.writeFileSync(resolvedScriptPath, JSON.stringify(script, null, 2));

  // If any blocks failed, throw error with recovery instructions
  if (failedBlocks.length > 0) {
    const msg = [
      `Visuals failed (${failedBlocks.length} block(s) failed)`,
      "",
      "Failed blocks:",
      ...failedBlocks.map((fb) => `  ${fb.id}: ${fb.error.split("\n").slice(0, 3).join(" | ")}`),
      "",
      "Resume after fixing the issue:",
      `  autovideo visuals ${scriptPath} --block ${failedBlocks.map((b) => b.id).join(",")} --force`,
    ].join("\n");
    throw new VisualsError(msg, "ERR_VISUALS_BLOCK_FAILED");
  }

  console.log(
    `\n✓ Visuals complete: ${targetBlocks.length} block(s) processed (${cacheHits} cache hits, ${apiCalls} API calls)`
  );

  emit(100, "视觉生成完成");

  return { script, cacheHits, apiCalls };
}
