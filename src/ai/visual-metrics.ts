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
import { declaresSyncIntent } from "../compile/sync-lint.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Narration-sync contract (static, no render)
// ---------------------------------------------------------------------------

/**
 * When the description declares narration-following intent (跟随旁白 /
 * lineTimings / 旁白推进 …), the generated component MUST read
 * props.lineTimings. Otherwise its beats are hardcoded timestamps that drift
 * out of sync the moment the voiceover is re-synthesized — exactly the
 * failure this check exists to catch before a human ever watches the video.
 */
export function checkNarrationSyncContract(
  description: string,
  componentSource: string,
): { pass: boolean; feedback: string } {
  if (!declaresSyncIntent(description)) return { pass: true, feedback: "" };
  if (/\blineTimings\b/.test(componentSource)) return { pass: true, feedback: "" };
  return {
    pass: false,
    feedback:
      "视觉描述要求画面跟随旁白推进，但组件没有读取 props.lineTimings——硬编码的绝对时间戳会在旁白重新合成后错位。" +
      "请用 lineTimings（{ startSec, endSec }[]，块内相对秒，可直接与 frame / fps 比较）驱动高亮/推进节拍：" +
      "取最后一个 startSec <= t 的行（行间静音间隙保持上一行状态），再映射到对应视觉元素。",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualMetricsThresholds {
  /** Minimum height-relative coefficient for the largest font (e.g. 0.07) */
  minFontCoeff: number;
  /**
   * Minimum height-relative coefficient for the SMALLEST visible font.
   * Guards against captions and axis labels that are legible on a monitor but
   * unreadable on a phone — the largest-font check alone never catches those.
   */
  minAnyFontCoeff: number;
  /** Minimum number of visible JSX elements */
  minElements: number;
  /** Minimum fraction (0..1) of grid cells that must carry content */
  minCoverage: number;
  /** Maximum fraction (0..1) of grid cells that may carry content — above this the slide is too dense/cluttered */
  maxCoverage: number;
}

export interface StaticMetrics {
  /** Largest effective font size in px (relative fonts resolved against dims) */
  maxFontPx: number;
  /** Smallest effective font size in px, or 0 when nothing was measurable */
  minFontPx: number;
  /** Whether at least one font was sized relative to width/height */
  usesRelativeFont: boolean;
  /** Hard-coded numeric fontSize values found (discouraged) */
  hardcodedFontSizes: number[];
  /** Count of visible JSX elements */
  elementCount: number;
  /**
   * True only if EVERY fontSize usage could be resolved to a px value. When
   * false, maxFontPx is an underestimate (some sizes use expressions we can't
   * statically evaluate, e.g. Math.min(w,h)*k), so the font check must be
   * skipped to avoid false negatives.
   */
  fontFullyMeasured: boolean;
}

export interface ImageMetrics {
  /** Fraction (0..1) of grid cells that carry visible content */
  coverage: number;
  /** Number of empty corner cells (0..4) */
  emptyCorners: number;
  /** Per-band content fraction (each 0..1) */
  bandDensity: { top: number; mid: number; bottom: number };
  /**
   * Mean edge energy inside the subtitle-reserved strip. Flat backgrounds and
   * gradients score near zero; text or graphics down there score high and will
   * collide with the subtitles. Undefined when no strip was reserved.
   */
  safeBandEdge?: number;
  /**
   * Mean edge energy in the outermost few pixel columns on each side.
   * Text/card borders clipped by the canvas edge score high; decorative
   * glows/gradients that intentionally bleed off-canvas are low-frequency and
   * score near zero, so they don't trigger this.
   */
  edgeClip: { left: number; right: number };
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

/**
 * Result of statically evaluating a font-size expression.
 *
 * `values` holds every px value the expression can produce (a conditional
 * yields both branches); `relative` records whether any term came from the
 * `width` / `height` props rather than a bare literal.
 */
interface PxEval {
  values: number[];
  relative: boolean;
}

type SizeVars = Map<string, PxEval>;

/**
 * Evaluate a font-size expression to concrete px values.
 *
 * Returning `null` means "not statically knowable" — the caller then skips the
 * font gate rather than guessing. This matters: an earlier version walked the
 * subtree looking for numeric literals, so `rowFontSize * 1.22` measured as
 * 1.22px and polluted the metrics.
 */
function evalPx(
  node: any,
  dims: { width: number; height: number },
  vars: SizeVars,
  depth = 0,
): PxEval | null {
  if (!node || typeof node !== "object" || depth > 40) return null;

  switch (node.type) {
    case "NumericLiteral":
      return typeof node.value === "number" ? { values: [node.value], relative: false } : null;

    case "Literal":
      return typeof node.value === "number" ? { values: [node.value], relative: false } : null;

    case "StringLiteral": {
      // `fontSize: "48"` and `fontSize: "48px"` both appear in generated code.
      const n = Number(String(node.value).replace(/px$/i, ""));
      return Number.isFinite(n) ? { values: [n], relative: false } : null;
    }

    case "Identifier": {
      if (node.name === "width") return { values: [dims.width], relative: true };
      if (node.name === "height") return { values: [dims.height], relative: true };
      const known = vars.get(node.name);
      return known ? { values: [...known.values], relative: known.relative } : null;
    }

    case "MemberExpression": {
      const prop = node.property;
      if (prop?.type === "Identifier" && (prop.name === "width" || prop.name === "height")) {
        return {
          values: [prop.name === "width" ? dims.width : dims.height],
          relative: true,
        };
      }
      return null;
    }

    case "UnaryExpression": {
      if (node.operator !== "-") return null;
      const arg = evalPx(node.argument, dims, vars, depth + 1);
      return arg ? { values: arg.values.map((v) => -v), relative: arg.relative } : null;
    }

    case "BinaryExpression": {
      const left = evalPx(node.left, dims, vars, depth + 1);
      const right = evalPx(node.right, dims, vars, depth + 1);
      if (!left || !right) return null;

      const apply = (a: number, b: number): number | null => {
        switch (node.operator) {
          case "*": return a * b;
          case "/": return b === 0 ? null : a / b;
          case "+": return a + b;
          case "-": return a - b;
          default: return null;
        }
      };

      const values: number[] = [];
      for (const a of left.values) {
        for (const b of right.values) {
          const r = apply(a, b);
          if (r === null || !Number.isFinite(r)) return null;
          values.push(r);
        }
      }
      return { values, relative: left.relative || right.relative };
    }

    case "ConditionalExpression": {
      const yes = evalPx(node.consequent, dims, vars, depth + 1);
      const no = evalPx(node.alternate, dims, vars, depth + 1);
      if (!yes || !no) return null;
      return {
        values: [...yes.values, ...no.values],
        relative: yes.relative || no.relative,
      };
    }

    case "CallExpression": {
      const callee = node.callee;
      const isMathCall =
        callee?.type === "MemberExpression" &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "Math" &&
        callee.property?.type === "Identifier";
      if (!isMathCall) return null;

      const fn = callee.property.name as string;
      const args = (node.arguments ?? []).map((a: any) => evalPx(a, dims, vars, depth + 1));
      if (args.length === 0 || args.some((a: PxEval | null) => a === null)) return null;
      const resolved = args as PxEval[];
      const relative = resolved.some((a) => a.relative);

      if (fn === "round" || fn === "floor" || fn === "ceil" || fn === "abs") {
        const op = Math[fn as "round" | "floor" | "ceil" | "abs"];
        return { values: resolved[0].values.map((v) => op(v)), relative };
      }
      if (fn === "max" || fn === "min") {
        const all = resolved.flatMap((a) => a.values);
        return { values: [fn === "max" ? Math.max(...all) : Math.min(...all)], relative };
      }
      return null;
    }

    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
      return evalPx(node.expression, dims, vars, depth + 1);

    case "TemplateLiteral": {
      // `${titleSize}px`
      if (node.expressions?.length === 1) {
        return evalPx(node.expressions[0], dims, vars, depth + 1);
      }
      return null;
    }

    default:
      return null;
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
    return {
      maxFontPx: 0,
      minFontPx: 0,
      usesRelativeFont: false,
      hardcodedFontSizes: [],
      elementCount: 0,
      fontFullyMeasured: false,
    };
  }

  // Pass 1: resolve `const x = height*0.08` style size variables, so that
  // `fontSize: x` / `fontSize={x}` (very common in animation/SVG components)
  // can be measured instead of read as 0. Declarations are visited in source
  // order, so a variable may reference one declared above it.
  const varSizes: SizeVars = new Map();
  (function collectVars(node: any): void {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init) {
      const r = evalPx(node.init, dims, varSizes);
      if (r) varSizes.set(node.id.name, r);
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "type") continue;
      const child = node[key];
      if (Array.isArray(child)) for (const item of child) { if (item && typeof item === "object") collectVars(item); }
      else if (child && typeof child === "object") collectVars(child);
    }
  })(ast);

  const resolvedPx: number[] = [];
  const hardcoded: number[] = [];
  let usesRelativeFont = false;
  let unresolvedFont = false;
  let elementCount = 0;

  /** Record a fontSize value node (object-property or JSX-attribute). */
  function recordFont(value: any): void {
    if (!value) return;
    // `fontSize={x}` → JSX expression container
    const expr = value.type === "JSXExpressionContainer" ? value.expression : value;
    const r = evalPx(expr, dims, varSizes);
    if (!r) {
      // A fontSize we couldn't statically evaluate (a helper call, a value
      // read from an array of items, …). Mark measurement incomplete so the
      // font gate is skipped instead of firing on an underestimate.
      unresolvedFont = true;
      return;
    }
    // Ignore degenerate sizes: 0 is used to hide elements, and sub-pixel
    // values are never a real font size.
    const usable = r.values.filter((v) => v >= 1);
    if (usable.length === 0) return;

    resolvedPx.push(...usable);
    if (r.relative) {
      usesRelativeFont = true;
    } else {
      hardcoded.push(...usable);
    }
  }

  function walk(node: any): void {
    if (!node || typeof node !== "object") return;

    if (node.type === "JSXOpeningElement") {
      const name = node.name?.type === "JSXIdentifier" ? node.name.name : "";
      if (name && name !== "Fragment") elementCount++;
    }

    // fontSize as an object property: { fontSize: ... }
    if (
      (node.type === "ObjectProperty" || node.type === "Property") &&
      node.key &&
      ((node.key.type === "Identifier" && node.key.name === "fontSize") ||
        ((node.key.type === "StringLiteral" || node.key.type === "Literal") && node.key.value === "fontSize"))
    ) {
      recordFont(node.value);
    }

    // fontSize as a JSX attribute: <text fontSize={...}> (SVG)
    if (
      node.type === "JSXAttribute" &&
      node.name?.type === "JSXIdentifier" &&
      node.name.name === "fontSize"
    ) {
      recordFont(node.value);
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

  return {
    maxFontPx: resolvedPx.length ? Math.max(...resolvedPx) : 0,
    minFontPx: resolvedPx.length ? Math.min(...resolvedPx) : 0,
    usesRelativeFont,
    hardcodedFontSizes: [...new Set(hardcoded)].sort((a, b) => a - b),
    elementCount,
    fontFullyMeasured: !unresolvedFont,
  };
}

// ---------------------------------------------------------------------------
// Image metrics (ffmpeg edge density per grid cell)
// ---------------------------------------------------------------------------

const GRID_COLS = 4;
const GRID_ROWS = 3;
/** Mean edge brightness (0..255) above which a cell is considered "content". */
const EDGE_CONTENT_THRESHOLD = 2.0;
/**
 * Edge energy in the subtitle strip above which we call it an intrusion. Set
 * above the content threshold so a rounded card edge or a gradient seam that
 * happens to graze the line does not trigger a rewrite.
 */
const SAFE_BAND_EDGE_LIMIT = 3.0;
/** Width in px of the strips probed at the left/right canvas edges. */
const EDGE_CLIP_STRIP_PX = 6;
/**
 * Edge energy at the canvas edge above which content is considered clipped.
 * Calibrated on real slides: clipped card text scores 0.25–3.2, clean layouts
 * (including cards ~10px from the edge) score 0, and a decorative glow
 * bleeding off-canvas scores ~0.11.
 */
const EDGE_CLIP_LIMIT = 0.2;

/**
 * Mean brightness of the edge map for a single crop of the image.
 *
 * `onError` decides which way a measurement failure should lean — callers that
 * treat a high value as "bad" must not inherit the coverage check's optimistic
 * fallback.
 */
async function cellEdgeMean(
  pngPath: string,
  x: number,
  y: number,
  w: number,
  h: number,
  onError: number = EDGE_CONTENT_THRESHOLD + 1,
): Promise<number> {
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
    return onError;
  }
}

/**
 * Edge-density coverage over the *usable* canvas.
 *
 * `safeBottom` pixels at the bottom are excluded from the grid: that band is
 * reserved for subtitles, so counting it would permanently report the bottom
 * third as empty and push the model to put content under the subtitles.
 */
export async function computeImageMetrics(
  pngPath: string,
  dims: { width: number; height: number; safeBottom?: number },
): Promise<ImageMetrics> {
  const safeBottom = Math.max(0, Math.min(dims.safeBottom ?? 0, Math.floor(dims.height * 0.5)));
  const usableHeight = dims.height - safeBottom;
  const cw = Math.floor(dims.width / GRID_COLS);
  const ch = Math.floor(usableHeight / GRID_ROWS);

  // Build the cell list and measure edge density in parallel.
  const cells: { r: number; c: number; mean: Promise<number> }[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      cells.push({ r, c, mean: cellEdgeMean(pngPath, c * cw, r * ch, cw, ch) });
    }
  }
  const safeBandEdge =
    safeBottom > 0
      ? await cellEdgeMean(pngPath, 0, usableHeight, dims.width, safeBottom, 0)
      : undefined;

  // Clipping probes lean optimistic on measurement failure (onError = 0):
  // a broken ffmpeg run must not flag a slide as clipped.
  const [edgeClipLeft, edgeClipRight] = await Promise.all([
    cellEdgeMean(pngPath, 0, 0, EDGE_CLIP_STRIP_PX, usableHeight, 0),
    cellEdgeMean(pngPath, dims.width - EDGE_CLIP_STRIP_PX, 0, EDGE_CLIP_STRIP_PX, usableHeight, 0),
  ]);

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
    ...(safeBandEdge !== undefined ? { safeBandEdge } : {}),
    edgeClip: { left: edgeClipLeft, right: edgeClipRight },
  };
}

// ---------------------------------------------------------------------------
// Orchestration + feedback
// ---------------------------------------------------------------------------

/**
 * Run static + image metrics against the thresholds and build feedback text.
 * The PNG must already be rendered (so the same still can be reused by the
 * multimodal review step). When pngPath is omitted, only static metrics run.
 *
 * `skipStaticMetrics` is for assembly-mode wrappers (src/ai/assembly-wrapper.ts):
 * those are machine-generated thin forwarders, so single-file source analysis
 * (element count, font floors) always misfires on them. The rendered-PNG
 * coverage/edge metrics still run — they measure the actual output, not the
 * source. Free-generation callers never pass it and are unaffected.
 */
export async function assessVisualMetrics(args: {
  tsxPath: string;
  pngPath?: string;
  width: number;
  height: number;
  thresholds: VisualMetricsThresholds;
  /** Pixels reserved for subtitles; excluded from the coverage grid. */
  safeBottom?: number;
  /** Skip all source-level static metrics (assembly-mode thin wrappers). */
  skipStaticMetrics?: boolean;
}): Promise<VisualMetricsResult> {
  const { tsxPath, pngPath, width, height, thresholds, safeBottom, skipStaticMetrics } = args;
  const staticM: StaticMetrics = skipStaticMetrics
    ? {
        maxFontPx: 0,
        minFontPx: 0,
        usesRelativeFont: false,
        hardcodedFontSizes: [],
        elementCount: 0,
        fontFullyMeasured: false,
      }
    : computeStaticMetrics(tsxPath, { width, height });
  const image = pngPath
    ? await computeImageMetrics(pngPath, { width, height, safeBottom })
    : undefined;

  const issues: string[] = [];
  const targetFontPx = Math.round(height * thresholds.minFontCoeff);

  if (!skipStaticMetrics) {
    // Only apply the font check when EVERY fontSize could be resolved. If any
    // size uses an expression we can't evaluate (Math.min(w,h)*k, calls, …),
    // maxFontPx is an underestimate → skip to avoid false negatives. Likewise
    // maxFontPx===0 means nothing measurable (dynamic/canvas text), not "tiny".
    if (staticM.fontFullyMeasured && staticM.maxFontPx > 0 && staticM.maxFontPx < targetFontPx) {
      issues.push(
        `最大字号约 ${Math.round(staticM.maxFontPx)}px，低于要求的 ${targetFontPx}px（height×${thresholds.minFontCoeff}）。请把主标题/核心元素显著放大。`,
      );
    }
    // Smallest font matters as much as the largest: a 90px title next to 18px
    // captions still reads as "unreadable on a phone".
    const floorFontPx = Math.round(height * thresholds.minAnyFontCoeff);
    if (staticM.fontFullyMeasured && staticM.minFontPx > 0 && staticM.minFontPx < floorFontPx) {
      issues.push(
        `最小字号约 ${Math.round(staticM.minFontPx)}px，低于可读下限 ${floorFontPx}px（height×${thresholds.minAnyFontCoeff}）。请提高所有说明文字/标注的字号，小字宁可删掉也不要缩小。`,
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
  }

  if (image) {
    if (image.coverage < thresholds.minCoverage) {
      issues.push(
        `内容仅覆盖约 ${Math.round(image.coverage * 100)}% 的画面（要求 ≥${Math.round(thresholds.minCoverage * 100)}%），画面偏空。请放大元素并均匀铺满画布，减小外边距。`,
      );
    }
    if (thresholds.maxCoverage > 0 && image.coverage > thresholds.maxCoverage) {
      issues.push(
        `内容覆盖约 ${Math.round(image.coverage * 100)}% 的画面（上限 ≤${Math.round(thresholds.maxCoverage * 100)}%），画面过于密集。请增大元素间距、缩小非核心元素、减少装饰性内容，让画面有呼吸感。`,
      );
    }
    const clippedSides: string[] = [];
    if (image.edgeClip.left > EDGE_CLIP_LIMIT) clippedSides.push("左");
    if (image.edgeClip.right > EDGE_CLIP_LIMIT) clippedSides.push("右");
    if (clippedSides.length > 0) {
      issues.push(
        `画布${clippedSides.join("、")}边缘检测到被裁切的内容（文字/卡片超出屏幕）。` +
          `常见原因：横向排列（时间轴、卡片行）的首尾元素以端点节点为中心居中，导致溢出。` +
          `请把首尾节点位置向内缩进，保证每个含文字元素的 left/right 边缘（中心 x ± 元素宽/2）都在 [0, width] 内；` +
          `或减小首尾卡片/标签宽度。装饰性光晕可以出血到画面外，但文字、卡片、标签必须完整可见。`,
      );
    }
    if (image.safeBandEdge !== undefined && image.safeBandEdge > SAFE_BAND_EDGE_LIMIT) {
      issues.push(
        `底部 subtitleSafeBottom（${safeBottom ?? 0}px）区域内有可见元素，会被字幕遮挡。请确保所有内容元素的底边不超过 height - subtitleSafeBottom（根容器仍为全 height，背景填满全屏，只有内容元素需要避让字幕区）。`,
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
    "Visual-quality check failed — 请重写组件解决以下问题：",
    ...issues.map((s, i) => `${i + 1}. ${s}`),
    "保持技术契约不变（默认导出、AnimationProps、仅 import react/remotion），只改进视觉密度与布局。",
  ].join("\n");

  return { pass: false, feedback, static: staticM, image };
}
