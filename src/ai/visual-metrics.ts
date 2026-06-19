/**
 * Visual-quality metrics — deterministic, model-free (plan A).
 *
 * Two complementary signals decide whether an LLM-generated slide is "rich
 * enough" to ship, mirroring the rules in the component-generation system
 * prompt (large fonts, dense layout, full-canvas coverage):
 *
 *   1. Static metrics  — parse the TSX (no render): largest font size and the
 *      number of visible JSX elements.
 *   2. Image metrics   — render a still (caller supplies the PNG) and use
 *      ffmpeg edge-detection per grid cell to estimate how much of the canvas
 *      actually carries content vs. empty background.
 *
 * Failures are turned into concrete, actionable feedback text that is fed back
 * to the generator via the existing retryContext mechanism.
 */

import * as fs from "node:fs";
import { parse } from "@babel/parser";
import type { File as BabelFile } from "@babel/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualMetricsThresholds {
  /** Minimum height-relative coefficient for the largest font (e.g. 0.07) */
  minFontCoeff: number;
  /** Minimum number of visible JSX elements */
  minElements: number;
  /** Minimum fraction (0..1) of grid cells that must carry content */
  minCoverage: number;
}

export interface StaticMetrics {
  /** Largest effective font size in px (relative fonts resolved against dims) */
  maxFontPx: number;
  /** Whether at least one font was sized relative to width/height */
  usesRelativeFont: boolean;
  /** Hard-coded numeric fontSize values found (discouraged) */
  hardcodedFontSizes: number[];
  /** Count of visible JSX elements */
  elementCount: number;
}

export interface ImageMetrics {
  /** Fraction (0..1) of grid cells that carry visible content */
  coverage: number;
  /** Number of empty corner cells (0..4) */
  emptyCorners: number;
  /** Per-band content fraction (each 0..1) */
  bandDensity: { top: number; mid: number; bottom: number };
}

export interface VisualMetricsResult {
  pass: boolean;
  /** Actionable feedback for the generator (empty when pass === true) */
  feedback: string;
  static: StaticMetrics;
  image?: ImageMetrics;
}

// ---------------------------------------------------------------------------
// Static metrics (no render)
// ---------------------------------------------------------------------------

/** Is this AST node a reference to the `width`/`height` dimension prop? */
function dimensionRef(node: any): "width" | "height" | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === "Identifier" && (node.name === "width" || node.name === "height")) {
    return node.name;
  }
  if (node.type === "MemberExpression" && node.property?.type === "Identifier") {
    const name = node.property.name;
    if (name === "width" || name === "height") return name;
  }
  return null;
}

/**
 * Recursively scan a fontSize value subtree, collecting:
 *  - relative coefficients: `height * K` / `width * K` → { dim, coeff }
 *  - hard-coded numeric literals used directly as a size
 */
function scanFontValue(
  node: any,
  out: { relative: { dim: "width" | "height"; coeff: number }[]; hardcoded: number[] },
  depth = 0,
): void {
  if (!node || typeof node !== "object" || depth > 30) return;

  if (node.type === "NumericLiteral" || node.type === "Literal") {
    if (typeof node.value === "number") out.hardcoded.push(node.value);
    return;
  }

  if (node.type === "BinaryExpression" && node.operator === "*") {
    const left = node.left;
    const right = node.right;
    const ld = dimensionRef(left);
    const rd = dimensionRef(right);
    const lNum = (left?.type === "NumericLiteral" || left?.type === "Literal") ? left.value : null;
    const rNum = (right?.type === "NumericLiteral" || right?.type === "Literal") ? right.value : null;
    if (ld && typeof rNum === "number") {
      // `height * 0.09` — record the coefficient and stop; do NOT descend, or
      // the numeric operand would be misread as a hard-coded font size.
      out.relative.push({ dim: ld, coeff: rNum });
      return;
    }
    if (rd && typeof lNum === "number") {
      out.relative.push({ dim: rd, coeff: lNum });
      return;
    }
  }

  // Keep walking (handles Math.round(height*0.07), conditionals, etc.)
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "type") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) scanFontValue(item, out, depth + 1);
    } else if (child && typeof child === "object") {
      scanFontValue(child, out, depth + 1);
    }
  }
}

export function computeStaticMetrics(
  tsxPath: string,
  dims: { width: number; height: number },
): StaticMetrics {
  const code = fs.readFileSync(tsxPath, "utf-8");
  let ast: BabelFile;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch {
    // Parse failures are caught by the correctness gate; treat as empty here.
    return { maxFontPx: 0, usesRelativeFont: false, hardcodedFontSizes: [], elementCount: 0 };
  }

  const fontValues: { relative: { dim: "width" | "height"; coeff: number }[]; hardcoded: number[] } = {
    relative: [],
    hardcoded: [],
  };
  let elementCount = 0;

  function walk(node: any): void {
    if (!node || typeof node !== "object") return;

    if (node.type === "JSXOpeningElement") {
      const name = node.name?.type === "JSXIdentifier" ? node.name.name : "";
      if (name && name !== "Fragment") elementCount++;
    }

    // fontSize property inside any object expression
    if (
      (node.type === "ObjectProperty" || node.type === "Property") &&
      node.key &&
      ((node.key.type === "Identifier" && node.key.name === "fontSize") ||
        ((node.key.type === "StringLiteral" || node.key.type === "Literal") && node.key.value === "fontSize"))
    ) {
      scanFontValue(node.value, fontValues);
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "type") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) walk(item);
        }
      } else if (child && typeof child === "object" && child.type) {
        walk(child);
      }
    }
  }
  walk(ast);

  const relativePx = fontValues.relative.map((r) =>
    r.coeff * (r.dim === "width" ? dims.width : dims.height),
  );
  const maxFontPx = Math.max(0, ...relativePx, ...fontValues.hardcoded);

  return {
    maxFontPx,
    usesRelativeFont: fontValues.relative.length > 0,
    hardcodedFontSizes: fontValues.hardcoded,
    elementCount,
  };
}

// ---------------------------------------------------------------------------
// Image metrics (ffmpeg edge density per grid cell)
// ---------------------------------------------------------------------------

const GRID_COLS = 4;
const GRID_ROWS = 3;
/** Mean edge brightness (0..255) above which a cell is considered "content". */
const EDGE_CONTENT_THRESHOLD = 2.0;

/** Mean brightness of the edge map for a single crop of the image. */
async function cellEdgeMean(pngPath: string, x: number, y: number, w: number, h: number): Promise<number> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-i", pngPath,
        "-vf", `crop=${w}:${h}:${x}:${y},format=gray,edgedetect=low=0.1:high=0.4,signalstats,metadata=print`,
        "-f", "null", "-",
      ],
      { timeout: 15000, maxBuffer: 256 * 1024 },
    );
    const out = (stdout || "") + (stderr || "");
    const m = out.match(/lavfi\.signalstats\.YAVG=(\S+)/);
    return m ? parseFloat(m[1]) : 0;
  } catch {
    // If ffmpeg fails for a cell, treat it as content to avoid false negatives.
    return EDGE_CONTENT_THRESHOLD + 1;
  }
}

export async function computeImageMetrics(
  pngPath: string,
  dims: { width: number; height: number },
): Promise<ImageMetrics> {
  const cw = Math.floor(dims.width / GRID_COLS);
  const ch = Math.floor(dims.height / GRID_ROWS);

  // Build the cell list and measure edge density in parallel.
  const cells: { r: number; c: number; mean: Promise<number> }[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      cells.push({ r, c, mean: cellEdgeMean(pngPath, c * cw, r * ch, cw, ch) });
    }
  }
  const resolved = await Promise.all(
    cells.map(async (cell) => ({ r: cell.r, c: cell.c, content: (await cell.mean) > EDGE_CONTENT_THRESHOLD })),
  );

  const total = resolved.length;
  const contentCells = resolved.filter((c) => c.content).length;

  const rowFraction = (row: number) => {
    const inRow = resolved.filter((c) => c.r === row);
    return inRow.length ? inRow.filter((c) => c.content).length / inRow.length : 0;
  };

  const corners = [
    resolved.find((c) => c.r === 0 && c.c === 0),
    resolved.find((c) => c.r === 0 && c.c === GRID_COLS - 1),
    resolved.find((c) => c.r === GRID_ROWS - 1 && c.c === 0),
    resolved.find((c) => c.r === GRID_ROWS - 1 && c.c === GRID_COLS - 1),
  ];

  return {
    coverage: total ? contentCells / total : 0,
    emptyCorners: corners.filter((c) => c && !c.content).length,
    bandDensity: {
      top: rowFraction(0),
      mid: rowFraction(Math.floor(GRID_ROWS / 2)),
      bottom: rowFraction(GRID_ROWS - 1),
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration + feedback
// ---------------------------------------------------------------------------

/**
 * Run static + image metrics against the thresholds and build feedback text.
 * The PNG must already be rendered (so the same still can be reused by the
 * multimodal review step). When pngPath is omitted, only static metrics run.
 */
export async function assessVisualMetrics(args: {
  tsxPath: string;
  pngPath?: string;
  width: number;
  height: number;
  thresholds: VisualMetricsThresholds;
}): Promise<VisualMetricsResult> {
  const { tsxPath, pngPath, width, height, thresholds } = args;
  const staticM = computeStaticMetrics(tsxPath, { width, height });
  const image = pngPath ? await computeImageMetrics(pngPath, { width, height }) : undefined;

  const issues: string[] = [];
  const targetFontPx = Math.round(height * thresholds.minFontCoeff);

  if (staticM.maxFontPx < targetFontPx) {
    issues.push(
      `最大字号约 ${Math.round(staticM.maxFontPx)}px，低于要求的 ${targetFontPx}px（height×${thresholds.minFontCoeff}）。请把主标题/核心元素显著放大。`,
    );
  }
  if (!staticM.usesRelativeFont && staticM.hardcodedFontSizes.length > 0) {
    issues.push(
      `字号全部硬编码（${staticM.hardcodedFontSizes.slice(0, 6).join("、")}px），请改用基于 height 的比例（如 fontSize: height*0.07），以适配画布。`,
    );
  }
  if (staticM.elementCount < thresholds.minElements) {
    issues.push(
      `可见元素仅 ${staticM.elementCount} 个，过于单一。请补充结构：标题+副标题、多个卡片/分栏、配图、强调条或背景装饰。`,
    );
  }

  if (image) {
    if (image.coverage < thresholds.minCoverage) {
      issues.push(
        `内容仅覆盖约 ${Math.round(image.coverage * 100)}% 的画面（要求 ≥${Math.round(thresholds.minCoverage * 100)}%），画面偏空。请放大元素并均匀铺满画布，减小外边距。`,
      );
    }
    if (image.emptyCorners >= 3) {
      issues.push(`有 ${image.emptyCorners} 个空角，内容堆在中央。请向四周扩展布局或增加边角装饰。`);
    }
    const sparseBands: string[] = [];
    if (image.bandDensity.top < 0.25) sparseBands.push("上");
    if (image.bandDensity.mid < 0.25) sparseBands.push("中");
    if (image.bandDensity.bottom < 0.25) sparseBands.push("下");
    if (sparseBands.length > 0) {
      issues.push(`${sparseBands.join("、")}部区域几乎空白，请让上/中/下三带都有可见内容（底部 subtitleSafeBottom 区域除外）。`);
    }
  }

  if (issues.length === 0) {
    return { pass: true, feedback: "", static: staticM, image };
  }

  const feedback = [
    "Visual-quality check failed — 画面过于简单/空旷，请重写组件解决以下问题：",
    ...issues.map((s, i) => `${i + 1}. ${s}`),
    "保持技术契约不变（默认导出、AnimationProps、仅 import react/remotion），只改进视觉密度与布局。",
  ].join("\n");

  return { pass: false, feedback, static: staticM, image };
}
