/**
 * AutoVideo — Block parser
 *
 * Reads content .md files, splits by `>>>` markers, parses directives,
 * extracts `--- visual ---` and `--- narration ---` sections,
 * and produces structured block data.
 *
 * PRD references: §3.3 (内容文件), §3.5 (块指令), §6.1 (compile steps 3-6)
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseDirectives, type ParsedDirectives } from "./directives.js";
import { parseNarration, type NarrationLine } from "./narration.js";
import { parseSplitFiles } from "./split.js";
import type { BlockEntry } from "./project.js";
import type { AnimationPreset, VisualMode } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawBlock {
  /** Block ID, e.g. "B01" */
  id: string;
  /** Block title (from >>> title line) */
  title: string;
  /** Parsed directives */
  enter: AnimationPreset;
  exit: AnimationPreset;
  explicitDurationSec?: number;
  visualMode: VisualMode;
  /** Image source path for image mode (e.g. "./assets/hero.png"), relative to script.md dir */
  imageSource?: string;
  /** Video source path for video mode (e.g. "./assets/demo.mp4"), relative to script.md dir */
  videoSource?: string;
  /** HTML source path for html mode (e.g. "./assets/arch.html"), relative to script.md dir */
  htmlSource?: string;
  /** Visual description text (raw, between --- visual --- and next --- or EOF) */
  visualDescription: string;
  /** Parsed narration lines */
  narrationLines: NarrationLine[];
  /** Absolute path to the source .md file this block came from */
  sourceFilePath: string;
  /** 0-based line number of the >>> line in the source file (for error reporting) */
  sourceLineIndex: number;
}

export class BlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockError";
  }
}

// ---------------------------------------------------------------------------
// Block splitting
// ---------------------------------------------------------------------------

/**
 * Split a content file into raw block segments.
 *
 * Each block starts with `>>>` on a line by itself (with optional title and #ID).
 * Content between two `>>>` lines (or from `>>>` to EOF) forms one block.
 *
 * Exported for reuse by the split-file parser (split.ts).
 */
export function splitIntoSegments(
  content: string,
  filePath: string,
): { titleLine: string; bodyLines: string[]; lineIndex: number }[] {
  const lines = content.split("\n");
  const segments: { titleLine: string; bodyLines: string[]; lineIndex: number }[] = [];

  let currentSegment: { titleLine: string; bodyLines: string[]; lineIndex: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith(">>>")) {
      // Start a new block
      if (currentSegment) {
        segments.push(currentSegment);
      }
      // Extract title (everything after >>>)
      const titlePart = trimmed.substring(3).trim();
      currentSegment = {
        titleLine: titlePart,
        bodyLines: [],
        lineIndex: i,
      };
    } else if (currentSegment) {
      currentSegment.bodyLines.push(lines[i]);
    }
    // Lines before the first >>> are ignored
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  if (segments.length === 0) {
    throw new BlockError(
      `No blocks found in "${filePath}". Each block must start with ">>>".`,
    );
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Find a section delimited by `--- <name> ---` and the next `---` line.
 * Returns the lines between the delimiters (exclusive).
 *
 * Supports both `--- visual ---` and `--- narration ---`.
 */
function extractSection(
  bodyLines: string[],
  sectionName: string,
  blockId: string,
  filePath: string,
  baseLineIndex: number,
): { text: string; startLine: number } {
  const openingMarker = `--- ${sectionName} ---`;
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < bodyLines.length; i++) {
    const trimmed = bodyLines[i].trim();
    if (trimmed === openingMarker && startIdx === -1) {
      startIdx = i;
    } else if (startIdx !== -1 && endIdx === -1) {
      // End on bare --- or any --- <name> --- section marker
      if (trimmed === "---" || /^--- \w+ ---$/.test(trimmed)) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) {
    throw new BlockError(
      `Block ${blockId} in "${filePath}" is missing "--- ${sectionName} ---" section ` +
        `(near line ${baseLineIndex + 1})`,
    );
  }

  if (endIdx === -1) {
    endIdx = bodyLines.length;
  }

  const sectionLines = bodyLines.slice(startIdx + 1, endIdx);
  return {
    text: sectionLines.join("\n"),
    startLine: baseLineIndex + startIdx + 1,
  };
}

// ---------------------------------------------------------------------------
// Title line parsing
// ---------------------------------------------------------------------------

/**
 * Parse the title line after `>>>`.
 *
 * Format: `Title Text #B01` or just `Title Text`
 * The #ID is optional; if present, it's extracted from the end.
 *
 * Exported for reuse by the split-file parser (split.ts).
 */
export function parseTitleLine(titleLine: string): { title: string; id: string | null } {
  // Match #Bxx pattern at end of line (with optional preceding whitespace)
  const idMatch = titleLine.match(/\s*#(B\d{2,})\s*$/);
  if (idMatch) {
    const id = idMatch[1];
    const title = titleLine.substring(0, titleLine.length - idMatch[0].length).trim();
    return { title: title || id, id };
  }
  return { title: titleLine.trim(), id: null };
}

// ---------------------------------------------------------------------------
// Single file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single content .md file into raw blocks.
 */
export function parseBlockFile(filePath: string): RawBlock[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BlockError(`Failed to read block file "${filePath}": ${msg}`);
  }

  const segments = splitIntoSegments(content, filePath);
  const blocks: RawBlock[] = [];

  for (const segment of segments) {
    const { title, id: explicitId } = parseTitleLine(segment.titleLine);
    const blockId = explicitId ?? `__auto__`; // Temporary; will be assigned later

    // Extract directive lines: everything before --- visual ---
    // Find where --- visual --- starts
    const visualMarkerIdx = segment.bodyLines.findIndex(
      (l) => l.trim() === "--- visual ---",
    );

    let directiveLines: string[];
    if (visualMarkerIdx !== -1) {
      directiveLines = segment.bodyLines.slice(0, visualMarkerIdx);
    } else {
      // No --- visual --- marker found; all lines before --- narration --- or all lines are directives
      const narrationMarkerIdx = segment.bodyLines.findIndex(
        (l) => l.trim() === "--- narration ---",
      );
      directiveLines = narrationMarkerIdx !== -1
        ? segment.bodyLines.slice(0, narrationMarkerIdx)
        : [];
    }

    // Parse directives
    const directives = parseDirectives(directiveLines);

    // Extract --- visual --- section
    const visual = extractSection(
      segment.bodyLines,
      "visual",
      blockId,
      filePath,
      segment.lineIndex,
    );

    // Extract --- narration --- section
    const narration = extractSection(
      segment.bodyLines,
      "narration",
      blockId,
      filePath,
      segment.lineIndex,
    );

    // Parse narration text into NarrationLine[]
    const narrationLines = parseNarration(narration.text);

    blocks.push({
      id: blockId,
      title,
      enter: directives.enter,
      exit: directives.exit,
      explicitDurationSec: directives.explicitDurationSec,
      visualMode: directives.visualMode,
      imageSource: directives.imageSource,
      videoSource: directives.videoSource,
      htmlSource: directives.htmlSource,
      visualDescription: visual.text.trim(),
      narrationLines,
      sourceFilePath: filePath,
      sourceLineIndex: segment.lineIndex,
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Multi-file merge with ID assignment
// ---------------------------------------------------------------------------

/**
 * Finalize block IDs across all parsed blocks:
 * - Explicit IDs (#B01) must be globally unique
 * - Blocks without explicit IDs are auto-numbered: B01, B02, ...,
 *   skipping already-used numbers
 */
function finalizeBlockIds(allBlocks: RawBlock[]): RawBlock[] {
  // Collect explicit IDs and check for conflicts
  const explicitIds = new Set<string>();
  for (const block of allBlocks) {
    if (block.id !== "__auto__") {
      if (explicitIds.has(block.id)) {
        throw new BlockError(
          `Duplicate block ID "${block.id}". Block IDs must be globally unique across all files.`,
        );
      }
      explicitIds.add(block.id);
    }
  }

  // Auto-assign IDs to blocks without explicit IDs
  // Use sequential numbering starting from 1, skipping already-used numbers
  let autoCounter = 1;
  for (const block of allBlocks) {
    if (block.id === "__auto__") {
      // Find the next available auto-ID
      while (explicitIds.has(`B${String(autoCounter).padStart(2, "0")}`)) {
        autoCounter++;
      }
      block.id = `B${String(autoCounter).padStart(2, "0")}`;
      autoCounter++;
    }
  }

  return allBlocks;
}

/**
 * Parse multiple content files and merge blocks in order.
 *
 * - Blocks are collected in file order, respecting the blocks array order
 * - Explicit IDs (#B01) are preserved
 * - Blocks without explicit IDs are auto-numbered: B01, B02, ...
 * - Explicit IDs must be globally unique
 *
 * @param blockPaths - Absolute paths to content .md files, in order
 * @returns Array of RawBlocks with IDs finalized
 * @throws BlockError on ID conflicts or missing sections
 */
export function parseAndMergeBlocks(blockPaths: string[]): RawBlock[] {
  return parseProjectBlocks(
    blockPaths.map((path) => ({ kind: "single", path }) as BlockEntry),
  );
}

/**
 * Parse block entries from a ResolvedProject and merge blocks in order.
 *
 * - `single` entries use the legacy one-file format (parseBlockFile)
 * - `split` entries parse a visuals file + a narration file and align
 *   blocks by #Bxx ID (see split.ts)
 *
 * ID finalization (uniqueness check + auto-numbering of legacy blocks
 * without explicit IDs) is shared with parseAndMergeBlocks.
 *
 * @param entries - Block entries in project.json order
 * @returns Array of RawBlocks with IDs finalized
 * @throws BlockError on ID conflicts, missing sections, or split-file mismatches
 */
export function parseProjectBlocks(entries: BlockEntry[]): RawBlock[] {
  const allBlocks: RawBlock[] = [];

  // Parse all entries in order
  for (const entry of entries) {
    if (entry.kind === "single") {
      allBlocks.push(...parseBlockFile(entry.path));
    } else {
      allBlocks.push(...parseSplitFiles(entry.visualPath, entry.narrationPath));
    }
  }

  return finalizeBlockIds(allBlocks);
}