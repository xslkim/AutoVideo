/**
 * AutoVideo Web — Task Runner
 *
 * Calls CLI modules (compile/tts/visuals/render/build) for each task stage.
 * - Manages AbortController + cancel signal propagation
 * - Source file snapshot for compile/build stages
 * - Config snapshot at task start with cache.dir override
 * - Build aggregate progress weighting
 *
 * PRD refs: §4.5 (task queue), §7 (taskRunner calling constraints)
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractScriptAssetRefs } from '../utils/scriptAssetRefs.js';
import { compile } from '../../src/cli/compile.js';
import { tts } from '../../src/cli/tts.js';
import { visuals } from '../../src/cli/visuals.js';
import { render } from '../../src/cli/render.js';
import { loadConfig } from '../../src/config/load.js';
import type { AutoVideoConfig } from '../../src/config/defaults.js';
import type { ProgressEvent as CliProgressEvent } from '../../src/types/script.js';
import type { TaskRecord, ProgressEvent, AppConfig } from '../types/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a web ProgressEvent callback so it can be passed to CLI modules.
 * (CLI modules use src/types/script.ProgressEvent with stage: string,
 *  while the web uses server/types/api.ProgressEvent with stage: Stage.)
 */
function wrapProgress(
  emit: (e: ProgressEvent) => void,
): (e: CliProgressEvent) => void {
  return (e: CliProgressEvent) => emit(e as unknown as ProgressEvent);
}

/**
 * Recursively copy a directory.
 */
function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Snapshot source files into outDir/_snapshot/ for compile/build stages.
 *
 * Copies: project.json, meta.md, script.md, assets/, voice/, generated_images/
 *
 * Also resolves voiceRef from meta.md relative to the original projectDir,
 * copies the voice file into _snapshot/voice/, and rewrites the snapshot
 * meta.md so voiceRef points to ./voice/{filename}.  This makes the snapshot
 * self-contained regardless of where the source voiceRef points.
 */
function snapshotSourceFiles(projectDir: string, outDir: string): void {
  const snapshotDir = path.join(outDir, '_snapshot');
  fs.mkdirSync(snapshotDir, { recursive: true });

  // Individual files
  for (const file of ['project.json', 'meta.md', 'script.md']) {
    const src = path.join(projectDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(snapshotDir, file));
    }
  }

  // Directories (assets/ and voice/)
  for (const dir of ['assets', 'voice']) {
    const src = path.join(projectDir, dir);
    if (fs.existsSync(src)) {
      copyDir(src, path.join(snapshotDir, dir));
    }
  }

  // ── Copy root-level assets referenced in script.md ──────────────────
  // Scan script.md for relative paths like ./hero.png or ./assets/... and
  // copy them from projectDir to snapshotDir so they are available to compile.
  // Handles various contexts: preceded by space, newline, parenthesis, etc.
  const srcScriptPath = path.join(projectDir, 'script.md');
  if (fs.existsSync(srcScriptPath)) {
    const scriptContent = fs.readFileSync(srcScriptPath, 'utf-8');
    const copiedPaths = new Set<string>();
    const copiedDirs = new Set<string>();

    for (const relPath of extractScriptAssetRefs(scriptContent)) {
      const resolved = path.resolve(projectDir, relPath);

      if (copiedPaths.has(resolved)) continue;
      if (!fs.existsSync(resolved)) continue;

      copiedPaths.add(resolved);

      const destPath = path.join(snapshotDir, relPath);
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      // Always refresh from project dir (picks up files uploaded after a failed compile)
      fs.copyFileSync(resolved, destPath);

      // Also copy the entire parent directory if it's a new one
      const parentDir = path.dirname(relPath);
      if (parentDir !== '.' && !copiedDirs.has(parentDir)) {
        copiedDirs.add(parentDir);
        const srcParentDir = path.join(projectDir, parentDir);
        const destParentDir = path.join(snapshotDir, parentDir);
        if (fs.existsSync(srcParentDir) && !fs.existsSync(destParentDir)) {
          copyDir(srcParentDir, destParentDir);
        }
      }
    }
  }

  // ── Resolve voiceRef and copy voice file into snapshot ──────────────
  const srcMetaPath = path.join(projectDir, 'meta.md');
  const snapshotMetaPath = path.join(snapshotDir, 'meta.md');
  if (!fs.existsSync(srcMetaPath) || !fs.existsSync(snapshotMetaPath)) return;

  const metaContent = fs.readFileSync(srcMetaPath, 'utf-8');

  // Parse voiceRef from meta.md (simple regex match — matches the
  // `voiceRef:` key in the YAML frontmatter section).
  const voiceRefMatch = metaContent.match(/^voiceRef:\s*(.+)$/m);
  let voiceRefRelative: string;
  let resolvedVoice: string;

  if (voiceRefMatch) {
    voiceRefRelative = voiceRefMatch[1].trim();
    // Resolve relative to the *original* projectDir (where meta.md lives)
    resolvedVoice = path.resolve(projectDir, voiceRefRelative);
  } else {
    // Default voiceRef: ./B00.wav relative to projectDir (matches readMeta default)
    voiceRefRelative = './B00.wav';
    resolvedVoice = path.resolve(projectDir, voiceRefRelative);
    // Add voiceRef line to snapshot meta.md so compile finds it
    const snapshotMeta = fs.readFileSync(snapshotMetaPath, 'utf-8');
    const updatedMeta = snapshotMeta.replace(
      /^---\s*$/m,
      `voiceRef: ./voice/B00.wav\n---`,
    );
    fs.writeFileSync(snapshotMetaPath, updatedMeta, 'utf-8');
  }

  if (!fs.existsSync(resolvedVoice)) return;

  // Copy into _snapshot/voice/ if not already there
  const voiceSnapDir = path.join(snapshotDir, 'voice');
  fs.mkdirSync(voiceSnapDir, { recursive: true });
  const voiceFile = path.basename(resolvedVoice);
  const voiceDest = path.join(voiceSnapDir, voiceFile);
  if (!fs.existsSync(voiceDest)) {
    fs.copyFileSync(resolvedVoice, voiceDest);
  }

  // Rewrite snapshot meta.md so voiceRef points to the local copy
  const snapshotMeta = fs.readFileSync(snapshotMetaPath, 'utf-8');
  const updatedMeta = snapshotMeta.replace(
    /^voiceRef:\s*.+$/m,
    `voiceRef: ./voice/${voiceFile}`,
  );
  fs.writeFileSync(snapshotMetaPath, updatedMeta, 'utf-8');

  // ── Resolve avatarRef and copy avatar video into snapshot ──────────
  const avatarRefMatch = metaContent.match(/^avatarRef:\s*(.+)$/m);
  if (avatarRefMatch) {
    const avatarRefRelative = avatarRefMatch[1].trim();
    const resolvedAvatar = path.resolve(projectDir, avatarRefRelative);

    if (fs.existsSync(resolvedAvatar)) {
      // Copy avatar file to snapshot root (always overwrite to pick up replacements)
      const avatarFile = path.basename(resolvedAvatar);
      const avatarDest = path.join(snapshotDir, avatarFile);
      fs.copyFileSync(resolvedAvatar, avatarDest);

      // Rewrite snapshot meta.md so avatarRef points to the local copy
      const snapMeta2 = fs.readFileSync(snapshotMetaPath, 'utf-8');
      const updatedMeta2 = snapMeta2.replace(
        /^avatarRef:\s*.+$/m,
        `avatarRef: ./${avatarFile}`,
      );
      fs.writeFileSync(snapshotMetaPath, updatedMeta2, 'utf-8');
    }
  }
}

// ---------------------------------------------------------------------------
// Config loading (snapshot at task start)
// ---------------------------------------------------------------------------

/**
 * Load web configuration from .autovideo-web/config.json merged on top of
 * DEFAULT_CONFIG, with environment variable fallbacks for missing fields.
 *
 * Returns a complete AutoVideoConfig suitable for passing to CLI modules.
 */
function loadWebConfig(repoRoot: string): AutoVideoConfig {
  // defaults + repo-root autovideo.config.json (same merge order as CLI)
  const cfg = loadConfig({ projectRoot: repoRoot }).config;

  const configPath = path.join(repoRoot, '.autovideo-web', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw: AppConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      if (raw.anthropic) {
        if (raw.anthropic.apiKey) cfg.anthropic.apiKey = raw.anthropic.apiKey;
        if (raw.anthropic.baseURL) cfg.anthropic.baseURL = raw.anthropic.baseURL;
        if (raw.anthropic.model) cfg.anthropic.model = raw.anthropic.model;
        if (raw.anthropic.concurrency !== undefined) cfg.anthropic.concurrency = raw.anthropic.concurrency;
        if (raw.anthropic.useCLI !== undefined) cfg.anthropic.useCLI = raw.anthropic.useCLI;
        if (raw.anthropic.cliPath) cfg.anthropic.cliPath = raw.anthropic.cliPath;
      }

      if (raw.voxcpm) {
        if (raw.voxcpm.endpoint) cfg.voxcpm.endpoint = raw.voxcpm.endpoint;
        if (raw.voxcpm.modelDir) cfg.voxcpm.modelDir = raw.voxcpm.modelDir;
        if (raw.voxcpm.autoStart !== undefined) cfg.voxcpm.autoStart = raw.voxcpm.autoStart;
        if (raw.voxcpm.concurrency !== undefined) cfg.voxcpm.concurrency = raw.voxcpm.concurrency;
      }

      if (raw.imageGen) {
        if (raw.imageGen.provider) cfg.imageGen.provider = raw.imageGen.provider;
        if (raw.imageGen.baseURL) cfg.imageGen.baseURL = raw.imageGen.baseURL;
        if (raw.imageGen.apiKey) cfg.imageGen.apiKey = raw.imageGen.apiKey;
        if (raw.imageGen.model) cfg.imageGen.model = raw.imageGen.model;
        if (raw.imageGen.size) cfg.imageGen.size = raw.imageGen.size;
        if (raw.imageGen.timeoutMs !== undefined) cfg.imageGen.timeoutMs = raw.imageGen.timeoutMs;
        if (raw.imageGen.concurrency !== undefined) cfg.imageGen.concurrency = raw.imageGen.concurrency;
        if (raw.imageGen.numSteps !== undefined) cfg.imageGen.numSteps = raw.imageGen.numSteps;
        if (raw.imageGen.cfgScale !== undefined) cfg.imageGen.cfgScale = raw.imageGen.cfgScale;
      }

      if (raw.musetalk) {
        (cfg as any).musetalk = { ...(cfg as any).musetalk, ...raw.musetalk };
      }
    } catch {
      // Malformed config — use defaults
    }
  }

  // Environment variable fallbacks (for fields not set in config.json)
  if (process.env.ANTHROPIC_BASE_URL && !cfg.anthropic.baseURL) {
    cfg.anthropic.baseURL = process.env.ANTHROPIC_BASE_URL;
  }
  if (process.env.VOXCPM_ENDPOINT) {
    cfg.voxcpm.endpoint = process.env.VOXCPM_ENDPOINT;
  }
  if (process.env.VOXCPM_MODEL_DIR) {
    cfg.voxcpm.modelDir = process.env.VOXCPM_MODEL_DIR;
  }
  // Env var fallback for apiKey — only used if NOT already set via config.json (UI)
  if (!cfg.anthropic.apiKey && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    (cfg.anthropic as any).apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  }

  // MuseTalk URL env var fallback
  if (process.env.MUSETALK_URL) {
    (cfg as any).musetalk = { ...(cfg as any).musetalk, url: process.env.MUSETALK_URL };
  }

  if (process.env.IMAGE_GEN_BASE_URL && !cfg.imageGen.baseURL) {
    cfg.imageGen.baseURL = process.env.IMAGE_GEN_BASE_URL;
  }
  if (process.env.IMAGE_GEN_API_KEY && !cfg.imageGen.apiKey) {
    cfg.imageGen.apiKey = process.env.IMAGE_GEN_API_KEY;
  }
  if (process.env.IMAGE_GEN_PROVIDER && !cfg.imageGen.provider) {
    cfg.imageGen.provider = process.env.IMAGE_GEN_PROVIDER as 'openai' | 'sensenova';
  }

  return cfg;
}

// ---------------------------------------------------------------------------
// Helper to get merged config with project-specific cache dir
// ---------------------------------------------------------------------------

function getTaskConfig(repoRoot: string, projectDir: string): AutoVideoConfig {
  const cfg = loadWebConfig(repoRoot);
  // Override cache dir to project-scoped cache (hard constraint per §3.3 / §4.5)
  cfg.cache.dir = path.join(projectDir, 'cache');
  return cfg;
}

// ---------------------------------------------------------------------------
// Task-runner factory
// ---------------------------------------------------------------------------

/**
 * Create a task-runner function compatible with TaskQueue.onRun().
 *
 * The returned function delegates to the correct CLI module based on
 * task.stage and handles snapshotting, config assembly, and progress mapping.
 */
export function createTaskRunner(projectsRoot: string, repoRoot: string) {
  return async function runTask(
    task: TaskRecord,
    signal: AbortSignal,
    onProgress: (event: ProgressEvent) => void,
  ): Promise<void> {
    const projectDir = path.join(projectsRoot, task.project);
    const slug = task.outputSlug;
    const outDir = path.join(projectDir, 'build', slug);

    if (!fs.existsSync(projectDir)) {
      throw new Error(`Project directory not found: ${projectDir}`);
    }

    const stage = task.stage;

    // Config snapshot at task start (with project-scoped cache dir)
    const config = getTaskConfig(repoRoot, projectDir);

    switch (stage) {
      // ── compile ──────────────────────────────────────────────────────
      case 'compile': {
        snapshotSourceFiles(projectDir, outDir);

        await compile({
          projectPath: path.join(outDir, '_snapshot', 'project.json'),
          outDir,
          onProgress: wrapProgress(onProgress),
          signal,
          verbose: true,
        });
        break;
      }

      // ── tts ──────────────────────────────────────────────────────────
      case 'tts': {
        const scriptPath = path.join(outDir, 'script.json');
        if (!fs.existsSync(scriptPath)) {
          throw Object.assign(
            new Error(`script.json not found at ${scriptPath}. Run compile first.`),
            { code: 'ERR_SCRIPT_NOT_FOUND' },
          );
        }

        await tts({
          scriptPath,
          config,
          blockIds: task.blockIds,
          force: task.force,
          onProgress: wrapProgress(onProgress),
          signal,
          verbose: true,
        });
        break;
      }

      // ── visuals ──────────────────────────────────────────────────────
      case 'visuals': {
        const scriptPath = path.join(outDir, 'script.json');
        if (!fs.existsSync(scriptPath)) {
          throw Object.assign(
            new Error(`script.json not found at ${scriptPath}. Run compile first.`),
            { code: 'ERR_SCRIPT_NOT_FOUND' },
          );
        }

        console.log('[taskRunner] visuals config:', JSON.stringify({
          apiKey: config.anthropic.apiKey ? `${config.anthropic.apiKey.slice(0, 12)}...` : 'MISSING',
          baseURL: config.anthropic.baseURL,
          model: config.anthropic.model,
        }));

        await visuals({
          scriptPath,
          config,
          blockIds: task.blockIds,
          force: task.force,
          onProgress: wrapProgress(onProgress),
          signal,
          verbose: true,
        });
        break;
      }

      // ── render ───────────────────────────────────────────────────────
      case 'render': {
        const scriptPath = path.join(outDir, 'script.json');
        if (!fs.existsSync(scriptPath)) {
          throw Object.assign(
            new Error(`script.json not found at ${scriptPath}. Run compile first.`),
            { code: 'ERR_SCRIPT_NOT_FOUND' },
          );
        }

        await render({
          scriptPath,
          config,
          blockIds: task.blockIds,
          force: task.force,
          onProgress: wrapProgress(onProgress),
          signal,
          verbose: true,
        });
        break;
      }

      // ── build (orchestrated: compile → tts → visuals → render) ───────
      // Aggregate weights (WEB_PRD.md §4.5):
      //   compile 5% / tts 25% / visuals 35% / render 30% / finish 5%
      case 'build': {
        snapshotSourceFiles(projectDir, outDir);

        // Stage 1: compile (0–5%)
        await compile({
          projectPath: path.join(outDir, '_snapshot', 'project.json'),
          outDir,
          onProgress: wrapProgress((e) => onProgress({ ...e, percent: Math.round(e.percent * 0.05) })),
          signal,
          verbose: true,
        });

        const scriptPath = path.join(outDir, 'script.json');

        // Stage 2: tts (5–30%)
        if (signal.aborted) break;
        await tts({
          scriptPath,
          config,
          onProgress: wrapProgress((e) => onProgress({ ...e, percent: Math.round(5 + e.percent * 0.25), stage: 'tts' })),
          signal,
          verbose: true,
        });

        // Stage 3: visuals (30–65%)
        if (signal.aborted) break;
        await visuals({
          scriptPath,
          config,
          onProgress: wrapProgress((e) => onProgress({ ...e, percent: Math.round(30 + e.percent * 0.35), stage: 'visuals' })),
          signal,
          verbose: true,
        });

        // Stage 4: render (65–95%)
        if (signal.aborted) break;
        await render({
          scriptPath,
          config,
          onProgress: wrapProgress((e) => onProgress({ ...e, percent: Math.round(65 + e.percent * 0.30), stage: 'render' })),
          signal,
          verbose: true,
        });

        // Finish (95–100%)
        onProgress({ percent: 100, step: '构建完成', stage: 'build' });
        break;
      }

      // ── merge (concat-only: concat + loudnorm + qa) ──────────────────
      case 'merge': {
        const scriptPath = path.join(outDir, 'script.json');
        if (!fs.existsSync(scriptPath)) {
          throw Object.assign(
            new Error(`script.json not found at ${scriptPath}. Run compile first.`),
            { code: 'ERR_SCRIPT_NOT_FOUND' },
          );
        }

        // Re-sync media files (avatar, voice) into the snapshot so that
        // files uploaded after the last compile are picked up by merge.
        // This does NOT re-compile; script.json is left unchanged.
        snapshotSourceFiles(projectDir, outDir);

        // If the snapshot has an avatarRef but script.json doesn't (e.g. avatar
        // was added after the last compile), patch script.json so the lipsync
        // overlay step runs correctly.
        {
          const snapshotMetaPath = path.join(outDir, '_snapshot', 'meta.md');
          if (fs.existsSync(snapshotMetaPath)) {
            const snapshotMeta = fs.readFileSync(snapshotMetaPath, 'utf-8');
            const avatarMatch = snapshotMeta.match(/^avatarRef:\s*(.+)$/m);
            if (avatarMatch) {
              const snapshotAvatarPath = path.resolve(
                path.join(outDir, '_snapshot'),
                avatarMatch[1].trim(),
              );
              if (fs.existsSync(snapshotAvatarPath)) {
                const scriptRaw = JSON.parse(fs.readFileSync(scriptPath, 'utf-8')) as Record<string, any>;
                if (!scriptRaw?.meta?.avatarRef) {
                  scriptRaw.meta.avatarRef = snapshotAvatarPath;
                  fs.writeFileSync(scriptPath, JSON.stringify(scriptRaw, null, 2), 'utf-8');
                  console.log(`[taskRunner] Patched script.json with avatarRef: ${snapshotAvatarPath}`);
                }
              }
            }
          }
        }

        // merge progress mapping: concat 60 / loudnorm 30 / qa 10
        await render({
          scriptPath,
          config,
          concatOnly: true,
          onProgress: wrapProgress((e) => {
            // render with concatOnly emits progress for concat/loudnorm/qa phases
            // Map to merge weights
            const step = e.step;
            let weightedPercent = e.percent;
            if (step.includes('concat') || step.includes('拼接')) {
              weightedPercent = Math.round(e.percent * 0.60);
            } else if (step.includes('loudnorm') || step.includes('归一化') || step.includes('响度')) {
              weightedPercent = Math.round(60 + e.percent * 0.30);
            } else if (step.includes('QA') || step.includes('qa')) {
              weightedPercent = Math.round(90 + e.percent * 0.10);
            }
            onProgress({ ...e, percent: weightedPercent, stage: 'merge' });
          }),
          signal,
          verbose: true,
        });
        break;
      }

      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  };
}
