/**
 * AutoVideo — quick-build command (fast preview pipeline)
 *
 * 快速构建：compile → tts → quick-visuals（本地占位卡片）→ render（快速编码参数）
 *
 * 与正常 build 的差异：
 *   - 输出到独立目录 build/<slug>-quick/（不覆盖正常构建产物）
 *   - 不跑 visuals 阶段：animation / 无源 image / html 块统一生成文字简介卡片
 *     （见 quick-visuals.ts），不调 LLM / 文生图 / Puppeteer 截图
 *   - render 前改写快速目录 script.json 的 meta：skipLipsync=true 且删除
 *     avatarRef/avatarRadius，跳过 MuseTalk 口型同步与头像 overlay 重编码
 *   - render 编码参数覆盖：crf 30 + x264Preset veryfast
 *     （partial 缓存 key 含 qualityJson，不污染正常构建缓存）
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Script, ProgressEvent } from "../types/script.js";
import { compile, type CompileOptions, type CompileResult } from "./compile.js";
import { tts, type TtsOptions, type TtsResult } from "./tts.js";
import { render, type RenderOptions, type RenderResult } from "./render.js";
import { quickVisuals, type QuickVisualsOptions } from "./quick-visuals.js";
import { loadConfig } from "../config/load.js";
import { DEFAULT_QUALITY, type AutoVideoConfig } from "../config/defaults.js";
import { readProject } from "../parser/project.js";
import { readMeta } from "../parser/meta.js";
import { resolveOutDir } from "../utils/slugify.js";
import type { BuildOptions, BuildResult } from "./build.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class QuickBuildError extends Error {
  code: string;
  constructor(message: string, code = "ERR_QUICK_BUILD_FAILED") {
    super(message);
    this.name = "QuickBuildError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface QuickBuildOptions extends BuildOptions {
  /** 直接传入已合并的配置（Web 端 taskRunner 用）；省略时走 loadConfig */
  config?: AutoVideoConfig;
  /** --cache-dir 覆盖（透传给 loadConfig） */
  cacheDir?: string;
}

/** 快速编码参数：在 config.render.quality 基础上覆盖这两项 */
const QUICK_QUALITY_OVERRIDES = { crf: 30, x264Preset: "veryfast" } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 计算快速构建输出目录：正常构建目录加 "-quick" 后缀。
 * 显式 --out 时原样使用（resolveOutDir 规则）。
 */
function resolveQuickOutDir(projectPath: string, outFlag?: string): string {
  if (outFlag) {
    return resolveOutDir("", outFlag);
  }
  const project = readProject(projectPath);
  const meta = readMeta(project.metaPath);
  return resolveOutDir(
    meta.title,
    undefined,
    `${meta.slug ?? meta.title}-quick`,
    project.projectDir,
  );
}

/**
 * 改写快速目录 script.json 的 meta：跳过 MuseTalk 口型同步与头像 overlay。
 */
function stripAvatarMeta(scriptPath: string): void {
  const raw = JSON.parse(readFileSync(scriptPath, "utf-8")) as {
    meta?: Record<string, unknown>;
  };
  if (!raw.meta) return;
  raw.meta.skipLipsync = true;
  delete raw.meta.avatarRef;
  delete raw.meta.avatarRadius;
  writeFileSync(scriptPath, JSON.stringify(raw, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// quickBuild()
// ---------------------------------------------------------------------------

export async function quickBuild(options: QuickBuildOptions): Promise<BuildResult> {
  const { projectPath, verbose = false, dryRun = false, onProgress, signal } = options;

  const resolvedProject = resolve(projectPath);

  if (!existsSync(resolvedProject)) {
    throw new QuickBuildError(`Project file not found: ${resolvedProject}`);
  }

  if (signal?.aborted) throw new QuickBuildError("Build cancelled", "ERR_CANCELLED");

  // Load configuration (web 端可直接传入 config)
  const config =
    options.config ??
    loadConfig({ configPath: options.configPath, cacheDir: options.cacheDir }).config;

  // 快速编码参数覆盖（仅 render 阶段使用；tts 用原 config）
  const quickConfig: AutoVideoConfig = {
    ...config,
    render: {
      ...config.render,
      quality: {
        ...DEFAULT_QUALITY,
        ...(config.render?.quality ?? {}),
        ...QUICK_QUALITY_OVERRIDES,
      },
    },
  };

  const stagePrefix = (stage: string) => `[quick-build:${stage}]`;

  // 默认输出目录：正常构建目录加 "-quick" 后缀
  const quickOutDir = resolveQuickOutDir(resolvedProject, options.outDir);

  // ── Stage 1: compile (0-25%) ─────────────────────────────────────────

  onProgress?.({ percent: 0, step: "开始编译", stage: "compile" });

  console.log(`${stagePrefix("compile")} Starting compile...`);
  const compileOpts: CompileOptions = {
    projectPath: resolvedProject,
    outDir: quickOutDir,
    configPath: options.configPath,
    metaArgs: options.metaArgs,
    dryRun,
    verbose,
    onProgress: (event) => {
      onProgress?.({ ...event, percent: event.percent * 0.25, stage: "compile" });
    },
    signal,
  };

  let compileResult: CompileResult;
  try {
    compileResult = await compile(compileOpts);
  } catch (err: any) {
    throw new QuickBuildError(
      `Stage 'compile' failed: ${err.message || err}\n` +
        `Fix the issue and re-run: autovideo compile ${projectPath}`,
      err.code || "ERR_BUILD_COMPILE",
    );
  }

  if (signal?.aborted) throw new QuickBuildError("Build cancelled", "ERR_CANCELLED");

  const { outDir } = compileResult;
  const scriptPath = join(outDir, "script.json");

  console.log(`${stagePrefix("compile")} Done → ${scriptPath}`);

  // ── Stage 2: tts (25-50%) ────────────────────────────────────────────

  onProgress?.({ percent: 25, step: "开始语音合成", stage: "tts" });

  console.log(`${stagePrefix("tts")} Starting tts...`);
  const ttsOpts: TtsOptions = {
    scriptPath,
    config,
    verbose,
    dryRun,
    onProgress: (event) => {
      onProgress?.({ ...event, percent: 25 + event.percent * 0.25, stage: "tts" });
    },
    signal,
  };

  let ttsResult: TtsResult;
  try {
    ttsResult = await tts(ttsOpts);
  } catch (err: any) {
    throw new QuickBuildError(
      `Stage 'tts' failed: ${err.message || err}\n` +
        `Fix the issue and re-run: autovideo tts ${scriptPath}`,
      err.code || "ERR_BUILD_TTS",
    );
  }

  if (signal?.aborted) throw new QuickBuildError("Build cancelled", "ERR_CANCELLED");

  console.log(
    `${stagePrefix("tts")} Done (${ttsResult.cacheHits} cache hits, ${ttsResult.apiCalls} API calls)`,
  );

  // ── Stage 3: quick-visuals (50-60%，纯本地占位卡片) ──────────────────

  onProgress?.({ percent: 50, step: "生成占位视觉卡片", stage: "quick-visuals" });

  console.log(`${stagePrefix("quick-visuals")} Generating placeholder cards...`);
  const quickVisualsOpts: QuickVisualsOptions = {
    scriptPath,
    verbose,
    dryRun,
    onProgress: (event) => {
      onProgress?.({ ...event, percent: 50 + event.percent * 0.1, stage: "quick-visuals" });
    },
    signal,
  };

  try {
    await quickVisuals(quickVisualsOpts);
  } catch (err: any) {
    throw new QuickBuildError(
      `Stage 'quick-visuals' failed: ${err.message || err}`,
      err.code || "ERR_BUILD_QUICK_VISUALS",
    );
  }

  if (signal?.aborted) throw new QuickBuildError("Build cancelled", "ERR_CANCELLED");

  // 改写快速目录 script.json 的 meta：跳过口型同步与头像 overlay
  if (!dryRun) {
    stripAvatarMeta(scriptPath);
  } else {
    console.log(`${stagePrefix("meta")} Dry run: would set skipLipsync=true and drop avatarRef`);
  }

  // ── Stage 4: render (60-100%，快速编码参数) ──────────────────────────

  onProgress?.({ percent: 60, step: "开始渲染", stage: "render" });

  console.log(`${stagePrefix("render")} Starting render (crf ${QUICK_QUALITY_OVERRIDES.crf}, ${QUICK_QUALITY_OVERRIDES.x264Preset})...`);
  const renderOpts: RenderOptions = {
    scriptPath,
    config: quickConfig,
    verbose,
    dryRun,
    onProgress: (event) => {
      onProgress?.({ ...event, percent: 60 + event.percent * 0.4, stage: "render" });
    },
    signal,
  };

  let renderResult: RenderResult;
  try {
    renderResult = await render(renderOpts);
  } catch (err: any) {
    throw new QuickBuildError(
      `Stage 'render' failed: ${err.message || err}\n` +
        `Fix the issue and re-run: autovideo render ${scriptPath}`,
      err.code || "ERR_BUILD_RENDER",
    );
  }

  console.log(
    `${stagePrefix("render")} Done (${renderResult.cacheHits} cache hits, ${renderResult.renders} renders)`,
  );

  console.log(`\n✓ Quick build complete: ${outDir}`);

  onProgress?.({ percent: 100, step: "快速构建完成", stage: "build" });

  return {
    script: renderResult.script as Script,
    outDir,
  };
}

// ---------------------------------------------------------------------------
// CLI command wrapper
// ---------------------------------------------------------------------------

export async function quickBuildCommand(
  projectPath: string,
  opts: {
    out?: string;
    config?: string;
    cacheDir?: string;
    verbose?: boolean;
    dryRun?: boolean;
    meta?: string[];
  },
): Promise<void> {
  try {
    const result = await quickBuild({
      projectPath,
      outDir: opts.out,
      configPath: opts.config,
      cacheDir: opts.cacheDir,
      verbose: opts.verbose,
      dryRun: opts.dryRun,
      metaArgs: opts.meta,
    });
    console.log(`\nQuick build complete: ${result.outDir}`);
  } catch (err: any) {
    if (err instanceof QuickBuildError) {
      console.error(`\n✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
