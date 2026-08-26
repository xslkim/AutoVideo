/**
 * AutoVideo — project.json reader & path resolver
 *
 * Reads a project.json file, parses `meta` / `blocks` fields,
 * resolves all relative paths to absolute paths, and validates
 * that referenced files exist.
 *
 * PRD references: §3.1 (project.json), §6.1 (Stage 1 — compile)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw shape of a `blocks` entry in project.json.
 *
 * Two forms are supported:
 * - string: path to a single-file script (legacy format, visual + narration
 *   sections in one .md file)
 * - object: `{ "visual": "./visuals.md", "narration": "./narration.md" }` —
 *   split format, blocks are aligned across the two files by #Bxx ID
 */
export type RawBlockEntry = string | { visual: string; narration: string };

/**
 * Raw shape of project.json as written by the user.
 */
export interface RawProjectJson {
  /** Path to meta.md (relative to project.json directory) */
  meta: string;
  /** List of content entries (relative to project.json directory) */
  blocks: RawBlockEntry[];
}

/**
 * A resolved `blocks` entry with all paths absolute.
 */
export type BlockEntry =
  | { kind: "single"; path: string }
  | { kind: "split"; visualPath: string; narrationPath: string };

/**
 * Resolved project structure with all paths as absolute.
 */
export interface ResolvedProject {
  /** Absolute path to the project.json file itself */
  projectPath: string;
  /** Directory containing project.json (base for relative path resolution) */
  projectDir: string;
  /** Absolute path to the meta.md file */
  metaPath: string;
  /**
   * Absolute paths to each single-file (legacy) block content .md, in order.
   * Kept for backward compatibility; new callers should use `blockEntries`.
   */
  blockPaths: string[];
  /** All block entries in order (both single-file and split forms) */
  blockEntries: BlockEntry[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Read and validate a project.json file.
 *
 * @param projectJsonPath - Absolute or relative path to project.json
 * @returns ResolvedProject with all paths as absolute
 * @throws ProjectError if the file is missing, malformed, or references non-existent files
 */
export function readProject(projectJsonPath: string): ResolvedProject {
  const projectPath = resolve(projectJsonPath);

  // 1. File must exist
  if (!existsSync(projectPath)) {
    throw new ProjectError(
      `Project file not found: ${projectPath}`,
    );
  }

  // 2. Parse JSON
  let raw: unknown;
  try {
    const content = readFileSync(projectPath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectError(
      `Failed to read project.json "${projectPath}": ${msg}`,
    );
  }

  // 3. Validate structure
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProjectError(
      `project.json must be a JSON object, got ${typeof raw}`,
    );
  }

  const obj = raw as Record<string, unknown>;

  // 3a. `meta` field
  if (typeof obj.meta !== "string" || obj.meta.trim() === "") {
    throw new ProjectError(
      `project.json missing required string field "meta"`,
    );
  }

  // 3b. `blocks` field
  if (!Array.isArray(obj.blocks)) {
    throw new ProjectError(
      `project.json missing required array field "blocks"`,
    );
  }

  if (obj.blocks.length === 0) {
    throw new ProjectError(
      `project.json "blocks" must be a non-empty array`,
    );
  }

  for (let i = 0; i < obj.blocks.length; i++) {
    const entry = obj.blocks[i] as unknown;
    if (typeof entry === "string") {
      if (entry.trim() === "") {
        throw new ProjectError(
          `project.json "blocks[${i}]" must be a non-empty string`,
        );
      }
    } else if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const split = entry as Record<string, unknown>;
      if (typeof split.visual !== "string" || split.visual.trim() === "") {
        throw new ProjectError(
          `project.json "blocks[${i}].visual" must be a non-empty string`,
        );
      }
      if (typeof split.narration !== "string" || split.narration.trim() === "") {
        throw new ProjectError(
          `project.json "blocks[${i}].narration" must be a non-empty string`,
        );
      }
    } else {
      throw new ProjectError(
        `project.json "blocks[${i}]" must be a non-empty string or an object with "visual" and "narration" fields`,
      );
    }
  }

  const projectDir = dirname(projectPath);

  // 4. Resolve paths relative to project.json directory
  const metaPath = resolve(projectDir, obj.meta as string);
  const rawEntries = obj.blocks as RawBlockEntry[];
  const blockEntries: BlockEntry[] = rawEntries.map((entry) =>
    typeof entry === "string"
      ? { kind: "single", path: resolve(projectDir, entry) }
      : {
          kind: "split",
          visualPath: resolve(projectDir, entry.visual),
          narrationPath: resolve(projectDir, entry.narration),
        },
  );
  const blockPaths = blockEntries
    .filter((e): e is { kind: "single"; path: string } => e.kind === "single")
    .map((e) => e.path);

  // 5. Validate files exist
  if (!existsSync(metaPath)) {
    throw new ProjectError(
      `Meta file not found: ${metaPath} (resolved from "${obj.meta}" in ${projectPath})`,
    );
  }

  for (let i = 0; i < blockEntries.length; i++) {
    const entry = blockEntries[i];
    const raw = rawEntries[i];
    if (entry.kind === "single") {
      if (!existsSync(entry.path)) {
        throw new ProjectError(
          `Block file not found: ${entry.path} (resolved from "${raw}" in ${projectPath})`,
        );
      }
    } else {
      const rawSplit = raw as { visual: string; narration: string };
      if (!existsSync(entry.visualPath)) {
        throw new ProjectError(
          `Visual file not found: ${entry.visualPath} (resolved from "${rawSplit.visual}" in ${projectPath})`,
        );
      }
      if (!existsSync(entry.narrationPath)) {
        throw new ProjectError(
          `Narration file not found: ${entry.narrationPath} (resolved from "${rawSplit.narration}" in ${projectPath})`,
        );
      }
    }
  }

  return {
    projectPath,
    projectDir,
    metaPath,
    blockPaths,
    blockEntries,
  };
}
