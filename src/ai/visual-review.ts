/**
 * Multimodal visual review (plan B).
 *
 * After the deterministic metrics (plan A) pass, optionally ask a multimodal
 * model to look at the rendered frame(s) and critique them like a design
 * reviewer. The model only judges images and returns structured JSON — it
 * never writes code. Its suggestions are folded back into the generator's
 * retryContext to drive a quality-focused regeneration.
 *
 * Passing several frames sampled across the block's timeline (rather than one
 * mid-frame still) lets this catch motion problems a single image cannot show:
 * everything animating in lockstep, nothing moving during the hold, elements
 * that just vanish on exit. With one frame it falls back to a composition-only
 * review.
 *
 * Transport (CLI vs SDK) and credential resolution are handled by the
 * AgentDriver layer (src/ai/agent/). This module owns the review prompts,
 * frame captions, and verdict parsing.
 */

import { createAgentDriver } from "./agent/index.js";

export interface VisualReviewConfig {
  useCLI?: boolean;
  cliPath?: string;
  // SDK mode credentials/model:
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxRetries?: number;
}

export interface VisualReviewResult {
  /** true → slide looks rich/well-composed; false → needs another pass */
  pass: boolean;
  /** Actionable feedback for the generator (empty when pass === true) */
  feedback: string;
  /** Raw model output, for logging/debugging */
  raw?: string;
}

/** A narration line with its block-relative timing, for sync-aware review. */
export interface NarrationLineSec {
  text: string;
  startSec: number;
  endSec: number;
}

export interface VisualReviewInput {
  /**
   * Absolute paths to rendered frames, in timeline order (earliest first).
   * Pass several frames spread across the block's duration — a single still
   * can judge composition but says nothing about motion. A single-entry
   * array falls back to a composition-only review.
   */
  pngPaths: string[];
  /** The intended visual description for this slide */
  visualDescription: string;
  /**
   * Block-relative time (seconds) of each frame, same order as pngPaths.
   * Combined with narrationLines this lets the reviewer check whether the
   * visual emphasis matches what the narrator is saying in each frame.
   */
  frameTimesSec?: number[];
  /** Narration lines with block-relative timings — enables the sync review. */
  narrationLines?: NarrationLineSec[];
}

/**
 * Which narration line is being spoken at time t — the last line whose start
 * has passed, so inter-line silence gaps attribute to the previous line
 * (mirroring how components are told to resolve lineTimings).
 */
export function narrationLineAt(
  lines: NarrationLineSec[] | undefined,
  t: number,
): { index: number; text: string } | undefined {
  if (!lines || lines.length === 0) return undefined;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (t >= lines[i].startSec) active = i;
    else break;
  }
  if (active < 0) return undefined;
  return { index: active, text: lines[active].text };
}

/** Caption preceding frame i: timeline position + what the narrator says then. */
export function frameCaption(
  index: number,
  total: number,
  timeSec: number | undefined,
  narrationLines: NarrationLineSec[] | undefined,
): string {
  const head = `Frame ${index + 1}/${total} (timeline order)`;
  if (timeSec === undefined) return head;
  let cap = `${head}, t=${timeSec.toFixed(2)}s`;
  if (narrationLines && narrationLines.length > 0) {
    const line = narrationLineAt(narrationLines, timeSec);
    cap += line
      ? ` — narrator is saying line ${line.index}: "${line.text}"`
      : ` — before the first narration line`;
  }
  return cap;
}

const COMPOSITION_ONLY_INSTRUCTIONS = `You are a strict art director reviewing a single FULLSCREEN slide from an educational video.
You are given the rendered slide image and the intended description.

Judge ONLY visual quality, not factual correctness:
- Does the content fill the canvas, or does it float small in a large empty area?
- Are the title / key elements large and clearly the focal point?
- Is there clear visual hierarchy, grouping, and use of color/accent?
- Is the composition balanced (no big empty corners / dead bands)?
- Does it look polished and information-rich rather than bland and sparse?

Respond with ONLY a JSON object, no markdown fences, no extra prose:
{
  "pass": <true if the slide is visually rich and well-composed; false if it is sparse, simple, empty, or low quality>,
  "issues": [ "<short concrete problem>", ... ],
  "suggestions": [ "<short concrete fix the generator should apply>", ... ]
}
Be demanding: a centered title on a mostly empty background is NOT a pass.`;

/** Used when several frames across the timeline are available. */
const MOTION_REVIEW_INSTRUCTIONS = `You are a strict motion-design director reviewing an animated FULLSCREEN slide from an educational video.
You are given several frames sampled in order across the slide's timeline (frame 1 = earliest, last frame = latest), plus the intended description.

Judge composition AND choreography, not factual correctness:

Composition (each frame):
- Does the content fill the canvas, or does it float small in a large empty area?
- Are the title / key elements large and clearly the focal point?
- Is there clear visual hierarchy, grouping, and use of color/accent?
- Is the composition balanced (no big empty corners / dead bands)?

Choreography (comparing frames across time):
- Do elements arrive at different times (staggered), or does everything appear in one lockstep cut between two frames?
- Is anything still moving/changing in the later frames, or is the slide static after the first one or two frames (a "dead hold")?
- Does the slide feel like a designed sequence rather than a single screenshot held for several seconds?
- If elements are present in the final frame that weren't in the first, did they arrive with a deliberate animation rather than just appearing?

Respond with ONLY a JSON object, no markdown fences, no extra prose:
{
  "pass": <true if the sequence is visually rich, well-composed, AND well-choreographed; false otherwise>,
  "issues": [ "<short concrete problem, note which frame(s) if relevant>", ... ],
  "suggestions": [ "<short concrete fix the generator should apply, e.g. 'stagger the three cards' entrance' or 'add ambient motion during the hold'>", ... ]
}
Be demanding: a static composition that merely looks fine in one frame is NOT a pass if nothing moves across the sequence.`;

/** Appended when each frame is captioned with the narration line being spoken. */
const NARRATION_SYNC_INSTRUCTIONS = `
Narration sync (each frame caption states what the narrator is saying at that moment):
- When the narration walks through items (steps, list entries, "第一/第二/第三…"), the visual emphasis in each frame — the highlighted, enlarged, or focused element — must correspond to the item being narrated in that frame. A frame highlighting item A while the narrator discusses item B is a SYNC FAILURE.
- If the narration advances through several items but every frame keeps the same emphasis as the first item, the animation is stuck and out of sync — also a SYNC FAILURE.
- Only judge sync when the narration or description implies progression; a slide whose content does not track the narration structure is exempt.`;

/** A single frame can only judge composition; several frames unlock the choreography checks. */
export function reviewInstructionsFor(pngPaths: string[]): string {
  return pngPaths.length > 1 ? MOTION_REVIEW_INSTRUCTIONS : COMPOSITION_ONLY_INSTRUCTIONS;
}

/** Instructions for a full input — adds the narration-sync section when captioned. */
export function reviewInstructions(input: VisualReviewInput): string {
  const base = reviewInstructionsFor(input.pngPaths);
  const syncReady =
    input.pngPaths.length > 1 &&
    input.frameTimesSec?.length === input.pngPaths.length &&
    (input.narrationLines?.length ?? 0) > 0;
  return syncReady ? base + NARRATION_SYNC_INSTRUCTIONS : base;
}

/** Extract the first balanced JSON object from arbitrary model text. */
export function extractJson(text: string): any | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Turn a parsed critique into a pass flag + generator feedback. */
export function toResult(parsed: any, raw: string): VisualReviewResult {
  if (!parsed || typeof parsed.pass !== "boolean") {
    // Unparseable / malformed → don't block the pipeline.
    return { pass: true, feedback: "", raw };
  }
  if (parsed.pass) return { pass: true, feedback: "", raw };

  const issues: string[] = Array.isArray(parsed.issues) ? parsed.issues.map(String) : [];
  const suggestions: string[] = Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [];
  const lines = [
    "Visual review failed — 资深设计评审认为画面质量不足，请重写组件改进视觉表现：",
  ];
  if (issues.length) lines.push("问题：", ...issues.map((s, i) => `  ${i + 1}. ${s}`));
  if (suggestions.length) lines.push("建议：", ...suggestions.map((s, i) => `  ${i + 1}. ${s}`));
  lines.push("保持技术契约不变（默认导出、AnimationProps、仅 import react/remotion），只改进视觉密度、层次、构图、动效编排与旁白同步（跟随 props.lineTimings）。");
  return { pass: false, feedback: lines.join("\n"), raw };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function reviewVisual(
  input: VisualReviewInput,
  config: VisualReviewConfig,
  signal?: AbortSignal,
): Promise<VisualReviewResult> {
  const driver = createAgentDriver(config);

  // Captions are only useful when several frames need to be told apart;
  // a single frame keeps the caption-less "Read the image at:" phrasing.
  const multiFrame = input.pngPaths.length > 1;
  const images = input.pngPaths.map((p, i) => ({
    path: p,
    caption: multiFrame
      ? frameCaption(i, input.pngPaths.length, input.frameTimesSec?.[i], input.narrationLines)
      : undefined,
  }));

  const result = await driver.reviewImages(
    {
      instructions: reviewInstructions(input),
      images,
      trailingText: `Intended description of the slide: ${input.visualDescription}`,
      maxTokens: 1024,
    },
    signal,
  );

  return toResult(extractJson(result.text), result.text);
}
