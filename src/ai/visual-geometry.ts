/**
 * Visual-geometry QA — deterministic DOM-level layout checks (plan A+
 * companion to visual-metrics.ts, SGA-style: measure the rendered page
 * instead of asking a model to eyeball a screenshot).
 *
 * Where visual-metrics.ts inspects the source TSX and a rendered PNG, this
 * module inspects the *live DOM* of the component rendered inside a real
 * Remotion bundle: puppeteer-core opens the bundle, seeks each sampled frame
 * via the same window.remotion_setFrame() protocol renderStill() uses, and
 * runs getBoundingClientRect() + getComputedStyle() over every element.
 *
 * Deterministic checks (no model, no pixels, pure geometry):
 *
 *   1. text-overlap         — two text-bearing elements whose rects intersect
 *   2. canvas-overflow      — text/media elements sticking out of the canvas
 *   3. safe-zone-intrusion  — content elements entering the subtitle band
 *   4. low-contrast         — text whose foreground ≈ its effective background
 *
 * Every finding carries the element label, pixel-level numbers and a concrete
 * fix direction, and is merged across frames into feedback text shaped for the
 * existing retryContext loop (same style as assessVisualMetrics).
 *
 * Pure/incremental: nothing here changes assessVisualMetrics behaviour; the
 * gate is only enforced where a caller explicitly invokes it.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { Browser, Page } from "puppeteer-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RectLite {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * One DOM element as measured in the page. Rects are canvas-relative
 * (the collector subtracts the #remotion-canvas origin, so the canvas top-left
 * is (0,0) and its size is the composition's width×height).
 */
export interface DomElementSnapshot {
  /** Index into DomGeometrySnapshot.elements (full, unfiltered DOM order). */
  index: number;
  /** Lowercased tag name ("div", "span", "text", "svg", …). */
  tag: string;
  /** Stable human-facing label: `<div#id.class> "own text…"`. */
  label: string;
  /** Own text content (direct text nodes only), trimmed. */
  ownText: string;
  rect: RectLite;
  /** Index of the parent element in the same array, or null. */
  parentIndex: number | null;
  fontSizePx: number | null;
  /** Computed `color` (raw css string). */
  colorCss: string | null;
  /** Computed `fill` (raw css string, SVG text). */
  fillCss: string | null;
  /** Own computed background-color (raw css string, may be transparent). */
  backgroundCss: string | null;
  /** Nearest ancestor's non-transparent background-color (raw css string). */
  ancestorBackgroundCss: string | null;
  /** Product of the element's and all ancestors' opacity (0..1). */
  effectiveOpacity: number;
  /** img / video / canvas. */
  media: boolean;
  /** Has own visible paint: solid bg, bg image, border or box-shadow. */
  visiblePaint: boolean;
  /**
   * False for elements filtered out by the collector (display:none, hidden,
   * ~zero opacity, sub-pixel rect, script/style). Kept in the array so
   * parentIndex links stay valid for ancestry checks.
   */
  kept: boolean;
}

export interface DomGeometrySnapshot {
  /** Canvas rect as laid out on the page (element rects are relative to it). */
  canvas: RectLite;
  /** First non-transparent background-color on body/html (raw css), if any. */
  pageBackgroundCss: string | null;
  elements: DomElementSnapshot[];
}

export type GeometryIssueKind =
  | "text-overlap"
  | "canvas-overflow"
  | "safe-zone-intrusion"
  | "low-contrast";

export interface GeometryIssue {
  kind: GeometryIssueKind;
  /** Element label (see DomElementSnapshot.label). */
  element: string;
  /** Second element label, for overlap pairs. */
  otherElement?: string;
  /** Pixel-level description with concrete numbers. */
  detail: string;
  /** Fix direction handed back to the generator. */
  suggestion: string;
  /** Composition frames where the issue was observed (ascending). */
  frames: number[];
  /** Higher = worse; merging keeps the most severe occurrence's detail. */
  severity: number;
}

export interface GeometryThresholds {
  /**
   * Flag a text/text pair when intersectionArea / min(areaA, areaB) exceeds
   * this. 0.2 ignores incidental edge touches while catching real collisions.
   */
  overlapMinRatio: number;
  /** Overflow (px past a canvas edge) below which nothing is reported. */
  overflowTolerancePx: number;
  /** Intrusion (px into the subtitle band) below which nothing is reported. */
  safeZoneTolerancePx: number;
  /**
   * WCAG contrast ratio below which text is flagged as unreadable. The task
   * targets *extremely* low contrast (foreground ≈ background), so the default
   * sits far below the WCAG AA bar of 4.5 — 2.0 catches "nearly invisible"
   * without nagging about merely-imperfect pairs.
   */
  minContrastRatio: number;
  /**
   * Elements covering at least this fraction of the canvas are treated as
   * full-bleed backgrounds and exempt from the safe-zone check (the layout
   * contract explicitly allows backgrounds to fill the whole canvas).
   */
  backgroundAreaRatio: number;
  /** Cap on reported issues; the rest are summarised as a count. */
  maxIssues: number;
}

export const DEFAULT_GEOMETRY_THRESHOLDS: GeometryThresholds = {
  overlapMinRatio: 0.2,
  overflowTolerancePx: 2,
  safeZoneTolerancePx: 2,
  minContrastRatio: 2.0,
  backgroundAreaRatio: 0.85,
  maxIssues: 12,
};

/** Elements whose effective opacity is below this never participate. */
const MIN_EFFECTIVE_OPACITY = 0.05;
/** Contrast is only judged for text that is actually on screen. */
const MIN_OPACITY_FOR_CONTRAST = 0.5;
/** Rects with IoU above this AND identical text are intentional layered
 * copies (karaoke highlight, stroke/fill pairs) — not overlaps. */
const DUPLICATE_LAYER_IOU = 0.85;

// ---------------------------------------------------------------------------
// Pure color helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSS color into RGBA. Handles rgb()/rgba() (incl. space-slash
 * syntax), 3/4/6/8-digit hex, "transparent" and a handful of named colors
 * that getComputedStyle may return for SVG fill ("none"). Returns null for
 * anything unrecognised — callers skip the check rather than guess.
 */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "none") return null;

  const fn = s.match(/^rgba?\((.+)\)$/);
  if (fn) {
    const body = fn[1].trim();
    // Both "rgb(1, 2, 3)" and "rgb(1 2 3 / 0.5)" syntaxes.
    const parts = body.includes(",")
      ? body.split(",").map((p) => p.trim())
      : body.split("/").flatMap((p, i) => (i === 0 ? p.trim().split(/\s+/) : [p.trim()]));
    if (parts.length < 3) return null;
    const num = (v: string): number => {
      const n = parseFloat(v);
      return v.endsWith("%") ? (n / 100) * 255 : n;
    };
    const alpha = (v: string): number => {
      const n = parseFloat(v);
      return v.endsWith("%") ? n / 100 : n;
    };
    const r = num(parts[0]);
    const g = num(parts[1]);
    const b = num(parts[2]);
    const a = parts.length >= 4 ? alpha(parts[3]) : 1;
    if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
    return {
      r: Math.max(0, Math.min(255, r)),
      g: Math.max(0, Math.min(255, g)),
      b: Math.max(0, Math.min(255, b)),
      a: Math.max(0, Math.min(1, a)),
    };
  }

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    const expand = (pair: string) => parseInt(pair.length === 1 ? pair + pair : pair, 16);
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0]),
        g: expand(h[1]),
        b: expand(h[2]),
        a: h.length === 4 ? expand(h[3]) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  return null;
}

/** Alpha-composite `fg` over an opaque-or-not `bg` (bg defaults to opaque). */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance(c: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

function rectArea(r: RectLite): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function intersectionArea(a: RectLite, b: RectLite): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function iou(a: RectLite, b: RectLite): number {
  const inter = intersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = rectArea(a) + rectArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** True when `ancestorIdx` is on `idx`'s parent chain (or equal to it). */
function isSameOrAncestor(
  elements: DomElementSnapshot[],
  ancestorIdx: number,
  idx: number,
): boolean {
  let cur: number | null = idx;
  let hops = 0;
  while (cur !== null && hops <= elements.length) {
    if (cur === ancestorIdx) return true;
    cur = elements[cur]?.parentIndex ?? null;
    hops++;
  }
  return false;
}

function fmtRect(r: RectLite): string {
  return `left=${Math.round(r.x)}, top=${Math.round(r.y)}, ${Math.round(r.width)}×${Math.round(r.height)}`;
}

function fmtColor(c: Rgba): string {
  return c.a >= 1
    ? `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
    : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a.toFixed(2)})`;
}

const KIND_TITLE: Record<GeometryIssueKind, string> = {
  "text-overlap": "文字重叠",
  "canvas-overflow": "溢出画布",
  "safe-zone-intrusion": "侵入字幕安全区",
  "low-contrast": "对比度过低",
};

const KIND_ORDER: Record<GeometryIssueKind, number> = {
  "text-overlap": 0,
  "canvas-overflow": 1,
  "safe-zone-intrusion": 2,
  "low-contrast": 3,
};

// ---------------------------------------------------------------------------
// Snapshot analyzer (pure, deterministic)
// ---------------------------------------------------------------------------

export interface AnalyzeGeometryOptions {
  /** Composition frame this snapshot was taken at (recorded on issues). */
  frame?: number;
  /** Pixels reserved for subtitles at the bottom; 0/undefined disables the safe-zone check. */
  safeBottom?: number;
  /** Theme/page background used when no ancestor/page background exists (e.g. "#1a1a2e"). */
  fallbackBackgroundCss?: string | null;
  thresholds?: Partial<GeometryThresholds>;
}

/**
 * Analyze one DOM snapshot and return deterministic, actionable issues.
 * Element order (DOM order) is stable for a given render, so the output is
 * byte-identical for identical input.
 */
export function analyzeGeometrySnapshot(
  snapshot: DomGeometrySnapshot,
  dims: { width: number; height: number },
  options: AnalyzeGeometryOptions = {},
): GeometryIssue[] {
  const t: GeometryThresholds = { ...DEFAULT_GEOMETRY_THRESHOLDS, ...options.thresholds };
  const frame = options.frame ?? 0;
  const safeBottom = Math.max(0, Math.min(options.safeBottom ?? 0, Math.floor(dims.height * 0.5)));
  const issues: GeometryIssue[] = [];

  const all = snapshot.elements;
  const kept = all.filter((e) => e.kept);
  const textEls = kept.filter((e) => e.ownText.length > 0);
  const canvasArea = dims.width * dims.height;

  // -- 1. Text/text overlap -------------------------------------------------
  for (let i = 0; i < textEls.length; i++) {
    for (let j = i + 1; j < textEls.length; j++) {
      const a = textEls[i];
      const b = textEls[j];
      // Parent/child pairs legitimately nest (e.g. `<div>标题<span>…</span></div>`).
      if (isSameOrAncestor(all, a.index, b.index) || isSameOrAncestor(all, b.index, a.index)) {
        continue;
      }
      const inter = intersectionArea(a.rect, b.rect);
      if (inter <= 0) continue;
      // Intentional layered duplicates (karaoke active/inactive copies,
      // stroke+fill pairs): identical text at (nearly) identical rects.
      if (a.ownText === b.ownText && iou(a.rect, b.rect) >= DUPLICATE_LAYER_IOU) continue;
      const ratio = inter / Math.max(1, Math.min(rectArea(a.rect), rectArea(b.rect)));
      if (ratio <= t.overlapMinRatio) continue;
      const iw = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);
      const ih = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);
      issues.push({
        kind: "text-overlap",
        element: a.label,
        otherElement: b.label,
        detail:
          `${a.label}（${fmtRect(a.rect)}）与 ${b.label}（${fmtRect(b.rect)}）相交 ` +
          `${Math.round(iw)}×${Math.round(ih)}px（占较小元素 ${Math.round(ratio * 100)}%）`,
        suggestion:
          "调整其中一方的 position/transform/尺寸，或用 frame 错开两者的入场时间，" +
          "确保同一时刻任何两个文字元素的矩形互不交叠。",
        frames: [frame],
        severity: ratio,
      });
    }
  }

  // -- 2. Canvas overflow (text + media only — decorative bleed is allowed) -
  for (const el of kept) {
    if (!el.ownText && !el.media) continue;
    const overLeft = -el.rect.x;
    const overTop = -el.rect.y;
    const overRight = el.rect.x + el.rect.width - dims.width;
    const overBottom = el.rect.y + el.rect.height - dims.height;
    const sides: string[] = [];
    let maxOver = 0;
    if (overLeft > t.overflowTolerancePx) { sides.push(`左侧超出 ${Math.round(overLeft)}px`); maxOver = Math.max(maxOver, overLeft); }
    if (overTop > t.overflowTolerancePx) { sides.push(`顶部超出 ${Math.round(overTop)}px`); maxOver = Math.max(maxOver, overTop); }
    if (overRight > t.overflowTolerancePx) { sides.push(`右侧超出 ${Math.round(overRight)}px（元素右缘 ${Math.round(el.rect.x + el.rect.width)} > ${dims.width}）`); maxOver = Math.max(maxOver, overRight); }
    if (overBottom > t.overflowTolerancePx) { sides.push(`底部超出 ${Math.round(overBottom)}px（元素底缘 ${Math.round(el.rect.y + el.rect.height)} > ${dims.height}）`); maxOver = Math.max(maxOver, overBottom); }
    if (sides.length === 0) continue;
    issues.push({
      kind: "canvas-overflow",
      element: el.label,
      detail:
        `${el.label}（${fmtRect(el.rect)}）${sides.join("、")}，画布为 ${dims.width}×${dims.height}`,
      suggestion:
        "把该元素的所有边缘收敛进 [0, width]×[0, height]：以中心定位的元素要校验 " +
        "centerX ± width/2（横向排列的首尾元素最容易以节点为中心居中而溢出），必要时减小宽度或 translate。",
      frames: [frame],
      severity: maxOver,
    });
  }

  // -- 3. Subtitle safe-zone intrusion --------------------------------------
  if (safeBottom > 0) {
    const bandTop = dims.height - safeBottom;
    for (const el of kept) {
      if (!el.ownText && !el.media && !el.visiblePaint) continue;
      // Full-bleed backgrounds are explicitly allowed to cover the band.
      if (rectArea(el.rect) >= t.backgroundAreaRatio * canvasArea) continue;
      if (el.rect.y >= dims.height) continue; // fully below canvas → overflow check owns it
      const depth = Math.min(el.rect.y + el.rect.height, dims.height) - bandTop;
      if (depth <= t.safeZoneTolerancePx) continue;
      issues.push({
        kind: "safe-zone-intrusion",
        element: el.label,
        detail:
          `${el.label}（${fmtRect(el.rect)}）底缘 ${Math.round(el.rect.y + el.rect.height)}px ` +
          `侵入底部字幕安全区 ${Math.round(depth)}px（安全区起点 height - subtitleSafeBottom = ${Math.round(bandTop)}px）`,
        suggestion:
          "把所有内容元素的底边收敛到 height - subtitleSafeBottom 之上（用 availH = height - subtitleSafeBottom " +
          "计算纵向布局）；只有全屏背景允许铺满字幕区。",
        frames: [frame],
        severity: depth,
      });
    }
  }

  // -- 4. Extremely low contrast --------------------------------------------
  const pageBg = parseCssColor(snapshot.pageBackgroundCss);
  const fallbackBg = parseCssColor(options.fallbackBackgroundCss);
  const baseBg = pageBg ?? fallbackBg;
  if (baseBg) {
    for (const el of textEls) {
      if (el.effectiveOpacity < MIN_OPACITY_FOR_CONTRAST) continue;
      // SVG text paints with `fill`; HTML text with `color`. (Computed `fill`
      // exists on HTML elements too — always the initial black — so it must
      // only win for actual SVG text nodes.)
      const isSvgText = el.tag === "text" || el.tag === "tspan";
      const fgRaw = (isSvgText ? parseCssColor(el.fillCss) : null) ?? parseCssColor(el.colorCss);
      if (!fgRaw) continue;
      const ancestorBg = parseCssColor(el.ancestorBackgroundCss);
      const bg = ancestorBg ? compositeOver(ancestorBg, baseBg) : baseBg;
      const fg = fgRaw.a < 1 ? compositeOver(fgRaw, bg) : fgRaw;
      const ratio = contrastRatio(fg, bg);
      if (ratio >= t.minContrastRatio) continue;
      issues.push({
        kind: "low-contrast",
        element: el.label,
        detail:
          `${el.label} 文字色 ${fmtColor(fgRaw)} 与背景 ${fmtColor(bg)} 的对比度仅 ` +
          `${ratio.toFixed(2)}:1（阈值 ${t.minContrastRatio.toFixed(2)}:1，字号约 ${Math.round(el.fontSizePx ?? 0)}px）`,
        suggestion:
          "拉大明度差：文字用 theme.colors.fg / accent，或给文字加不透明底色卡片、加深背景；" +
          "半透明文字先提高 opacity。",
        frames: [frame],
        severity: t.minContrastRatio - ratio,
      });
    }
  }

  // Deterministic order: kind, then severity (desc), then label.
  issues.sort(
    (x, y) =>
      KIND_ORDER[x.kind] - KIND_ORDER[y.kind] ||
      y.severity - x.severity ||
      x.element.localeCompare(y.element) ||
      (x.otherElement ?? "").localeCompare(y.otherElement ?? ""),
  );
  return issues.slice(0, Math.max(1, t.maxIssues));
}

// ---------------------------------------------------------------------------
// Cross-frame merge
// ---------------------------------------------------------------------------

/**
 * Merge per-frame issue lists. The same logical issue (same kind + same
 * element pair) appearing on several frames is reported once, with every
 * frame number attached and the detail taken from the most severe occurrence.
 */
export function mergeFrameIssues(perFrame: { frame: number; issues: GeometryIssue[] }[]): GeometryIssue[] {
  const byKey = new Map<string, GeometryIssue>();
  for (const { issues } of perFrame) {
    for (const issue of issues) {
      const key = `${issue.kind}|${issue.element}|${issue.otherElement ?? ""}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...issue, frames: [...issue.frames] });
        continue;
      }
      for (const f of issue.frames) {
        if (!existing.frames.includes(f)) existing.frames.push(f);
      }
      existing.frames.sort((a, b) => a - b);
      if (issue.severity > existing.severity) {
        existing.severity = issue.severity;
        existing.detail = issue.detail;
      }
    }
  }
  return [...byKey.values()].sort(
    (x, y) =>
      KIND_ORDER[x.kind] - KIND_ORDER[y.kind] ||
      y.severity - x.severity ||
      x.element.localeCompare(y.element) ||
      (x.otherElement ?? "").localeCompare(y.otherElement ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Feedback text
// ---------------------------------------------------------------------------

/**
 * Build the deterministic feedback block fed into the generator's
 * retryContext (same shape as assessVisualMetrics feedback).
 */
export function geometryIssuesToFeedback(issues: GeometryIssue[]): string {
  if (issues.length === 0) return "";
  const lines = [
    "Geometry check failed — 确定性几何扫描（在渲染页面上逐帧实测 DOM 矩形）发现以下布局问题：",
  ];
  issues.forEach((issue, i) => {
    const frames = [...new Set(issue.frames)].sort((a, b) => a - b);
    const where = frames.length > 0 ? `（第 ${frames.join("、")} 帧）` : "";
    lines.push(
      `${i + 1}. 【${KIND_TITLE[issue.kind]}】${issue.detail}${where}。建议：${issue.suggestion}`,
    );
  });
  lines.push(
    "保持技术契约不变（默认导出、AnimationProps、仅 import react/remotion），" +
      "只调整元素的定位、尺寸、入场时序或配色来消除上述几何冲突。",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// In-page collector
// ---------------------------------------------------------------------------

/**
 * Source of the function that runs INSIDE the headless page.
 *
 * It is shipped to the browser as a string (`page.evaluate("(" + src + ")()")`)
 * instead of a function reference on purpose: under tsx/vitest the module is
 * transpiled by esbuild, whose keepNames pass rewrites inner functions with a
 * `__name(...)` helper — puppeteer then serializes that broken source into a
 * page where `__name` does not exist. A string constant is immune.
 *
 * The code must stay self-contained plain JS: no closures, no imports, and no
 * template literals (backticks/`${}`) so it can live inside a TS template
 * literal without escaping.
 *
 * The collector measures every element under the Remotion canvas
 * (#remotion-canvas, falling back to #video-container/body) and returns a
 * plain JSON DomGeometrySnapshot. All analysis happens Node-side in
 * analyzeGeometrySnapshot so the rules stay unit-testable; this only gathers
 * raw facts. Rects are normalized to canvas coordinates (top-left = 0,0).
 */
export const COLLECT_DOM_GEOMETRY_SOURCE: string = `
function collectDomGeometryInPage() {
  function alphaOf(css) {
    if (!css) return 0;
    var s = String(css).trim().toLowerCase();
    if (s === "transparent" || s === "none") return 0;
    var m = s.match(/^rgba?\\((.+)\\)$/);
    if (!m) return 1; // named/hex color -> opaque
    var body = m[1];
    var parts = body.indexOf(",") >= 0
      ? body.split(",").map(function (p) { return p.trim(); })
      : body.split("/").flatMap(function (p, i) {
          return i === 0 ? p.trim().split(/\\s+/) : [p.trim()];
        });
    if (parts.length < 4) return 1; // rgb() has no alpha channel
    var a = parseFloat(parts[3]);
    return isFinite(a) ? a : 1;
  }

  var canvas =
    document.getElementById("remotion-canvas") ||
    document.getElementById("video-container") ||
    document.body;
  var canvasRect = canvas.getBoundingClientRect();

  // Page background: first non-transparent background on body / html.
  var pageBackgroundCss = null;
  var roots = [document.body, document.documentElement];
  for (var ri = 0; ri < roots.length; ri++) {
    if (!roots[ri]) continue;
    var rootBg = getComputedStyle(roots[ri]).backgroundColor;
    if (alphaOf(rootBg) > 0) {
      pageBackgroundCss = rootBg;
      break;
    }
  }

  var SKIP_TAGS = { script: 1, style: 1, link: 1, meta: 1, title: 1, head: 1, noscript: 1 };
  var MEDIA_TAGS = { img: 1, video: 1, canvas: 1 };
  var nodes = Array.prototype.slice.call(canvas.querySelectorAll("*"));
  var nodeIndex = new Map();
  for (var ni = 0; ni < nodes.length; ni++) nodeIndex.set(nodes[ni], ni);

  var elements = nodes.map(function (el, index) {
    var tag = el.tagName.toLowerCase();
    var cs = getComputedStyle(el);
    var box = el.getBoundingClientRect();

    // Own text: direct text-node children only (excludes descendants' text).
    var ownText = "";
    for (var ci = 0; ci < el.childNodes.length; ci++) {
      var child = el.childNodes[ci];
      if (child.nodeType === 3) ownText += child.textContent || "";
    }
    ownText = ownText.replace(/\\s+/g, " ").trim();

    // Effective opacity: product of this element's and ancestors' opacity.
    var effectiveOpacity = 1;
    var ancestorBackgroundCss = null;
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var c = getComputedStyle(cur);
      var o = parseFloat(c.opacity);
      if (isFinite(o)) effectiveOpacity *= o;
      if (ancestorBackgroundCss === null && cur !== el && alphaOf(c.backgroundColor) > 0) {
        ancestorBackgroundCss = c.backgroundColor;
      }
      cur = cur.parentElement;
    }

    var borderMax = Math.max(
      parseFloat(cs.borderTopWidth) || 0,
      parseFloat(cs.borderRightWidth) || 0,
      parseFloat(cs.borderBottomWidth) || 0,
      parseFloat(cs.borderLeftWidth) || 0
    );
    var visiblePaint =
      alphaOf(cs.backgroundColor) > 0 ||
      cs.backgroundImage !== "none" ||
      cs.boxShadow !== "none" ||
      (borderMax > 0 && cs.borderTopStyle !== "none" && cs.borderTopStyle !== "hidden");

    var kept =
      !SKIP_TAGS[tag] &&
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      cs.visibility !== "collapse" &&
      effectiveOpacity >= 0.05 &&
      box.width >= 1 &&
      box.height >= 1;

    var id = el.getAttribute("id");
    var cls = (el.getAttribute("class") || "").trim().split(/\\s+/)[0] || "";
    var snippet = ownText.length > 18 ? ownText.slice(0, 18) + "\\u2026" : ownText;
    var label =
      "<" + tag + (id ? "#" + id : "") + (cls ? "." + cls : "") + ">" +
      (snippet ? " \\u0022" + snippet.split('"').join("'") + "\\u0022" : "");

    var parentIndex = null;
    var parent = el.parentElement;
    if (parent && nodeIndex.has(parent)) parentIndex = nodeIndex.get(parent);

    var fontSize = parseFloat(cs.fontSize);

    return {
      index: index,
      tag: tag,
      label: label,
      ownText: ownText,
      rect: {
        x: box.x - canvasRect.x,
        y: box.y - canvasRect.y,
        width: box.width,
        height: box.height,
      },
      parentIndex: parentIndex,
      fontSizePx: isFinite(fontSize) ? fontSize : null,
      colorCss: cs.color || null,
      fillCss: cs.fill || null,
      backgroundCss: cs.backgroundColor || null,
      ancestorBackgroundCss: ancestorBackgroundCss,
      effectiveOpacity: effectiveOpacity,
      media: !!MEDIA_TAGS[tag],
      visiblePaint: visiblePaint,
      kept: kept,
    };
  });

  return {
    canvas: { x: 0, y: 0, width: canvasRect.width, height: canvasRect.height },
    pageBackgroundCss: pageBackgroundCss,
    elements: elements,
  };
}
`;


// ---------------------------------------------------------------------------
// Browser orchestration (puppeteer-core + the Remotion bundle protocol)
// ---------------------------------------------------------------------------

export interface GeometryScanOptions {
  /**
   * Component TSX to QA. The module bundles it with a generated
   * registerRoot() harness (composition id "GeometryQA") — fully
   * self-contained; requires buildOutDir/width/height/fps.
   */
  tsxPath?: string;
  /**
   * Reuse an existing Remotion bundle instead of bundling: a local bundle
   * directory (e.g. the one renderComponentStill built at
   * `<still.tempDir>/bundle`) or an http(s) serve URL. The composition is
   * discovered via window.remotion_getCompositionNames() unless
   * compositionId is given.
   */
  serveUrl?: string;
  /** Composition id inside a reused bundle; defaults to the first one. */
  compositionId?: string;
  /** Scratch directory for the generated harness + bundle (tsxPath mode). */
  buildOutDir?: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Harness duration (seconds, tsxPath mode). Default 5 — mirrors the smoke still. */
  durationSec?: number;
  /** Theme injected into the component's props (tsxPath mode). */
  theme?: Record<string, unknown>;
  /** Narration timings injected into props.lineTimings (tsxPath mode). */
  lineTimings?: { startSec: number; endSec: number }[];
  /** Real subtitle safe zone injected into props (tsxPath mode; default 15% height). */
  subtitleSafeBottom?: number;
  /**
   * Fractions (0..1) of the timeline to scan, one DOM sweep each.
   * Default [0.5] (mid-frame, matching the metrics still).
   */
  frameFractions?: number[];
  /** Subtitle band height in px used by the safe-zone check (default: subtitleSafeBottom ?? 0). */
  safeBottom?: number;
  /** Theme background color, last-resort background for the contrast check. */
  backgroundColor?: string;
  thresholds?: Partial<GeometryThresholds>;
  /** Explicit Chrome/Headless-Shell path (overrides env + auto-resolution). */
  browserExecutable?: string;
  /** Per-phase timeout (page load, ready-wait, seek). Default 30000. */
  timeoutMs?: number;
  projectRoot?: string;
}

export interface GeometryScanResult {
  /** False when the scan could not run at all (see skipped/error). */
  ok: boolean;
  /**
   * True when the scan was skipped due to an environment problem (no browser,
   * bundle failure, timeout). Geometry QA must never block the pipeline on
   * infrastructure issues — assessVisualGeometry maps this to pass:true.
   */
  skipped?: boolean;
  error?: string;
  issues: GeometryIssue[];
  framesScanned: number[];
  /** Canvas dimensions the issues were computed against. */
  dims?: { width: number; height: number; safeBottom: number };
}

export interface VisualGeometryResult {
  pass: boolean;
  /** Actionable feedback for the retryContext loop ("" when pass). */
  feedback: string;
  issues: GeometryIssue[];
  framesScanned?: number[];
  skipped?: boolean;
  error?: string;
}

const QA_COMPOSITION_ID = "GeometryQA";

/** Browser lookup chain: explicit → env → Remotion's headless shell → system. */
async function resolveGeometryBrowserExecutable(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  try {
    const renderer = await import("@remotion/renderer");
    const status = await renderer.ensureBrowser();
    if (status.type === "user-defined-path" || status.type === "local-puppeteer-browser") {
      return status.path;
    }
  } catch {
    // fall through to system lookup
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const { stdout } = await execFileAsync("which", [candidate], { timeout: 5000 });
      const resolved = stdout.trim().split("\n")[0]?.trim();
      if (resolved) return resolved;
    } catch {
      // try next
    }
  }
  throw new Error(
    "No Chrome executable found for geometry scan (set browserExecutable or PUPPETEER_EXECUTABLE_PATH)",
  );
}

/** Minimal static file server for a local bundle dir (127.0.0.1, random port). */
function serveStaticDir(rootDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
  };
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.resolve(root, rel);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        res.writeHead(301, { location: urlPath.replace(/\/?$/, "/") + "index.html" }).end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "no-store",
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("geometry QA static server: no address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** registerRoot harness for tsxPath mode (mirrors validate.ts's smoke root). */
function generateGeometryQaRoot(
  componentRelPath: string,
  options: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    theme?: Record<string, unknown>;
    lineTimings?: { startSec: number; endSec: number }[];
    subtitleSafeBottom?: number;
  },
): string {
  const { width, height, fps, durationSec } = options;
  const safeBottom = options.subtitleSafeBottom ?? Math.round(height * 0.15);
  const lineTimingsJson = JSON.stringify(options.lineTimings ?? []);
  const totalFrames = Math.max(1, Math.floor(durationSec * fps));
  const defaultTheme = options.theme ?? {
    name: "dark-code",
    colors: { bg: "#1a1a2e", fg: "#e0e0e0", accent: "#64ffda", muted: "#6c6c8a", code: { bg: "#16213e", fg: "#e0e0e0", keyword: "#c792ea", string: "#c3e88d", comment: "#546e7a" } },
    fonts: { sans: "Inter, sans-serif", mono: "JetBrains Mono, monospace" },
    spacing: { unit: 8 },
    subtitle: { fontFamily: "Noto Sans SC, sans-serif", fontSizePct: 0.035, lineHeight: 1.4, maxWidthPct: 0.8, backgroundColor: "rgba(0,0,0,0.7)", paddingPx: 12 },
  };
  return `// Auto-generated geometry-QA harness (mirrors validate.ts's smoke root)
import React from "react";
import { Composition, useCurrentFrame, useVideoConfig, registerRoot } from "remotion";
import Component from "${componentRelPath}";
const theme = ${JSON.stringify(defaultTheme, null, 2)};
const lineTimings = ${lineTimingsJson};
const QaComp: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  return React.createElement(Component, {
    frame, durationInFrames: ${totalFrames}, width, height,
    subtitleSafeBottom: ${safeBottom}, theme, fps, lineTimings,
  });
};
export const RemotionRoot: React.FC = () => {
  return React.createElement(Composition, {
    id: "${QA_COMPOSITION_ID}", component: QaComp,
    durationInFrames: ${totalFrames}, fps: ${fps}, width: ${width}, height: ${height},
  });
};
registerRoot(RemotionRoot);
`;
}

/** Symlink the project node_modules into the bundle dir so the bundler resolves react/remotion. */
function ensureNodeModulesLink(outDir: string, projectRoot?: string): void {
  const nmPath = path.join(outDir, "node_modules");
  if (fs.existsSync(nmPath)) return;
  const rootNm = path.join(projectRoot ?? process.cwd(), "node_modules");
  if (!fs.existsSync(rootNm)) return;
  try {
    fs.symlinkSync(rootNm, nmPath, "junction");
  } catch {
    // best effort — the bundler also walks up from the entry point
  }
}

/** Wait until the bundle reports the frame settled, or the render cancelled. */
async function waitRemotionReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    "window.remotion_renderReady === true || window.remotion_cancelledError !== undefined",
    { timeout: timeoutMs, polling: 100 },
  );
  const cancelled = await page.evaluate(
    "window.remotion_cancelledError ? String(window.remotion_cancelledError) : null",
  );
  if (cancelled) {
    throw new Error(`Component render cancelled in the browser: ${cancelled}`);
  }
}

interface CompositionMeta {
  id: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  serializedResolvedPropsWithCustomSchema?: string;
  defaultCodec?: string | null;
  defaultOutName?: string | null;
  defaultVideoImageFormat?: string | null;
  defaultPixelFormat?: string | null;
  defaultProResProfile?: string | null;
  defaultSampleRate?: number | null;
}

/**
 * Run the deterministic geometry scan. Environment failures (no Chrome,
 * bundle/timeout errors) return { ok: false, skipped: true } — never throw.
 */
export async function scanComponentGeometry(
  options: GeometryScanOptions,
): Promise<GeometryScanResult> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const fractions = options.frameFractions?.length ? options.frameFractions : [0.5];

  let tempDir: string | null = null;
  let server: { url: string; close: () => Promise<void> } | null = null;
  let browser: Browser | null = null;

  try {
    // -- Resolve the bundle to scan ----------------------------------------
    let bundleUrl: string;
    let compositionId: string | undefined = options.compositionId;

    if (options.serveUrl) {
      if (/^https?:\/\//.test(options.serveUrl)) {
        bundleUrl = options.serveUrl.endsWith("/index.html")
          ? options.serveUrl
          : `${options.serveUrl.replace(/\/?$/, "/")}index.html`;
      } else {
        server = await serveStaticDir(options.serveUrl);
        bundleUrl = `${server.url}/index.html`;
      }
    } else if (options.tsxPath) {
      const { width, height, fps, buildOutDir } = options;
      if (!buildOutDir || !width || !height || !fps) {
        throw new Error("tsxPath mode requires buildOutDir, width, height and fps");
      }
      if (!fs.existsSync(options.tsxPath)) {
        throw new Error(`Component file not found: ${options.tsxPath}`);
      }
      tempDir = path.resolve(
        buildOutDir,
        ".geometry-qa",
        `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      fs.mkdirSync(tempDir, { recursive: true });
      const componentRelPath = path.relative(tempDir, path.resolve(options.tsxPath)).replace(/\\/g, "/");
      const rootPath = path.join(tempDir, "GeometryQaRoot.tsx");
      fs.writeFileSync(
        rootPath,
        generateGeometryQaRoot(componentRelPath, {
          width,
          height,
          fps,
          durationSec: options.durationSec ?? 5,
          theme: options.theme,
          lineTimings: options.lineTimings,
          subtitleSafeBottom: options.subtitleSafeBottom,
        }),
      );
      const publicDir = path.join(tempDir, "public");
      fs.mkdirSync(publicDir, { recursive: true });
      ensureNodeModulesLink(tempDir, options.projectRoot);

      const bundler = await import("@remotion/bundler");
      const bundleDir = path.join(tempDir, "bundle");
      await bundler.bundle({ entryPoint: rootPath, publicDir, outDir: bundleDir });
      server = await serveStaticDir(bundleDir);
      bundleUrl = `${server.url}/index.html`;
      compositionId = compositionId ?? QA_COMPOSITION_ID;
    } else {
      throw new Error("scanComponentGeometry requires either tsxPath or serveUrl");
    }

    // -- Launch browser ------------------------------------------------------
    const browserPath = await resolveGeometryBrowserExecutable(options.browserExecutable);
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      executablePath: browserPath,
      headless: "shell",
      args: ["--no-sandbox", "--allow-file-access-from-files", "--force-device-scale-factor=1", "--hide-scrollbars"],
    });

    const page = await browser.newPage();

    // Globals the bundle expects (subset of @remotion/renderer setPropsAndEnv).
    // String form, not a closure: under tsx/vitest esbuild rewrites function
    // sources with a `__name(...)` helper that does not exist in the page.
    await page.evaluateOnNewDocument(
      "(() => {\n" +
        "  const w = window;\n" +
        `  w.remotion_puppeteerTimeout = ${JSON.stringify(timeoutMs)};\n` +
        "  w.remotion_isMainTab = true;\n" +
        '  w.remotion_inputProps = "{}";\n' +
        "  w.remotion_initialFrame = 0;\n" +
        "  w.remotion_attempt = 1;\n" +
        "  w.remotion_audioEnabled = false;\n" +
        "  w.remotion_videoEnabled = true;\n" +
        '  w.remotion_logLevel = "error";\n' +
        "  w.remotion_sampleRate = 48000;\n" +
        '  if (typeof w.process === "undefined") {\n' +
        '    w.process = { env: { NODE_ENV: "production" } };\n' +
        '  } else if (typeof w.process.env === "undefined") {\n' +
        '    w.process.env = { NODE_ENV: "production" };\n' +
        "  }\n" +
        "})()",
    );

    await page.goto(bundleUrl, { waitUntil: "load", timeout: timeoutMs });
    await waitRemotionReady(page, timeoutMs);

    // -- Discover composition + metadata -------------------------------------
    if (!compositionId) {
      const ids = await page.evaluate("window.remotion_getCompositionNames ? window.remotion_getCompositionNames() : []");
      compositionId = Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : undefined;
      if (!compositionId) throw new Error("No composition found in the bundle");
    }
    const compId: string = compositionId;

    // Evaluation mode mounts the Root (needed for calculateComposition).
    await page.evaluate("window.remotion_setBundleMode({ type: 'evaluation' })");
    await waitRemotionReady(page, timeoutMs);
    const meta = (await page.evaluate(
      `window.remotion_calculateComposition(${JSON.stringify(compId)})`,
    )) as CompositionMeta;
    await waitRemotionReady(page, timeoutMs);

    await page.setViewport({ width: meta.width, height: meta.height, deviceScaleFactor: 1 });

    // Composition mode mounts the actual canvas in the DOM.
    const bundleModeState = {
      type: "composition",
      compositionName: compId,
      serializedResolvedPropsWithSchema: meta.serializedResolvedPropsWithCustomSchema ?? "{}",
      compositionDurationInFrames: meta.durationInFrames,
      compositionFps: meta.fps,
      compositionHeight: meta.height,
      compositionWidth: meta.width,
      compositionDefaultCodec: meta.defaultCodec ?? null,
      compositionDefaultOutName: meta.defaultOutName ?? null,
      compositionDefaultVideoImageFormat: meta.defaultVideoImageFormat ?? null,
      compositionDefaultPixelFormat: meta.defaultPixelFormat ?? null,
      compositionDefaultProResProfile: meta.defaultProResProfile ?? null,
      compositionDefaultSampleRate: meta.defaultSampleRate ?? null,
    };
    await page.evaluate(`window.remotion_setBundleMode(${JSON.stringify(bundleModeState)})`);
    await waitRemotionReady(page, timeoutMs);

    // -- Sweep frames ----------------------------------------------------------
    const dims = { width: meta.width, height: meta.height };
    const safeBottom = options.safeBottom ?? options.subtitleSafeBottom ?? 0;
    const totalFrames = Math.max(1, meta.durationInFrames);
    const frames = [...new Set(
      fractions.map((f) =>
        Math.min(totalFrames - 1, Math.max(0, Math.round(f * (totalFrames - 1)))),
      ),
    )].sort((a, b) => a - b);

    const perFrame: { frame: number; issues: GeometryIssue[] }[] = [];
    const framesScanned: number[] = [];
    for (const frame of frames) {
      await page.evaluate(
        `window.remotion_setFrame(${frame}, ${JSON.stringify(compId)}, 0)`,
      );
      await waitRemotionReady(page, timeoutMs);
      await page.evaluate("document.fonts.ready.then(() => true)");
      const snapshot = (await page.evaluate(
        `(${COLLECT_DOM_GEOMETRY_SOURCE})()`,
      )) as DomGeometrySnapshot;
      perFrame.push({
        frame,
        issues: analyzeGeometrySnapshot(snapshot, dims, {
          frame,
          safeBottom,
          fallbackBackgroundCss: options.backgroundColor,
          thresholds: options.thresholds,
        }),
      });
      framesScanned.push(frame);
    }

    return {
      ok: true,
      issues: mergeFrameIssues(perFrame),
      framesScanned,
      dims: { ...dims, safeBottom },
    };
  } catch (err) {
    return {
      ok: false,
      skipped: true,
      error: err instanceof Error ? err.message : String(err),
      issues: [],
      framesScanned: [],
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    if (server) {
      try {
        await server.close();
      } catch {
        // ignore
      }
    }
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Geometry QA gate, parallel to assessVisualMetrics. Purely additive:
 * environment failures soft-skip (pass with skipped:true) so a broken
 * headless-browser setup never disables the quality loop.
 */
export async function assessVisualGeometry(
  options: GeometryScanOptions,
): Promise<VisualGeometryResult> {
  const scan = await scanComponentGeometry(options);
  if (!scan.ok) {
    return {
      pass: true,
      feedback: "",
      issues: [],
      skipped: true,
      error: scan.error,
    };
  }
  if (scan.issues.length === 0) {
    return { pass: true, feedback: "", issues: [], framesScanned: scan.framesScanned };
  }
  return {
    pass: false,
    feedback: geometryIssuesToFeedback(scan.issues),
    issues: scan.issues,
    framesScanned: scan.framesScanned,
  };
}
