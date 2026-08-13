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
 * Cache-key component derived from the system prompt.
 *
 * Hash the prompt we actually send. An earlier version hashed a prompt file
 * that was never shipped, so the fallback constant made every prompt edit a
 * no-op for cached blocks.
 */
function computePromptVersion(systemPrompt: string): string {
  return crypto.createHash("md5").update(systemPrompt).digest("hex").slice(0, 8);
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
 * Build a default system prompt for component generation.
 * In production this would come from src/ai/prompts/component.md.
 */
function buildDefaultSystemPrompt(): string {
  return `You are a React component generator for educational video slides shown FULLSCREEN to viewers.

Generate a single React component that renders a full-screen visual based on the user's description.

## Technical contract

- Export a default function component
- Accept AnimationProps: { frame, durationInFrames, width, height, subtitleSafeBottom, theme, fps, lineTimings }
- Only import from "react" and "remotion"
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

## Layout rules (CRITICAL — viewers complain when slides feel empty OR cluttered)

The available canvas is \`width × (height - subtitleSafeBottom)\`. **Fill the area generously but NEVER at the cost of readability.**

### FIDELITY TO DESCRIPTION (HIGHEST PRIORITY)

- **Render ONLY the elements explicitly described in the user's visual description.** Do NOT invent, add, or hallucinate UI chrome that is not mentioned: NO breadcrumbs, NO navigation rails, NO side panels, NO footer strips, NO step indicators, NO corner brackets, NO decorative chips/labels that duplicate card titles, and NO data visualizations (charts, graphs, attention heatmaps, probability bars) unless explicitly requested.
- If the description mentions specific text content (titles, labels, numbers), use THAT text verbatim. Do NOT substitute example content from other blocks or made-up examples.
- "Scale up to fill the canvas" means ENLARGE the described elements (bigger titles, bigger cards, bigger fonts) — it does NOT mean adding new unrequested elements. If you need to fill space, make described elements larger; do not add decorations.
- Subtle background treatments (solid/dark background, very faint grid or glow that does NOT compete with content) are allowed as long as they don't add visible UI elements.

### Padding & content area

- Outer padding around the content cluster: AT MOST \`min(width, height) * 0.06\` (≈ 65 px on 1080p). NEVER use larger margins like 100 px or 10 % of the canvas — that produces dead space.
- The bounding box of all visible elements (titles, cards, code blocks, etc.) MUST cover at least **70 % of the available canvas area**. Sparse single-element layouts that float in the middle of a huge empty canvas are BANNED.
- Achieve 70% coverage by SCALING UP described elements, not by adding new ones. Make titles bigger, cards wider/taller, fonts larger.

### Font sizes (assume 1080p; scale proportionally if width/height differ)

These are HARD FLOORS. **No visible text may be smaller than \`height * 0.028\` (≈ 30 px on 1080p)** — the video is watched on phones, where anything below that is illegible.

| Element | Min font-size | Suggested |
|---|---|---|
| Hero / main title | \`height * 0.07\` (≈ 76 px) | \`height * 0.09\` (≈ 96 px) |
| Section title | \`height * 0.045\` (≈ 50 px) | \`height * 0.055\` (≈ 60 px) |
| Body text / list item | \`height * 0.030\` (≈ 32 px) | \`height * 0.036\` (≈ 39 px) |
| Caption / label | \`height * 0.028\` (≈ 30 px) | \`height * 0.032\` (≈ 35 px) |
| Code block (mono) | \`height * 0.028\` (≈ 30 px) | \`height * 0.032\` (≈ 35 px) |

The floors WIN over the description. If the description names a specific pixel size (\`18px\`, \`24px\`, "small caption"), treat it as a relative hint about hierarchy, not an absolute value: keep the ordering it implies but raise every size until the smallest one clears the floor. Never emit a smaller size just because the description asked for it.

If enforcing the floors makes the content overflow, **remove content** — drop secondary annotations, shorten labels, split into fewer items. Do not shrink text to fit.

Compute all font sizes from \`width\` / \`height\` props (e.g. \`fontSize: height * 0.07\`) so they scale across aspect ratios. Do NOT hardcode pixel values.

### Composition rules

- Center primary content both horizontally and vertically within the available area, OR use a clear grid (2-col, 3-col, header+body) that spans nearly the full width.
- When showing multiple items (lists, cards, steps): lay them out as a row or grid that occupies ≥ 80 % of the canvas width with generous internal spacing between items, instead of stacking them in a narrow column in the middle.
- For code/terminal blocks: the block container should occupy at least 70 % of the canvas width and 50 % of the available height.
- Reserve the bottom \`subtitleSafeBottom\` pixels — subtitles are drawn there and will cover anything you put underneath. Nothing visible may extend below \`height - subtitleSafeBottom\`. **The root container MUST be full \`height\`** with \`backgroundColor: theme.colors.bg\` filling the entire canvas — do NOT set the container height to \`height - subtitleSafeBottom\` or you will create an ugly black bar at the bottom. Instead, constrain only the *content elements* (titles, cards, code blocks, etc.) to the \`height - subtitleSafeBottom\` area by computing their positions from \`availableHeight = height - subtitleSafeBottom\`. Background fills, decorations, and gradients should span the full \`height\`.
- **NO OVERLAPPING TEXT (CRITICAL):** Calculate vertical positions so that no two text elements overlap. When stacking elements vertically (title → card1 → card2 → card3), compute each element's y position based on the PREVIOUS element's bottom edge PLUS a gap. Do NOT position elements independently with hardcoded fractions that may collide. Example pattern:
  \`\`\`tsx
  const titleH = titleSize * 1.2; // lineHeight accounted for
  const titleY = pad;
  const gap = height * 0.02;
  const card1Y = titleY + titleH + gap;
  const card1H = height * 0.15;
  const card2Y = card1Y + card1H + gap;
  // ... etc
  \`\`\`
- **BREATHING ROOM (CRITICAL):** The gap between any two adjacent elements MUST be at least \`height * 0.02\` (≈ 22px on 1080p). Do NOT pack elements edge-to-edge — viewers need visual rest between items. If the described elements cannot all fit with this minimum gap AND the font-size floors, REMOVE the least important elements. A slide with 3 well-spaced items is better than 6 cramped ones.
- If elements don't all fit with the font-size floors, REMOVE the least important elements or reduce their count. Do NOT shrink fonts below the floors, and do NOT cram overlapping elements.
- After laying out, verify that the bottom of the lowest element is at or above \`height - subtitleSafeBottom\`. If it overflows, remove content or reduce spacing.
- **HORIZONTAL BOUNDS (CRITICAL):** Every visible element MUST stay within \`[0, width]\`. When using \`transform: translate(-50%, ...)\` to center an element on a position \`x\`, the element's left edge is \`x - elementWidth / 2\` and right edge is \`x + elementWidth / 2\` — both MUST be within \`[0, width]\`. This is especially important for:
  - Cards/labels centered on timeline nodes at the extreme ends: if the first node is near \`x = pad\`, the card centered on it will overflow left; if the last node is near \`x = width - pad\`, the card will overflow right.
  - Fix by either: (a) insetting the first/last node positions so \`nodeX(0) - cardW/2 >= 0\` and \`nodeX(last) + cardW/2 <= width\`, or (b) reducing card width, or (c) shifting edge cards inward while keeping their connector lines to the original node position.
  - Decorative glows/blurs that intentionally extend beyond the canvas are fine (they have no readable content and are clipped by the viewport), but text-bearing elements (cards, labels, badges, titles) MUST be fully on-screen.

## Motion design (CRITICAL — this is reviewed separately from layout)

A slide with great layout but flat motion still reads as cheap. \`frame\`, \`durationInFrames\`, and \`fps\` are given precisely so you choreograph the whole timeline, not just an entrance fade.

### The three failure modes to avoid

1. **Lockstep entrance** — every element fades/slides in with the exact same start frame and duration. It reads as one flat cut, not a composition. BANNED.
2. **Dead hold** — everything finishes animating by frame ~20 and then nothing moves for the remaining 3-4 seconds. The slide looks like a static screenshot with a video file's runtime. BANNED.
3. **Abrupt exit** — elements just disappear on the last frame instead of leaving with intent.

### Required pattern: staggered entrance

Give each visual group its own delay so they arrive in a deliberate sequence (title → supporting elements → decoration), each with its own short easing curve:

\`\`\`tsx
const frame = useCurrentFrame();

// delayFrames: when this element starts; durationFrames: how long its own
// entrance takes. Stagger delayFrames across groups — do NOT reuse the same
// value for everything.
const enterProgress = (delayFrames: number, durationFrames = 14) =>
  interpolate(frame - delayFrames, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

const titleP = enterProgress(0);         // arrives first
const subtitleP = enterProgress(8);      // 8 frames later
const card1P = enterProgress(16);
const card2P = enterProgress(22);        // cards themselves stagger too
\`\`\`

Use \`spring({ frame: frame - delayFrames, fps, config: { damping: 200 } })\` instead of \`interpolate\` for elements that should feel like they settle into place (cards, badges, the hero title) rather than just fade.

### Required pattern: keep something alive during the hold

After the entrance finishes, at least one element must keep animating for the rest of the block — a slow pulse on an accent, a subtly drifting background gradient, a blinking cursor, a counter ticking up, a progress bar filling, a line being drawn. Base it on \`frame\` directly (not gated by the entrance), e.g. \`Math.sin(frame / 20) * 4\` for a gentle breathing offset. Keep it subtle enough not to compete with body text for attention.

### Exit

Reverse the stagger for the exit (last-in-first-out, or fade the whole group together over the final \`durationInFrames * 0.15\` frames) rather than letting elements vanish on the final frame. Use \`Easing.in(Easing.cubic)\` — accelerating away reads as intentional, linear reads as a glitch.

### Syncing to narration (lineTimings)

\`lineTimings\` is \`{ startSec: number; endSec: number }[]\` — one entry per narration line, in **block-relative seconds** (the enter animation is already accounted for, so compare directly against \`frame / fps\`). Whenever the description implies the visual should follow the voiceover — step-by-step walkthroughs, "第一…第二…第三…", items introduced one by one — drive the progression from \`lineTimings\`:

\`\`\`tsx
const t = frame / fps;
// Last line whose start has passed. There are ~0.2s silence gaps BETWEEN
// lines — a findIndex(t >= start && t < end) lookup returns -1 inside every
// gap and the highlight visibly blinks off between items. Anchoring on the
// last started line keeps the previous item highlighted through each gap.
let activeLine = -1;
for (let i = 0; i < lineTimings.length; i++) {
  if (t >= lineTimings[i].startSec) activeLine = i;
  else break;
}
// e.g. highlight item (activeLine - 1) when line 0 is the intro
\`\`\`

Beats driven by \`lineTimings\` stay in sync even when the voiceover is re-synthesized with different pacing. Absolute timestamps copied from the description ("highlight at 4.5s") silently drift out of sync the moment the TTS duration changes — use them only for purely visual beats (entrance staggers, ambient loops), never for something the narrator says.

### Self-check before returning

Before emitting code, mentally verify:
1. **FIDELITY**: Does every visible element correspond to something in the user's description? If I added breadcrumbs, side rails, extra panels, or data viz not mentioned, DELETE THEM.
2. **TEXT FIDELITY**: Are all labels/titles/numbers exactly as described? No invented example text, no content from other blocks.
3. Is the largest font size ≥ \`height * 0.07\`? If not, increase it.
4. Is the SMALLEST font size ≥ \`height * 0.028\`? If not, raise it — or delete that text.
5. Does the content cluster cover ≥ 70 % of the canvas area? If not, ENLARGE described elements (bigger titles, bigger cards) — do NOT add new elements.
6. **NO OVERLAP**: Do any two text elements overlap vertically? If title bottom + gap < next element top, fix positions. Stack elements sequentially: each element's y = previous element's bottom + gap.
7. **BREATHING ROOM**: Is the gap between every pair of adjacent elements at least \`height * 0.02\`? If not, increase spacing or remove elements. The slide should feel spacious, not crammed.
8. Are outer margins ≤ 6 % of the smaller canvas dimension? If not, reduce them.
9. Does every visible element end above \`height - subtitleSafeBottom\`? If not, remove less important content.
10. **HORIZONTAL BOUNDS**: For every text-bearing element with \`translate(-50%, ...)\` or centered positioning, verify \`left edge >= 0\` and \`right edge <= width\`. Pay special attention to cards/labels centered on the first or last item of a horizontal sequence — they are the most common overflow source. If they overflow, inset the node positions or shrink the card width.
11. Did I compute sizes from \`width\` / \`height\` props rather than hardcoding pixel values? If not, refactor.
12. Do at least 3 elements/groups start their entrance at DIFFERENT frame offsets? If everything shares one delay, restagger.
13. Is something still visibly animating past frame ~40 (well after entrance completes)? If the frame is static during the hold, add subtle ambient motion to existing elements (pulse, glow) — do NOT add new elements.
14. Does anything just vanish on the last frame instead of exiting with its own animation? If so, add a staggered/eased exit.
15. If the description walks through items verbally (第一/第二/第三…, step 1/2/3…), does the highlight/progression follow \`lineTimings\` rather than a hardcoded timestamp? If not, rewire it.`;
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

  // Compute promptVersion and model
  const systemPrompt = buildDefaultSystemPrompt();
  const promptVersion = computePromptVersion(systemPrompt);
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
        let previousSource: string | null = null;
        let previousError: string | null = null;
        let succeeded = false;
        // Visual-quality feedback loop (plan A: metrics; plan B: review)
        const vq = config.visualQuality ?? DEFAULT_VISUAL_QUALITY;
        let reviewRounds = 0;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (hasFailed || abortController.signal.aborted) return;

          try {
            if (verbose) {
              console.log(
                `  Block ${blockLabel}: generating component (attempt ${attempt + 1})...`
              );
            }

            // Build input for generation
            const input: ComponentGenInput = {
              visualDescription: block.visual.description,
              systemPrompt,
              narrationContext: buildNarrationContext(block, narrationLineSecs),
            };

            // On retry, feed back previous source + error
            if (attempt > 0 && previousSource !== null) {
              input.retryContext = {
                previousTsx: previousSource,
                errorMessage: previousError ?? "",
              };
            }

            const result: ComponentGenResult = await generateComponent(
              input,
              anthropicConfig,
              abortController.signal
            );
            componentSource = result.tsx;
            apiCalls++;

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
              throw new VisualsError(
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
                throw new VisualsError(syncCheck.feedback);
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
                throw new VisualsError(
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
                });
                if (!metrics.pass) {
                  if (verbose) {
                    console.log(
                      `  Block ${blockLabel}: visual metrics below threshold (coverage ${
                        metrics.image ? Math.round(metrics.image.coverage * 100) : "n/a"
                      }, font ${Math.round(metrics.static.minFontPx)}–${Math.round(
                        metrics.static.maxFontPx
                      )}px, elements ${metrics.static.elementCount}) — regenerating`
                    );
                  }
                  throw new VisualsError(metrics.feedback);
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
                    throw new VisualsError(review.feedback);
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
            previousSource = componentSource;
            previousError = errMsg;

            if (verbose) {
              console.error(
                `  Block ${blockLabel}: attempt ${attempt + 1} failed: ${errMsg.slice(0, 200)}`
              );
            }

            if (attempt === MAX_RETRIES - 1) {
              // 3 attempts exhausted → fail
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
