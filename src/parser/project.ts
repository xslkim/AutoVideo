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
 * Raw shape of project.json as written by the user.
 */
export interface RawProjectJson {
  /** Path to meta.md (relative to project.json directory) */
  meta: string;
  /** List of content .md file paths (relative to project.json directory) */
  blocks: string[];
}

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
  /** Absolute paths to each block content .md file (in order) */
  blockPaths: string[];
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
    if (typeof obj.blocks[i] !== "string" || (obj.blocks[i] as string).trim() === "") {
      throw new ProjectError(
        `project.json "blocks[${i}]" must be a non-empty string`,
      );
    }
  }

  const projectDir = dirname(projectPath);

  // 4. Resolve paths relative to project.json directory
  const metaPath = resolve(projectDir, obj.meta as string);
  const blockPaths = (obj.blocks as string[]).map((p) =>
    resolve(projectDir, p),
  );

  // 5. Validate files exist
  if (!existsSync(metaPath)) {
    throw new ProjectError(
      `Meta file not found: ${metaPath} (resolved from "${obj.meta}" in ${projectPath})`,
    );
  }

  for (let i = 0; i < blockPaths.length; i++) {
    if (!existsSync(blockPaths[i])) {
      throw new ProjectError(
        `Block file not found: ${blockPaths[i]} (resolved from "${obj.blocks[i]}" in ${projectPath})`,
      );
    }
  }

  return {
    projectPath,
    projectDir,
    metaPath,
    blockPaths,
  };
}
