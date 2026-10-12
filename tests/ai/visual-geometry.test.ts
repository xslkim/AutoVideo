import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  analyzeGeometrySnapshot,
  assessVisualGeometry,
  compositeOver,
  contrastRatio,
  geometryIssuesToFeedback,
  mergeFrameIssues,
  parseCssColor,
  relativeLuminance,
  type DomElementSnapshot,
  type DomGeometrySnapshot,
  type GeometryIssue,
} from "../../src/ai/visual-geometry.js";

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

let autoIndex = 0;
function el(partial: Partial<DomElementSnapshot> = {}): DomElementSnapshot {
  const index = partial.index ?? autoIndex++;
  return {
    index,
    tag: "div",
    label: `<div#e${index}>`,
    ownText: "",
    rect: { x: 0, y: 0, width: 100, height: 40 },
    parentIndex: null,
    fontSizePx: 48,
    colorCss: "rgb(224, 224, 224)",
    fillCss: "rgb(0, 0, 0)", // computed fill exists (and is black) on HTML elements too
    backgroundCss: "rgba(0, 0, 0, 0)",
    ancestorBackgroundCss: null,
    effectiveOpacity: 1,
    media: false,
    visiblePaint: false,
    kept: true,
    ...partial,
  };
}

function snap(elements: DomElementSnapshot[], pageBackgroundCss: string | null = null): DomGeometrySnapshot {
  // The collector emits `index` as the position in the elements array and
  // `parentIndex` pointing at that same array — mirror that here so ancestry
  // checks resolve correctly.
  const remap = new Map<number, number>(elements.map((e, i) => [e.index, i]));
  const fixed = elements.map((e, i) => ({
    ...e,
    index: i,
    parentIndex: e.parentIndex !== null ? remap.get(e.parentIndex) ?? null : null,
  }));
  return { canvas: { x: 0, y: 0, width: 1920, height: 1080 }, pageBackgroundCss, elements: fixed };
}

const DIMS = { width: 1920, height: 1080 };

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

describe("parseCssColor", () => {
  it("parses rgb/rgba comma and space-slash syntax", () => {
    expect(parseCssColor("rgb(255, 0, 128)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseCssColor("rgb(100%, 0%, 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses hex colors", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#1a1a2e")).toEqual({ r: 26, g: 26, b: 46, a: 1 });
    expect(parseCssColor("#ff000080")!.a).toBeCloseTo(128 / 255, 5);
  });

  it("returns null for transparent/none/garbage", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("none")).toBeNull();
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor("not-a-color")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });
});

describe("contrast math", () => {
  it("computes WCAG reference values", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #777 on white is a known ≈4.48:1 pair.
    expect(contrastRatio({ r: 119, g: 119, b: 119, a: 1 }, white)).toBeCloseTo(4.48, 1);
  });

  it("composites semi-transparent foreground over background", () => {
    const bg = { r: 200, g: 200, b: 200, a: 1 };
    const fg = { r: 0, g: 0, b: 0, a: 0.5 };
    const out = compositeOver(fg, bg);
    expect(out.a).toBeCloseTo(1, 5);
    expect(out.r).toBeCloseTo(100, 1);
  });
});

// ---------------------------------------------------------------------------
// analyzeGeometrySnapshot — overlap
// ---------------------------------------------------------------------------

describe("analyzeGeometrySnapshot: text overlap", () => {
  it("flags two heavily overlapping text elements with pixel details", () => {
    const a = el({ ownText: "标题甲", label: '<div> "标题甲"', rect: { x: 100, y: 100, width: 300, height: 80 } });
    const b = el({ ownText: "标题乙", label: '<div> "标题乙"', rect: { x: 200, y: 130, width: 300, height: 80 } });
    const issues = analyzeGeometrySnapshot(snap([a, b]), DIMS);
    const overlap = issues.filter((i) => i.kind === "text-overlap");
    expect(overlap).toHaveLength(1);
    expect(overlap[0].element).toContain("标题甲");
    expect(overlap[0].otherElement).toContain("标题乙");
    // intersection = 200 × 50 → 占较小元素 200*50/24000 ≈ 42%
    expect(overlap[0].detail).toContain("200×50px");
    expect(overlap[0].detail).toContain("42%");
    expect(overlap[0].suggestion).toContain("交叠");
    expect(overlap[0].frames).toEqual([0]);
  });

  it("ignores ancestor/descendant nesting", () => {
    const parent = el({ ownText: "外层标题", label: '<div> "外层标题"', rect: { x: 0, y: 0, width: 400, height: 200 } });
    const child = el({
      ownText: "内层文字",
      label: '<span> "内层文字"',
      tag: "span",
      rect: { x: 20, y: 20, width: 200, height: 60 },
      parentIndex: parent.index,
    });
    const issues = analyzeGeometrySnapshot(snap([parent, child]), DIMS);
    expect(issues.filter((i) => i.kind === "text-overlap")).toHaveLength(0);
  });

  it("ignores intentional layered duplicates (karaoke highlight pairs)", () => {
    const a = el({ ownText: "同一句话", label: '<div> "同一句话" a', rect: { x: 100, y: 100, width: 500, height: 90 } });
    const b = el({ ownText: "同一句话", label: '<div> "同一句话" b', rect: { x: 100, y: 100, width: 500, height: 90 } });
    const issues = analyzeGeometrySnapshot(snap([a, b]), DIMS);
    expect(issues.filter((i) => i.kind === "text-overlap")).toHaveLength(0);
  });

  it("ignores incidental touches below the overlap threshold", () => {
    const a = el({ ownText: "甲", label: '<div> "甲"', rect: { x: 0, y: 0, width: 200, height: 100 } });
    const b = el({ ownText: "乙", label: '<div> "乙"', rect: { x: 190, y: 0, width: 200, height: 100 } });
    const issues = analyzeGeometrySnapshot(snap([a, b]), DIMS);
    expect(issues.filter((i) => i.kind === "text-overlap")).toHaveLength(0);
  });

  it("is deterministic for identical input", () => {
    const build = () =>
      snap([
        el({ index: 0, ownText: "A", label: '<div> "A"', rect: { x: 0, y: 0, width: 200, height: 100 } }),
        el({ index: 1, ownText: "B", label: '<div> "B"', rect: { x: 100, y: 20, width: 200, height: 100 } }),
      ]);
    const run1 = analyzeGeometrySnapshot(build(), DIMS);
    const run2 = analyzeGeometrySnapshot(build(), DIMS);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});

// ---------------------------------------------------------------------------
// analyzeGeometrySnapshot — canvas overflow
// ---------------------------------------------------------------------------

describe("analyzeGeometrySnapshot: canvas overflow", () => {
  it("flags text sticking out past the right edge with px detail", () => {
    const t = el({ ownText: "溢出文本", label: '<div> "溢出文本"', rect: { x: 1900, y: 500, width: 200, height: 50 } });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS);
    const overflow = issues.filter((i) => i.kind === "canvas-overflow");
    expect(overflow).toHaveLength(1);
    expect(overflow[0].detail).toContain("右侧超出 180px");
    expect(overflow[0].detail).toContain("2100 > 1920");
  });

  it("flags text past the left/top edges", () => {
    const t = el({ ownText: "左上溢出", label: '<div> "左上溢出"', rect: { x: -60, y: -30, width: 200, height: 50 } });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS);
    const overflow = issues.filter((i) => i.kind === "canvas-overflow");
    expect(overflow).toHaveLength(1);
    expect(overflow[0].detail).toContain("左侧超出 60px");
    expect(overflow[0].detail).toContain("顶部超出 30px");
  });

  it("tolerates sub-threshold overflow", () => {
    const t = el({ ownText: "边缘", label: '<div> "边缘"', rect: { x: 1820, y: 0, width: 102, height: 50 } });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS);
    expect(issues.filter((i) => i.kind === "canvas-overflow")).toHaveLength(0);
  });

  it("ignores decorative (non-text, non-media) bleed off-canvas", () => {
    const glow = el({ rect: { x: -400, y: -400, width: 2720, height: 1880 }, visiblePaint: true });
    const issues = analyzeGeometrySnapshot(snap([glow]), DIMS);
    expect(issues.filter((i) => i.kind === "canvas-overflow")).toHaveLength(0);
  });

  it("flags media elements overflowing", () => {
    const img = el({ tag: "img", media: true, label: "<img>", rect: { x: 1700, y: 800, width: 400, height: 300 } });
    const issues = analyzeGeometrySnapshot(snap([img]), DIMS);
    expect(issues.filter((i) => i.kind === "canvas-overflow")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// analyzeGeometrySnapshot — safe-zone intrusion
// ---------------------------------------------------------------------------

describe("analyzeGeometrySnapshot: subtitle safe-zone intrusion", () => {
  const SAFE = { safeBottom: 150 }; // band starts at y = 930

  it("flags a painted card whose bottom edge enters the band", () => {
    const card = el({
      ownText: "卡片",
      label: '<div> "卡片"',
      visiblePaint: true,
      rect: { x: 300, y: 900, width: 500, height: 100 },
    });
    const issues = analyzeGeometrySnapshot(snap([card]), DIMS, SAFE);
    const intr = issues.filter((i) => i.kind === "safe-zone-intrusion");
    expect(intr).toHaveLength(1);
    expect(intr[0].detail).toContain("侵入底部字幕安全区 70px");
    expect(intr[0].detail).toContain("930");
  });

  it("exempts full-bleed backgrounds that cover the band", () => {
    const bg = el({ visiblePaint: true, rect: { x: 0, y: 0, width: 1920, height: 1080 } });
    const issues = analyzeGeometrySnapshot(snap([bg]), DIMS, SAFE);
    expect(issues.filter((i) => i.kind === "safe-zone-intrusion")).toHaveLength(0);
  });

  it("passes content that ends above the band", () => {
    const ok = el({ ownText: "安全", label: '<div> "安全"', rect: { x: 100, y: 800, width: 300, height: 60 } });
    const issues = analyzeGeometrySnapshot(snap([ok]), DIMS, SAFE);
    expect(issues.filter((i) => i.kind === "safe-zone-intrusion")).toHaveLength(0);
  });

  it("is disabled when no safe zone is configured", () => {
    const card = el({ ownText: "底部", label: '<div> "底部"', visiblePaint: true, rect: { x: 100, y: 950, width: 300, height: 80 } });
    const issues = analyzeGeometrySnapshot(snap([card]), DIMS);
    expect(issues.filter((i) => i.kind === "safe-zone-intrusion")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeGeometrySnapshot — low contrast
// ---------------------------------------------------------------------------

describe("analyzeGeometrySnapshot: low contrast", () => {
  const BG = "#1a1a2e"; // rgb(26,26,46)

  it("flags text whose color is nearly identical to its ancestor background", () => {
    const t = el({
      ownText: "低对比",
      label: '<div> "低对比"',
      colorCss: "rgb(42, 42, 64)",
      ancestorBackgroundCss: "rgb(26, 26, 46)",
    });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS, { fallbackBackgroundCss: BG });
    const low = issues.filter((i) => i.kind === "low-contrast");
    expect(low).toHaveLength(1);
    expect(low[0].detail).toContain("rgb(42,42,64)");
    expect(low[0].detail).toContain("rgb(26,26,46)");
    expect(low[0].detail).toMatch(/对比度仅 1\.\d\d:1/);
  });

  it("passes high-contrast text", () => {
    const t = el({ ownText: "白字", label: '<div> "白字"', colorCss: "rgb(255, 255, 255)", ancestorBackgroundCss: "rgb(26, 26, 46)" });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS, { fallbackBackgroundCss: BG });
    expect(issues.filter((i) => i.kind === "low-contrast")).toHaveLength(0);
  });

  it("composites semi-transparent text over its background", () => {
    // White at 8% opacity over #1a1a2e → nearly the background color.
    const t = el({
      ownText: "幽灵字",
      label: '<div> "幽灵字"',
      colorCss: "rgba(255, 255, 255, 0.08)",
      ancestorBackgroundCss: "rgb(26, 26, 46)",
    });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS, { fallbackBackgroundCss: BG });
    expect(issues.filter((i) => i.kind === "low-contrast")).toHaveLength(1);
  });

  it("skips the check when no background is determinable", () => {
    const t = el({ ownText: "无背景", label: '<div> "无背景"', colorCss: "rgb(30, 30, 40)" });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS);
    expect(issues.filter((i) => i.kind === "low-contrast")).toHaveLength(0);
  });

  it("uses fill (not color) for SVG text elements", () => {
    const t = el({
      tag: "text",
      ownText: "SVG文字",
      label: '<text> "SVG文字"',
      colorCss: "rgb(255, 255, 255)", // HTML color says white…
      fillCss: "rgb(30, 30, 50)", //     …but the SVG fill is near-background
      ancestorBackgroundCss: "rgb(26, 26, 46)",
    });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS, { fallbackBackgroundCss: BG });
    expect(issues.filter((i) => i.kind === "low-contrast")).toHaveLength(1);
  });

  it("does not let the HTML-element default black fill shadow the real color", () => {
    const t = el({
      tag: "div",
      ownText: "正常白字",
      label: '<div> "正常白字"',
      colorCss: "rgb(255, 255, 255)",
      fillCss: "rgb(0, 0, 0)", // computed fill is black even on divs
      ancestorBackgroundCss: "rgb(26, 26, 46)",
    });
    const issues = analyzeGeometrySnapshot(snap([t]), DIMS, { fallbackBackgroundCss: BG });
    expect(issues.filter((i) => i.kind === "low-contrast")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mergeFrameIssues
// ---------------------------------------------------------------------------

describe("mergeFrameIssues", () => {
  const make = (frame: number, severity: number, detail: string): GeometryIssue => ({
    kind: "canvas-overflow",
    element: '<div> "X"',
    detail,
    suggestion: "s",
    frames: [frame],
    severity,
  });

  it("merges the same issue across frames, keeping the worst detail", () => {
    const merged = mergeFrameIssues([
      { frame: 10, issues: [make(10, 20, "超出 20px")] },
      { frame: 45, issues: [make(45, 80, "超出 80px")] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].frames).toEqual([10, 45]);
    expect(merged[0].detail).toBe("超出 80px");
    expect(merged[0].severity).toBe(80);
  });

  it("keeps different elements as separate issues and orders deterministically", () => {
    const a = (frame: number): GeometryIssue => ({ ...make(frame, 10, "a"), element: '<div> "A"' });
    const b = (frame: number): GeometryIssue => ({ ...make(frame, 50, "b"), element: '<div> "B"' });
    const merged = mergeFrameIssues([{ frame: 0, issues: [a(0), b(0)] }]);
    expect(merged.map((i) => i.element)).toEqual(['<div> "B"', '<div> "A"']); // severity desc
  });
});

// ---------------------------------------------------------------------------
// geometryIssuesToFeedback
// ---------------------------------------------------------------------------

describe("geometryIssuesToFeedback", () => {
  it("returns an empty string when there are no issues", () => {
    expect(geometryIssuesToFeedback([])).toBe("");
  });

  it("produces actionable numbered feedback with frames and fix directions", () => {
    const issue: GeometryIssue = {
      kind: "text-overlap",
      element: '<div> "标题"',
      otherElement: '<span> "副标题"',
      detail: '<div> "标题"（left=1, top=2, 3×4）与 <span> "副标题"（…）相交 100×20px（占较小元素 50%）',
      suggestion: "错开两者",
      frames: [10, 45],
      severity: 0.5,
    };
    const fb = geometryIssuesToFeedback([issue]);
    expect(fb).toContain("Geometry check failed");
    expect(fb).toContain("1. 【文字重叠】");
    expect(fb).toContain("100×20px");
    expect(fb).toContain("第 10、45 帧");
    expect(fb).toContain("建议：错开两者");
    expect(fb).toContain("AnimationProps");
  });
});

// ---------------------------------------------------------------------------
// End-to-end browser scan (guarded: needs the Remotion Chrome Headless Shell)
// ---------------------------------------------------------------------------

const HEADLESS_SHELL = path.join(
  __dirname,
  "../../node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell",
);
const browserAvailable = fs.existsSync(HEADLESS_SHELL);

describe("scanComponentGeometry (browser e2e)", () => {
  it.runIf(browserAvailable)(
    "detects all four issue kinds on a deliberately broken component, and passes a clean one",
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geo-qa-e2e-"));
      try {
        const broken = path.join(tmp, "Broken.tsx");
        fs.writeFileSync(
          broken,
          `import React from "react";
export default function C(props: any) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1a1a2e" }}>
      <div style={{ position: "absolute", left: 100, top: 100, fontSize: 60, color: "#ffffff" }}>标题甲文字</div>
      <div style={{ position: "absolute", left: 120, top: 130, fontSize: 60, color: "#ffffff" }}>标题乙重叠文字</div>
      <div style={{ position: "absolute", left: 1900, top: 500, width: 200, fontSize: 40, color: "#eeeeee" }}>右侧溢出文本</div>
      <div style={{ position: "absolute", left: 300, top: 960, width: 500, height: 100, background: "rgba(255,255,255,0.1)", fontSize: 36, color: "#dddddd" }}>字幕区侵入卡片</div>
      <div style={{ position: "absolute", left: 900, top: 300, fontSize: 42, color: "#2a2a40" }}>低对比度文字</div>
    </div>
  );
}
`,
        );

        const res = await assessVisualGeometry({
          tsxPath: broken,
          buildOutDir: tmp,
          width: 1920,
          height: 1080,
          fps: 30,
          durationSec: 3,
          frameFractions: [0.5],
          safeBottom: 150,
          backgroundColor: "#1a1a2e",
          browserExecutable: HEADLESS_SHELL,
          timeoutMs: 60000,
        });

        if (res.skipped) {
          // Environment problem (sandbox restrictions etc.) — the unit tests
          // above still cover the analyzer; do not fail the suite on infra.
          console.warn("[geometry-qa e2e] skipped:", res.error);
          return;
        }

        expect(res.pass).toBe(false);
        const kinds = new Set(res.issues.map((i) => i.kind));
        expect(kinds.has("text-overlap")).toBe(true);
        expect(kinds.has("canvas-overflow")).toBe(true);
        expect(kinds.has("safe-zone-intrusion")).toBe(true);
        expect(kinds.has("low-contrast")).toBe(true);
        expect(res.feedback).toContain("文字重叠");
        expect(res.feedback).toContain("溢出");
        expect(res.feedback).toContain("字幕安全区");
        expect(res.feedback).toContain("对比度");
        // White text on the dark canvas must NOT be flagged as low contrast.
        const lowContrast = res.issues.filter((i) => i.kind === "low-contrast");
        expect(lowContrast.every((i) => i.element.includes("低对比度文字"))).toBe(true);
        expect(res.framesScanned).toEqual([45]);

        const clean = path.join(tmp, "Clean.tsx");
        fs.writeFileSync(
          clean,
          `import React from "react";
export default function C(props: any) {
  const { width, height, subtitleSafeBottom } = props;
  const availH = height - subtitleSafeBottom;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1a1a2e" }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.1, fontSize: height * 0.08, color: "#ffffff" }}>几何检测通过</div>
      <div style={{ position: "absolute", left: width * 0.08, top: availH * 0.45, width: width * 0.5, fontSize: height * 0.035, color: "#e0e0e0" }}>所有元素互不重叠，且完整位于画布与字幕安全区之内。</div>
    </div>
  );
}
`,
        );
        const resClean = await assessVisualGeometry({
          tsxPath: clean,
          buildOutDir: tmp,
          width: 1920,
          height: 1080,
          fps: 30,
          durationSec: 3,
          frameFractions: [0.5],
          safeBottom: 150,
          backgroundColor: "#1a1a2e",
          browserExecutable: HEADLESS_SHELL,
          timeoutMs: 60000,
        });
        if (!resClean.skipped) {
          expect(resClean.pass).toBe(true);
          expect(resClean.feedback).toBe("");
          expect(resClean.issues).toEqual([]);
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    180000,
  );

  it.runIf(browserAvailable)(
    "soft-skips (pass) when the component file does not exist",
    async () => {
      const res = await assessVisualGeometry({
        tsxPath: "/nonexistent/Nope.tsx",
        buildOutDir: os.tmpdir(),
        width: 1920,
        height: 1080,
        fps: 30,
        browserExecutable: HEADLESS_SHELL,
      });
      expect(res.pass).toBe(true);
      expect(res.skipped).toBe(true);
      expect(res.error).toContain("not found");
    },
    30000,
  );
});
