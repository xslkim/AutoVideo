/**
 * AutoVideo — Split-file block parser
 *
 * Parses the split content format: a visuals file and a narration file
 * whose blocks are aligned by #Bxx ID.
 *
 * visuals.md:   `>>> Title #B01` header + @directives + visual description
 *               (no `--- visual ---` marker; the description starts at the
 *               first non-empty, non-@ body line and runs to the next block)
 * narration.md: `>>> Title #B01` header + narration lines only
 *               (no section markers, no directives; every non-empty body
 *               line is one narration line)
 *
 * Merge rules:
 * - The two files must contain exactly the same set of IDs
 * - Block order follows the visuals file
 * - IDs are required (no auto-numbering) and unique within each file
 *
 * The merged result is a plain RawBlock[], identical in shape to what
 * parseBlockFile produces for the legacy single-file format, so downstream
 * stages (compile/dict/assets/sync-lint) need no changes.
 */

import { readFileSync } from "node:fs";
import {
  BlockError,
  splitIntoSegments,
  parseTitleLine,
  type RawBlock,
} from "./blocks.js";
import { parseDirectives } from "./directives.js";
import { parseNarration, NarrationError, type NarrationLine } from "./narration.js";
import type { AnimationPreset, VisualMode } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visual half of a split block (everything except narration). */
interface VisualBlockPart {
  id: string;
  title: string;
  enter: AnimationPreset;
  exit: AnimationPreset;
  explicitDurationSec?: number;
  visualMode: VisualMode;
  imageSource?: string;
  videoSource?: string;
  htmlSource?: string;
  visualDescription: string;
  sourceLineIndex: number;
}

/** Narration half of a split block. */
interface NarrationBlockPart {
  id: string;
  narrationLines: NarrationLine[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readContent(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BlockError(`Failed to read block file "${filePath}": ${msg}`);
  }
}

/**
 * Require an explicit #Bxx ID on a block header.
 * Split files have no auto-numbering — IDs are how the two files align.
 */
function requireExplicitId(
  id: string | null,
  filePath: string,
  lineIndex: number,
): string {
  if (id === null) {
    throw new BlockError(
      `Block in "${filePath}" (near line ${lineIndex + 1}) is missing a #Bxx ID. ` +
        `Split files require explicit block IDs on every ">>>" header.`,
    );
  }
  return id;
}

/** Reject duplicate IDs within one file. */
function checkDuplicateIds(ids: string[], filePath: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new BlockError(
        `Duplicate block ID "${id}" in "${filePath}". Block IDs must be unique within a file.`,
      );
    }
    seen.add(id);
  }
}

// ---------------------------------------------------------------------------
// Visuals file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a split-format visuals file.
 *
 * Each block body is: directive lines (`@key: value`, right after the
 * header) followed by the visual description. The description starts at
 * the first non-empty, non-@ line and includes everything after it.
 */
export function parseVisualsFile(filePath: string): VisualBlockPart[] {
  const content = readContent(filePath);
  const segments = splitIntoSegments(content, filePath);
  const parts: VisualBlockPart[] = [];

  for (const segment of segments) {
    const { title, id } = parseTitleLine(segment.titleLine);
    const blockId = requireExplicitId(id, filePath, segment.lineIndex);

    // Find the first non-empty, non-directive body line: the description
    // starts there and runs to the end of the block.
    const descStartIdx = segment.bodyLines.findIndex((l) => {
      const trimmed = l.trim();
      return trimmed !== "" && !trimmed.startsWith("@");
    });

    const directiveLines =
      descStartIdx === -1
        ? segment.bodyLines
        : segment.bodyLines.slice(0, descStartIdx);
    const visualDescription =
      descStartIdx === -1
        ? ""
        : segment.bodyLines.slice(descStartIdx).join("\n").trim();

    if (visualDescription === "") {
      throw new BlockError(
        `Block ${blockId} in "${filePath}" has no visual description ` +
          `(near line ${segment.lineIndex + 1})`,
      );
    }

    const directives = parseDirectives(directiveLines);

    parts.push({
      id: blockId,
      title,
      enter: directives.enter,
      exit: directives.exit,
      ...(directives.explicitDurationSec !== undefined
        ? { explicitDurationSec: directives.explicitDurationSec }
        : {}),
      visualMode: directives.visualMode,
      ...(directives.imageSource !== undefined
        ? { imageSource: directives.imageSource }
        : {}),
      ...(directives.videoSource !== undefined
        ? { videoSource: directives.videoSource }
        : {}),
      ...(directives.htmlSource !== undefined
        ? { htmlSource: directives.htmlSource }
        : {}),
      visualDescription,
      sourceLineIndex: segment.lineIndex,
    });
  }

  checkDuplicateIds(parts.map((p) => p.id), filePath);
  return parts;
}

// ---------------------------------------------------------------------------
// Narration file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a split-format narration file.
 *
 * No section markers, no directives: every non-empty body line is one
 * narration line (`**highlight**` syntax unchanged).
 */
export function parseNarrationFile(filePath: string): NarrationBlockPart[] {
  const content = readContent(filePath);
  const segments = splitIntoSegments(content, filePath);
  const parts: NarrationBlockPart[] = [];

  for (const segment of segments) {
    const { id } = parseTitleLine(segment.titleLine);
    const blockId = requireExplicitId(id, filePath, segment.lineIndex);

    let narrationLines: NarrationLine[];
    try {
      narrationLines = parseNarration(segment.bodyLines.join("\n"));
    } catch (err) {
      if (err instanceof NarrationError) {
        throw new BlockError(
          `Block ${blockId} in "${filePath}" has no narration lines ` +
            `(near line ${segment.lineIndex + 1})`,
        );
      }
      throw err;
    }

    parts.push({ id: blockId, narrationLines });
  }

  checkDuplicateIds(parts.map((p) => p.id), filePath);
  return parts;
}

// ---------------------------------------------------------------------------
// Merge by ID
// ---------------------------------------------------------------------------

/**
 * Parse a visuals file and a narration file, then merge their blocks by ID.
 *
 * - The ID sets must match exactly; a mismatch reports which file has the
 *   block and which file is missing it.
 * - The merged block order follows the visuals file.
 * - RawBlock.sourceFilePath points at the visuals file, so relative asset
 *   paths (`./...` in directives and descriptions) resolve against the
 *   visuals file's directory, same as the legacy format.
 */
export function parseSplitFiles(
  visualPath: string,
  narrationPath: string,
): RawBlock[] {
  const visuals = parseVisualsFile(visualPath);
  const narrations = parseNarrationFile(narrationPath);

  const narrationById = new Map<string, NarrationBlockPart>();
  for (const part of narrations) {
    narrationById.set(part.id, part);
  }

  const visualIds = new Set(visuals.map((v) => v.id));

  const blocks: RawBlock[] = [];
  for (const visual of visuals) {
    const narration = narrationById.get(visual.id);
    if (!narration) {
      throw new BlockError(
        `Block ${visual.id} has visuals in "${visualPath}" but no narration in "${narrationPath}"`,
      );
    }
    blocks.push({
      id: visual.id,
      title: visual.title,
      enter: visual.enter,
      exit: visual.exit,
      ...(visual.explicitDurationSec !== undefined
        ? { explicitDurationSec: visual.explicitDurationSec }
        : {}),
      visualMode: visual.visualMode,
      ...(visual.imageSource !== undefined
        ? { imageSource: visual.imageSource }
        : {}),
      ...(visual.videoSource !== undefined
        ? { videoSource: visual.videoSource }
        : {}),
      ...(visual.htmlSource !== undefined
        ? { htmlSource: visual.htmlSource }
        : {}),
      visualDescription: visual.visualDescription,
      narrationLines: narration.narrationLines,
      sourceFilePath: visualPath,
      sourceLineIndex: visual.sourceLineIndex,
    });
  }

  for (const narration of narrations) {
    if (!visualIds.has(narration.id)) {
      throw new BlockError(
        `Block ${narration.id} has narration in "${narrationPath}" but no visuals in "${visualPath}"`,
      );
    }
  }

  return blocks;
}
