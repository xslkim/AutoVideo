import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeStaticMetrics, assessVisualMetrics } from "../../src/ai/visual-metrics.js";

const tmpFiles: string[] = [];
function writeTsx(content: string): string {
  const p = path.join(os.tmpdir(), `vm-${Date.now()}-${Math.random().toString(36).slice(2)}.tsx`);
  fs.writeFileSync(p, content);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

const DIMS = { width: 1920, height: 1080 };

describe("computeStaticMetrics", () => {
  it("resolves relative font sizes against height and counts elements", () => {
    const p = writeTsx(`
      import React from "react";
      export default function C({ height, width }: any) {
        return (
          <div style={{ fontSize: height * 0.09 }}>
            <span style={{ fontSize: height * 0.03 }}>a</span>
            <span style={{ fontSize: width * 0.02 }}>b</span>
          </div>
        );
      }
    `);
    const m = computeStaticMetrics(p, DIMS);
    expect(m.usesRelativeFont).toBe(true);
    expect(m.hardcodedFontSizes).toEqual([]);
    // largest = height * 0.09 = 97.2
    expect(Math.round(m.maxFontPx)).toBe(97);
    expect(m.elementCount).toBe(3); // div + 2 span
  });

  it("flags hard-coded font sizes and finds the largest", () => {
    const p = writeTsx(`
      import React from "react";
      export default function C() {
        return <div style={{ fontSize: 32 }}><b style={{ fontSize: 64 }}>x</b></div>;
      }
    `);
    const m = computeStaticMetrics(p, DIMS);
    expect(m.usesRelativeFont).toBe(false);
    expect(m.hardcodedFontSizes.sort((a, b) => a - b)).toEqual([32, 64]);
    expect(m.maxFontPx).toBe(64);
  });

  it("detects fonts nested inside Math.round()", () => {
    const p = writeTsx(`
      import React from "react";
      export default function C({ height }: any) {
        return <h1 style={{ fontSize: Math.round(height * 0.08) }}>t</h1>;
      }
    `);
    const m = computeStaticMetrics(p, DIMS);
    expect(m.usesRelativeFont).toBe(true);
    expect(Math.round(m.maxFontPx)).toBe(86); // 1080 * 0.08
  });
});

describe("assessVisualMetrics (static-only)", () => {
  it("fails a tiny font / single element slide with actionable feedback", async () => {
    const p = writeTsx(`
      import React from "react";
      export default function C() {
        return <div style={{ fontSize: 18 }}>hi</div>;
      }
    `);
    const res = await assessVisualMetrics({
      tsxPath: p, width: 1920, height: 1080,
      thresholds: { minFontCoeff: 0.07, minElements: 4, minCoverage: 0.7 },
    });
    expect(res.pass).toBe(false);
    expect(res.feedback).toContain("最大字号");
    expect(res.feedback).toContain("可见元素");
  });

  it("passes a slide that meets font and element thresholds (no image check)", async () => {
    const p = writeTsx(`
      import React from "react";
      export default function C({ height }: any) {
        return (
          <div style={{ fontSize: height * 0.09 }}>
            <span style={{ fontSize: height * 0.04 }}>a</span>
            <span style={{ fontSize: height * 0.04 }}>b</span>
            <span style={{ fontSize: height * 0.03 }}>c</span>
          </div>
        );
      }
    `);
    const res = await assessVisualMetrics({
      tsxPath: p, width: 1920, height: 1080,
      thresholds: { minFontCoeff: 0.07, minElements: 4, minCoverage: 0.7 },
    });
    expect(res.pass).toBe(true);
    expect(res.feedback).toBe("");
  });
});
