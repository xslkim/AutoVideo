/**
 * sync-runtime.ts — Sync the Remotion runtime into a build output directory.
 *
 * A build dir is bundled as a self-contained Remotion project, so the engine
 * files under remotion/ and the optional prebuilt component library
 * (remotion/library/) are copied verbatim — generated components import them
 * via relative paths (e.g. ../../../remotion/library).
 *
 * Also exposes computeLibraryHash(), which fingerprints the synced library so
 * partial-cache keys track the exact files that get bundled.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/** libraryHash used when no component library has been synced into the build dir. */
export const NO_LIBRARY_HASH = 'no-library';

/**
 * Engine files copied verbatim into <buildDir>/ — same relative paths as in
 * the repo. Keep in sync with the imports of the generated remotion roots.
 */
const REMOTION_RUNTIME_FILES = [
  'remotion/VideoComposition.tsx',
  'remotion/engine/block-frame.tsx',
  'remotion/engine/theme.ts',
  'remotion/engine/types.ts',
  'remotion/components/SubtitleOverlay.tsx',
];

export interface SyncRuntimeOptions {
  /** Prefix for log lines, e.g. "[render]". Defaults to "[sync-runtime]". */
  logPrefix?: string;
  /** Repo root override (tests). Defaults to the installed package root. */
  repoRoot?: string;
}

/**
 * Resolve the repo root the same way src/cli/render.ts does: this file sits
 * two levels below the root both in src/ and in the compiled dist/ layout.
 */
function resolveRepoRoot(): string {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../..',
  );
}

function copyDirRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy the Remotion engine files and (when present) the prebuilt component
 * library into <buildDir>/remotion/. Idempotent: repeated calls overwrite
 * the same destinations with the same contents.
 *
 * A missing remotion/library/ is not an error — the library may not have
 * been created yet — but the skip is logged so it stays visible.
 */
export function syncRemotionRuntime(
  buildDir: string,
  options: SyncRuntimeOptions = {},
): void {
  const logPrefix = options.logPrefix ?? '[sync-runtime]';
  const repoRoot = options.repoRoot ?? resolveRepoRoot();

  for (const rel of REMOTION_RUNTIME_FILES) {
    const srcPath = path.join(repoRoot, rel);
    const destPath = path.join(buildDir, rel);
    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log(`${logPrefix} Copied remotion files to ${path.join(buildDir, 'remotion')}`);

  const librarySrc = path.join(repoRoot, 'remotion', 'library');
  const libraryDest = path.join(buildDir, 'remotion', 'library');
  if (fs.existsSync(librarySrc)) {
    copyDirRecursive(librarySrc, libraryDest);
    console.log(`${logPrefix} Copied remotion library to ${libraryDest}`);
  } else {
    console.log(`${logPrefix} No remotion/library at ${librarySrc} — skipped (component library not created yet)`);
  }
}

function listFilesRecursive(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs, base));
    } else {
      out.push(path.relative(base, abs));
    }
  }
  return out;
}

/**
 * Deterministic md5 over every file under <buildDir>/remotion/library/:
 * files are sorted by relative path, then their contents are concatenated
 * and hashed. Returns NO_LIBRARY_HASH when the library has not been synced.
 *
 * Computed against the build dir (not the repo) so the hash always reflects
 * the exact files that get bundled.
 */
export function computeLibraryHash(buildDir: string): string {
  const libraryDir = path.join(buildDir, 'remotion', 'library');
  if (!fs.existsSync(libraryDir)) return NO_LIBRARY_HASH;

  const hash = crypto.createHash('md5');
  for (const rel of listFilesRecursive(libraryDir, libraryDir).sort()) {
    hash.update(fs.readFileSync(path.join(libraryDir, rel)));
  }
  return hash.digest('hex');
}
