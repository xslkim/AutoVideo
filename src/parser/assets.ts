/**
 * AutoVideo — Asset hash copy & inline
 *
 * Scans each block's `--- visual ---` description for local file paths,
 * computes content MD5 (first 8 chars), copies to build output,
 * replaces paths in descriptions, and optionally inlines source code snippets.
 *
 * PRD references: §3.6 (visual description), §4 (assets manifest), §6.1 step 8
 */

import {
  readFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, extname, relative } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Information about a parsed block needed for asset processing */
export interface BlockForAssets {
  /** Block ID (e.g. "B01") */
  id: string;
  /** Raw visual description text */
  visualDescription: string;
  /** Absolute path to the .md file this block came from */
  sourceFilePath: string;
  /** Image source path for image mode (e.g. "./assets/hero.png"), relative to source .md */
  imageSource?: string;
  /** Video source path for video mode (e.g. "./assets/demo.mp4"), relative to source .md */
  videoSource?: string;
}

/** Result of processing assets for all blocks */
export interface AssetProcessResult {
  /** Updated blocks with visual descriptions, imageSource and videoSource rewritten */
  blocks: Array<{ id: string; visualDescription: string; sourceFilePath: string; imageSource?: string; videoSource?: string }>;
  /** Assets manifest: relative POSIX path (to project.json dir) → "assets/{hash}.ext" */
  assets: Record<string, string>;
}

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex to match local file paths in visual descriptions.
 * Must be preceded by start-of-string or whitespace.
 * Path must start with ./ or ../, use ASCII path chars only, and end with a file extension.
 * Stops before full-width punctuation (e.g. 「./assets/B18.png：camchain.yaml」).
 * Capture group 2 = the path (without leading whitespace).
 */
export const LOCAL_PATH_REGEX = /(^|[\s(（])(\.\.?\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/gm;

/**
 * Regex to strip HTML comments (`<!-- ... -->`) from visual descriptions.
 * Comments are author-facing documentation only: they never participate in
 * asset scanning, path rewriting, or AI prompt generation.
 */
const VISUAL_COMMENT_REGEX = /<!--[\s\S]*?-->/g;

/**
 * Remove `<!-- ... -->` comment blocks from a visual description.
 * Unclosed `<!--` (authoring mistake) is stripped to end-of-string so its
 * content cannot leak into asset scanning either.
 */
export function stripVisualComments(text: string): string {
  return text.replace(VISUAL_COMMENT_REGEX, "").replace(/<!--[\s\S]*$/, "");
}

/**
 * Source code file extensions that may be inlined.
 */
const CODE_EXTENSIONS = new Set([
  ".py", ".ts", ".js", ".jsx", ".tsx", ".c", ".cpp", ".h", ".hpp",
  ".java", ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".kt",
  ".scala", ".sh", ".bash", ".zsh", ".fish", ".ps1",
  ".lua", ".r", ".R", ".m", ".sql", ".html", ".css", ".scss", ".less",
  ".yaml", ".yml", ".toml", ".json", ".xml", ".vue", ".svelte",
]);

/**
 * Regex to match line range references in visual descriptions.
 * Matches patterns like:
 *   "第 30-50 行", "第 30 行"
 *   "lines 30-50", "lines 30 to 50", "line 30"
 *   "行 30-50", "行 30"
 * Captures start line and optional end line (1-based).
 */
const LINE_RANGE_REGEXES = [
  // Chinese: 第 X-Y 行 / 第 X 行
  /第\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*行/,
  // English: lines X-Y / lines X to Y
  /lines?\s*(\d+)\s*(?:[-–—]|to)\s*(\d+)/i,
  // English: line X (single line)
  /lines?\s*(\d+)/i,
  // Short: 行 X-Y / 行 X
  /行\s*(\d+)(?:\s*[-–—]\s*(\d+))?/,
];

/**
 * Context lines to include around the specified range when inlining code.
 */
const CODE_CONTEXT_LINES = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute MD5 hash of file content, return first 8 hex characters.
 */
export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  const hash = createHash("md5").update(content).digest("hex");
  return hash.substring(0, 8);
}

/**
 * Convert a native file path to POSIX format (forward slashes).
 */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Get the relative POSIX path from projectDir to the given absolute path.
 */
function relativePosixPath(from: string, to: string): string {
  const rel = relative(from, to);
  return toPosix(rel);
}

/**
 * Check if a file extension is considered source code (eligible for inlining).
 */
export function isCodeFile(ext: string): boolean {
  return CODE_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Parse line range from a visual description that references a code file.
 * Returns [startLine, endLine] (1-based, inclusive) or null if no range found.
 */
export function parseLineRange(description: string): [number, number] | null {
  for (const regex of LINE_RANGE_REGEXES) {
    const match = description.match(regex);
    if (match) {
      const startLine = parseInt(match[1], 10);
      // Some patterns may not have group 2 (single line reference)
      const endLine = match[2] ? parseInt(match[2], 10) : startLine;
      if (endLine < startLine) return [endLine, startLine];
      return [startLine, endLine];
    }
  }
  return null;
}

/**
 * Extract code lines for inlining.
 * Takes the full file content, specified range, and context padding.
 * Returns the inlined code string wrapped in a code block.
 */
export function inlineCodeSnippet(
  fileContent: string,
  startLine: number,
  endLine: number,
  ext?: string,
  contextLines?: number,
): string {
  const ctx = contextLines ?? CODE_CONTEXT_LINES;
  const lines = fileContent.split("\n");

  // Convert to 0-based index, apply context padding, clamp
  const startIdx = Math.max(0, startLine - 1 - ctx);
  const endIdx = Math.min(lines.length - 1, endLine - 1 + ctx);

  const snippet = lines.slice(startIdx, endIdx + 1).join("\n");

  // Determine language hint from extension
  const langHint = (ext ?? "").replace(/^\./, "");
  const fence = "```";

  return `\n\n${fence}${langHint}\n${snippet}\n${fence}\n`;
}

/**
 * Ensure directory exists for a file path.
 */
function ensureDirForFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

// ---------------------------------------------------------------------------
// Internal: per-file processing info
// ---------------------------------------------------------------------------

interface FileRef {
  /** The raw path as found in description (e.g. "./assets/arch.png") */
  rawPath: string;
  /** Resolved absolute path */
  absPath: string;
  /** MD5 first 8 chars */
  hash: string;
  /** File extension including dot (e.g. ".png") */
  ext: string;
  /** Target name: "assets/{hash}.{ext}" */
  hashName: string;
}

// ---------------------------------------------------------------------------
// Main processing function
// ---------------------------------------------------------------------------

/**
 * Process assets referenced in block visual descriptions.
 *
 * For each block:
 * 1. Scan visual description for local file paths (./xxx or ../xxx)
 * 2. Resolve to absolute path relative to the block's source .md file
 * 3. Compute MD5 hash of file content (first 8 chars)
 * 4. Copy to <buildOutDir>/public/assets/{hash}.{ext}
 * 5. Replace path in description with "assets/{hash}.{ext}"
 * 6. For source code files with explicit line ranges, inline the snippet
 *
 * @param blocks - Array of blocks with visual descriptions and source file paths
 * @param projectDir - Absolute path to project.json directory (base for relative keys)
 * @param buildOutDir - Absolute path to build output directory
 * @returns Updated blocks and assets manifest
 */
export function processAssets(
  blocks: BlockForAssets[],
  projectDir: string,
  buildOutDir: string,
): AssetProcessResult {
  const assets: Record<string, string> = {};
  const assetsDir = resolve(buildOutDir, "public", "assets");

  // Ensure assets output directory exists
  mkdirSync(assetsDir, { recursive: true });

  // Global dedup: absPath → hashName (same file referenced by multiple blocks)
  const globalProcessed = new Map<string, string>();

  const updatedBlocks = blocks.map((block) => {
    let description = block.visualDescription;
    let imageSource = block.imageSource;
    let videoSource = block.videoSource;
    const sourceDir = dirname(block.sourceFilePath);

    // Collect paths from both visualDescription, imageSource, and videoSource
    const allRawPaths: string[] = [];
    const pathRegex = new RegExp(LOCAL_PATH_REGEX.source, "gm");
    const descMatches = [...description.matchAll(pathRegex)];
    for (const m of descMatches) {
      allRawPaths.push(m[2]); // group 2 = the path
    }
    if (imageSource && /^\.\.?\//.test(imageSource)) {
      allRawPaths.push(imageSource);
    }
    if (videoSource && /^\.\.?\//.test(videoSource)) {
      allRawPaths.push(videoSource);
    }

    if (allRawPaths.length === 0) {
      return { id: block.id, visualDescription: description, sourceFilePath: block.sourceFilePath, imageSource, videoSource };
    }

    // Build unique file references for this block (dedup by absPath)
    const fileRefs: FileRef[] = [];
    const seenInBlock = new Map<string, FileRef>(); // absPath → FileRef
    // Track all (rawPath → hashName) for replacement, even duplicates
    const rawPathToHashName = new Map<string, string>();

    for (const rawPath of allRawPaths) {
      const absPath = resolve(sourceDir, rawPath);

      // Verify file exists
      if (!existsSync(absPath)) {
        throw new AssetError(
          `Block ${block.id}: referenced file not found: ${absPath} (from "${rawPath}" in ${block.sourceFilePath})`,
        );
      }

      // Get or create FileRef
      if (!seenInBlock.has(absPath)) {
        const ext = extname(absPath);

        // Check global dedup
        let hash: string;
        let hashName: string;
        if (globalProcessed.has(absPath)) {
          hashName = globalProcessed.get(absPath)!;
          hash = hashName.replace(/^assets\//, "").replace(/\.[^.]+$/, "");
        } else {
          hash = computeFileHash(absPath);
          hashName = `assets/${hash}${ext}`;

          // Copy to build output
          const destPath = resolve(buildOutDir, "public", hashName);
          ensureDirForFile(destPath);
          if (!existsSync(destPath)) {
            copyFileSync(absPath, destPath);
          }

          globalProcessed.set(absPath, hashName);

          // Add to assets manifest
          const relKey = relativePosixPath(projectDir, absPath);
          assets[relKey] = hashName;
        }

        const ref: FileRef = { rawPath, absPath, hash, ext, hashName };
        seenInBlock.set(absPath, ref);
        fileRefs.push(ref);
      }

      // Map rawPath → hashName for replacement (even if absPath was seen before)
      rawPathToHashName.set(rawPath, seenInBlock.get(absPath)!.hashName);
    }

    // Replace paths in description
    // Sort by rawPath length descending to avoid partial replacements
    const sortedPaths = [...rawPathToHashName.keys()].sort((a, b) => b.length - a.length);
    for (const rawPath of sortedPaths) {
      const hashName = rawPathToHashName.get(rawPath)!;
      // Escape special regex chars in the raw path
      const escaped = rawPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match: (start-of-string OR whitespace) + rawPath
      // Replace the path portion only, keeping the prefix
      const replaceRegex = new RegExp(
        `(^|[\\s])${escaped}`,
        "g",
      );
      description = description.replace(replaceRegex, `$1${hashName}`);
    }

    // For code files with explicit line ranges, inline the snippet
    for (const ref of fileRefs) {
      if (isCodeFile(ref.ext)) {
        const lineRange = parseLineRange(description);
        if (lineRange) {
          const [startLine, endLine] = lineRange;
          const fileContent = readFileSync(ref.absPath, "utf-8");
          const snippet = inlineCodeSnippet(
            fileContent, startLine, endLine, ref.ext, CODE_CONTEXT_LINES,
          );
          description += snippet;
        }
        // No line range → no inline, just hash copy
      }
    }

    // Rewrite imageSource if it was a local path
    let processedImageSource = imageSource;
    if (imageSource && rawPathToHashName.has(imageSource)) {
      processedImageSource = rawPathToHashName.get(imageSource);
    }

    // Rewrite videoSource if it was a local path
    let processedVideoSource = videoSource;
    if (videoSource && rawPathToHashName.has(videoSource)) {
      processedVideoSource = rawPathToHashName.get(videoSource);
    }

    return {
      id: block.id,
      visualDescription: description,
      sourceFilePath: block.sourceFilePath,
      ...(processedImageSource !== undefined ? { imageSource: processedImageSource } : {}),
      ...(processedVideoSource !== undefined ? { videoSource: processedVideoSource } : {}),
    };
  });

  return {
    blocks: updatedBlocks,
    assets,
  };
}