/**
 * AutoVideo — preview command (Stage 5)
 *
 * PRD §6.5 — Open Remotion Studio for interactive per-block preview.
 *
 * Flow:
 *   1. Read script.json from build output dir
 *   2. Validate script has blocks
 *   3. Ensure public/script.json is up to date
 *   4. Copy Remotion engine files into build out dir
 *   5. Generate remotion-root-preview.tsx (each block = own Composition)
 *   6. Spawn `npx remotion studio remotion-root-preview.tsx --port=...`
 *
 * `--block B03`: All blocks shown in Studio, but B03 is the default focus.
 *
 * @see PRD §6.5
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "../config/load.js";
import type { Script } from "../types/script.js";
import { generatePreviewRoot } from "../preview/root-preview.js";

// ── Error class ───────────────────────────────────────────────────────

export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewError";
  }
}

// ── Options ───────────────────────────────────────────────────────────

export interface PreviewOptions {
  /** Path to script.json */
  scriptPath: string;
  /** Only focus on these block IDs */
  blockIds?: string[];
  /** Port for Remotion Studio (default: 3123 or first available) */
  port?: number;
  /** Config file path */
  configPath?: string;
  /** Verbose logging */
  verbose?: boolean;
}

export interface PreviewResult {
  /** The build out directory */
  outDir: string;
  /** Path to generated remotion-root-preview.tsx */
  previewRootPath: string;
  /** Port the studio is running on */
  port: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Find an available port starting from the given port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : startPort;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      if (startPort < 65535) {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(new PreviewError("No available port found"));
      }
    });
  });
}

/**
 * Copy the Remotion engine files needed by the preview root into the build out dir.
 * These are imported by remotion-root-preview.tsx and must be available relative to cwd.
 *
 * The preview root imports from `../../remotion/VideoComposition` and related paths.
 * In the build out dir, we need to recreate the same relative structure.
 */
function copyRemotionFiles(outDir: string, verbose?: boolean): void {
  // The preview root will be at `<outDir>/remotion-root-preview.tsx`
  // and imports `../../remotion/VideoComposition` which means it looks for
  // `<outDir>/../../remotion/VideoComposition` — that's the repo root's remotion/ dir.
  //
  // But when running from the build out dir, the relative path won't resolve correctly
  // unless we either:
  // (a) Copy the remotion/ dir into a location that makes `../../remotion/` resolve correctly, or
  // (b) Change the import path in the generated preview root to be relative to the build out dir.
  //
  // The simplest approach: copy the remotion/ dir into the build out dir at the correct level.
  // Preview root is at `<outDir>/remotion-root-preview.tsx`.
  // It imports from `../../remotion/...` → that resolves to `<outDir>/../../remotion/...`
  // which is wrong when outDir is e.g. `build/microgpt/`.
  //
  // Better approach: generate the preview root with correct import paths for the build out dir.
  // This is handled in generatePreviewRootForBuild() below.

  // For now, we copy the remotion/ dir into the build out dir so that
  // the preview root can import from `./remotion/...`
  const remotionDir = path.join(outDir, "remotion");
  const engineDir = path.join(remotionDir, "engine");
  const componentsDir = path.join(remotionDir, "components");

  fs.mkdirSync(engineDir, { recursive: true });
  fs.mkdirSync(componentsDir, { recursive: true });

  // Resolve paths relative to the AutoVideo package (repo root)
  const repoRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../..",
  );

  const filesToCopy = [
    {
      src: path.join(repoRoot, "remotion/VideoComposition.tsx"),
      dest: path.join(remotionDir, "VideoComposition.tsx"),
    },
    {
      src: path.join(repoRoot, "remotion/engine/block-frame.tsx"),
      dest: path.join(engineDir, "block-frame.tsx"),
    },
    {
      src: path.join(repoRoot, "remotion/engine/theme.ts"),
      dest: path.join(engineDir, "theme.ts"),
    },
    {
      src: path.join(repoRoot, "remotion/engine/types.ts"),
      dest: path.join(engineDir, "types.ts"),
    },
    {
      src: path.join(repoRoot, "remotion/components/SubtitleOverlay.tsx"),
      dest: path.join(componentsDir, "SubtitleOverlay.tsx"),
    },
  ];

  for (const { src, dest } of filesToCopy) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      if (verbose) console.log(`[preview] Copied ${src} → ${dest}`);
    } else {
      throw new PreviewError(`Required Remotion file not found: ${src}`);
    }
  }
}

/**
 * Ensure public/script.json exists in the build out dir (Remotion reads it via staticFile).
 */
function ensurePublicScript(outDir: string, script: Script): void {
  const publicDir = path.join(outDir, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const dest = path.join(publicDir, "script.json");
  fs.writeFileSync(dest, JSON.stringify(script, null, 2), "utf-8");
}

/**
 * Generate a preview root that uses local import paths (relative to build out dir).
 *
 * The build out dir has:
 *   remotion-root-preview.tsx
 *   remotion/VideoComposition.tsx
 *   remotion/engine/...
 *   remotion/components/...
 *   public/script.json
 *   src/blocks/B01/Component.tsx
 *
 * So imports should use `./remotion/VideoComposition` instead of `../../remotion/VideoComposition`.
 */
function generatePreviewRootForBuild(
  script: Script,
  options: {
    minHoldSec?: number;
    targetBlockId?: string;
  } = {},
): string {
  const { targetBlockId } = options;
  const minHoldSec = options.minHoldSec ?? 1.5;
  const { meta, blocks } = script;

  // Compute duration frames for each block
  function computeFrames(block: Script["blocks"][number]): number {
    if (block.timing) return block.timing.frames;
    const holdSec = Math.max(
      block.audio?.durationSec ?? 0,
      block.narration.explicitDurationSec ?? 0,
      minHoldSec,
    );
    const enterSec = block.enter === "none" ? 0 : 0.5;
    const exitSec = block.exit === "none" ? 0 : 0.3;
    return Math.round((enterSec + holdSec + exitSec) * meta.fps);
  }

  const blockData = blocks.map((block) => ({
    id: block.id,
    frames: computeFrames(block),
  }));

  const scriptJsonLiteral = JSON.stringify(
    { meta: { fps: meta.fps, width: meta.width, height: meta.height }, blocks: blockData },
    null,
    2,
  );

  const compositionEntries = blocks
    .map((block) => {
      const frames = computeFrames(block);
      const blockId = block.id;
      return `    <Composition
      id="${blockId}"
      component={BlockComposition}
      durationInFrames={${frames}}
      fps={script.meta.fps}
      width={script.meta.width}
      height={script.meta.height}
      defaultProps={{ blockId: '${blockId}' }}
      calculateMetadata={() => {
        const block = script.blocks.find(b => b.id === '${blockId}');
        return { durationInFrames: block.frames };
      }}
    />`;
    })
    .join("\n");

  return `/**
 * AutoVideo — Preview Root (auto-generated for build dir)
 *
 * Each block is registered as an independent Composition
 * for Remotion Studio sidebar navigation.
 */

import { registerRoot, Composition } from 'remotion';
import { BlockComposition } from './remotion/VideoComposition';

const script = ${scriptJsonLiteral};

export const Root = () => (
  <>
${compositionEntries}
  </>
);
registerRoot(Root);
`;
}

// ── Main command ──────────────────────────────────────────────────────

/**
 * Preview command — open Remotion Studio to interactively preview blocks.
 *
 * @param options - CLI options
 * @returns Information about the running preview
 */
export async function preview(options: PreviewOptions): Promise<PreviewResult> {
  const { scriptPath, blockIds, verbose } = options;
  const absScriptPath = path.resolve(scriptPath);

  if (!fs.existsSync(absScriptPath)) {
    throw new PreviewError(`script.json not found: ${absScriptPath}`);
  }

  // Determine build out dir from script.json location
  const outDir = path.dirname(absScriptPath);

  // Read and validate script
  const script: Script = JSON.parse(
    fs.readFileSync(absScriptPath, "utf-8"),
  );

  if (!script.blocks || script.blocks.length === 0) {
    throw new PreviewError("Script has no blocks — nothing to preview");
  }

  if (!script.meta) {
    throw new PreviewError("Script is missing meta section — run compile first");
  }

  // Load config
  const config = loadConfig({ configPath: options.configPath });

  // Validate block IDs if specified
  let targetBlockId: string | undefined;
  if (blockIds && blockIds.length > 0) {
    for (const id of blockIds) {
      const found = script.blocks.find((b) => b.id === id);
      if (!found) {
        throw new PreviewError(`Block not found: ${id}`);
      }
    }
    targetBlockId = blockIds[0];
  }

  // Ensure public/script.json is up to date
  ensurePublicScript(outDir, script);
  if (verbose) console.log("[preview] Updated public/script.json");

  // Copy Remotion engine files into build out dir
  copyRemotionFiles(outDir, verbose);

  // Generate preview Root.tsx with local import paths
  const previewRootCode = generatePreviewRootForBuild(script, {
    minHoldSec: config.render?.minHoldSec ?? 1.5,
    targetBlockId,
  });
  const previewRootPath = path.join(outDir, "remotion-root-preview.tsx");
  fs.writeFileSync(previewRootPath, previewRootCode, "utf-8");
  if (verbose) console.log(`[preview] Wrote ${previewRootPath}`);

  // Find available port
  const port = await findAvailablePort(options.port ?? 3123);

  console.log(`Starting Remotion Studio on port ${port}...`);
  console.log(`  Build dir: ${outDir}`);
  console.log(`  Root file: remotion-root-preview.tsx`);
  if (targetBlockId) {
    console.log(`  Target block: ${targetBlockId}`);
  }

  // Spawn Remotion Studio
  // Set REMOTION_ENTRY to tell remotion.config.ts which root to use
  const studioProc = spawn(
    "npx",
    [
      "remotion",
      "studio",
      previewRootPath,
      "--port",
      String(port),
    ],
    {
      cwd: outDir,
      stdio: "inherit",
      env: {
        ...process.env,
        REMOTION_ENTRY: previewRootPath,
      },
    },
  );

  // Handle process signals for cleanup
  const cleanup = () => {
    if (studioProc.pid && !studioProc.killed) {
      studioProc.kill("SIGTERM");
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return new Promise<PreviewResult>((resolve, reject) => {
    studioProc.on("error", (err: Error) => {
      reject(new PreviewError(`Failed to start Remotion Studio: ${err.message}`));
    });

    studioProc.on("exit", (code: number | null) => {
      // Studio often exits with null signal when killed
      if (code === 0 || code === null) {
        resolve({ outDir, previewRootPath, port });
      } else {
        reject(new PreviewError(`Remotion Studio exited with code ${code}`));
      }
    });
  });
}