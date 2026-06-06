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
 *      → failure: retry up to 3 rounds with error feedback → put cache → write file
 *   5. Failure: 3 rounds exhausted → AbortController cancels in-flight → exit + recovery command
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
  type ValidateComponentOptions,
} from "../ai/validate.js";
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

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 60_000; // 60s base, doubles each attempt (60s / 120s / 240s …)
const POST_REQUEST_DELAY_MS = 20_000; // 20s cooldown after each successful API call (Claude Code OAuth rate limit)

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
 * Compute promptVersion: MD5 first 8 chars of system prompt content.
 * Falls back to a default if the prompt file does not exist.
 */
function computePromptVersion(): string {
  try {
    const promptPath = path.resolve(
      new URL(".", import.meta.url).pathname,
      "../ai/prompts/component.md"
    );
    const content = fs.readFileSync(promptPath, "utf-8");
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 8);
  } catch {
    return "default1";
  }
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
  };
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
- Accept AnimationProps: { frame, durationInFrames, width, height, subtitleSafeBottom, theme, fps }
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

## Layout rules (CRITICAL — viewers complain when slides feel empty)

The available canvas is \`width × (height - subtitleSafeBottom)\`. **You MUST fill this area generously.**

### Padding & content area

- Outer padding around the content cluster: AT MOST \`min(width, height) * 0.06\` (≈ 65 px on 1080p). NEVER use larger margins like 100 px or 10 % of the canvas — that produces dead space.
- The bounding box of all visible elements (titles, cards, code blocks, etc.) MUST cover at least **70 % of the available canvas area**. Sparse single-element layouts that float in the middle of a huge empty canvas are BANNED.
- If the description only mentions one or two elements, scale them up to fill the canvas — make the title huge, add decorative supporting elements (subtle background grid, accent bars, glowing accents, secondary captions), and use them to anchor the layout.

### Font sizes (assume 1080p; scale proportionally if width/height differ)

Use these as MINIMUMS unless the description gives explicit larger values:

| Element | Min font-size | Suggested |
|---|---|---|
| Hero / main title | \`height * 0.07\` (≈ 76 px) | \`height * 0.09\` (≈ 96 px) |
| Section title | \`height * 0.045\` (≈ 50 px) | \`height * 0.055\` (≈ 60 px) |
| Body text / list item | \`height * 0.025\` (≈ 28 px) | \`height * 0.030\` (≈ 32 px) |
| Caption / label | \`height * 0.018\` (≈ 20 px) | \`height * 0.022\` (≈ 24 px) |
| Code block (mono) | \`height * 0.022\` (≈ 24 px) | \`height * 0.026\` (≈ 28 px) |

Compute all font sizes from \`width\` / \`height\` props (e.g. \`fontSize: height * 0.07\`) so they scale across aspect ratios. Do NOT hardcode 16 px / 22 px / 32 px small values.

### Composition rules

- Center primary content both horizontally and vertically within the available area, OR use a clear grid (2-col, 3-col, header+body) that spans nearly the full width.
- When showing multiple items (lists, cards, steps): lay them out as a row or grid that occupies ≥ 80 % of the canvas width with generous internal spacing between items, instead of stacking them in a narrow column in the middle.
- For code/terminal blocks: the block container should occupy at least 70 % of the canvas width and 50 % of the available height.
- Reserve the bottom \`subtitleSafeBottom\` pixels — do NOT place text or important elements there.
- Avoid empty corners: distribute weight so the upper-third, middle, and lower-third (above subtitleSafeBottom) all carry visible content.

### Self-check before returning

Before emitting code, mentally verify:
1. Is the largest font size ≥ \`height * 0.07\`? If not, increase it.
2. Does the content cluster cover ≥ 70 % of the canvas area? If not, enlarge elements or add supporting structure.
3. Are outer margins ≤ 6 % of the smaller canvas dimension? If not, reduce them.
4. Did I compute sizes from \`width\` / \`height\` props rather than hardcoding small pixel values? If not, refactor.`;
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
  const promptVersion = computePromptVersion();
  const claudeModel = config.anthropic.model;
  const systemPrompt = buildDefaultSystemPrompt();

  // Setup cache
  const cacheStore = new CacheStore({
    cacheDir: config.cache.dir,
    maxSizeGB: config.cache.maxSizeGB,
    evictTrigger: config.cache.evictTrigger,
  });

  // Anthropic config for generateComponent (animation mode)
  const anthropicConfig: AnthropicConfig = {
    model: config.anthropic.model,
    maxRetries: config.anthropic.maxRetries,
    baseURL: config.anthropic.baseURL,
    apiKey: config.anthropic.apiKey,
    useCLI: config.anthropic.useCLI,
    cliPath: config.anthropic.cliPath,
  };

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
                `Validation failed:\n${validation.errors.join("\n")}`
              );
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
      ...failedBlocks.map((fb) => `  ${fb.id}: ${fb.error.split("\n")[0]}`),
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
