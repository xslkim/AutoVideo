/**
 * Tests for src/ai/assembly-wrapper.ts
 *
 * Acceptance criteria:
 * - Wrapper has a default export, forwards every AnimationProps field BY
 *   NAME (no `{...props}` spread), and inlines the spec via JSON.stringify
 * - Value imports use the extensionless `../../../remotion/library`
 *   specifier (webpack has no extensionAlias)
 * - ANTI-HOLLOW: the generated wrapper is written to a temp file and run
 *   through the REAL astStaticScan (src/ai/validate.ts) and the REAL
 *   checkNarrationSyncContract (src/ai/visual-metrics.ts) — both must pass
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildAssemblyWrapper } from "../../src/ai/assembly-wrapper.js";
import { astStaticScan } from "../../src/ai/validate.js";
import { checkNarrationSyncContract } from "../../src/ai/visual-metrics.js";
import { VISUAL_REGISTRY } from "../../src/ai/visual-registry.js";

const KEYPOINTS_SPEC = {
  title: "核心要点",
  points: [
    { title: "查询与键做点积", detail: "得到注意力分数" },
    { title: "softmax 归一化" },
    { title: "加权求和值向量" },
  ],
};

let tempDir: string | null = null;

function writeTempWrapper(source: string): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "assembly-wrapper-test-"));
  const file = path.join(tempDir, "Component.tsx");
  fs.writeFileSync(file, source, "utf-8");
  return file;
}

afterEach(() => {
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    tempDir = null;
  }
});

// ---------------------------------------------------------------------------
// Template shape
// ---------------------------------------------------------------------------

describe("buildAssemblyWrapper — template", () => {
  it("has a default export and a typed React.FC", () => {
    const tsx = buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC);
    expect(tsx).toContain("export default Component;");
    expect(tsx).toContain("React.FC<AnimationProps>");
  });

  it("forwards every AnimationProps field by name — no pure spread", () => {
    const tsx = buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC);
    for (const field of [
      "frame",
      "durationInFrames",
      "width",
      "height",
      "subtitleSafeBottom",
      "theme",
      "fps",
      "lineTimings",
    ]) {
      expect(tsx).toContain(`${field}={props.${field}}`);
    }
    expect(tsx).not.toContain("{...props}");
  });

  it("inlines the spec as a typed const via JSON.stringify", () => {
    const tsx = buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC);
    expect(tsx).toContain(`const SPEC: KeyPointsSpec = ${JSON.stringify(KEYPOINTS_SPEC, null, 2)};`);
    expect(tsx).toContain("spec={SPEC}");
  });

  it("imports values extensionlessly and the spec type via import type", () => {
    const tsx = buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC);
    expect(tsx).toContain('import { KeyPoints } from "../../../remotion/library";');
    expect(tsx).toContain('import type { KeyPointsSpec } from "../../../remotion/library";');
    expect(tsx).not.toContain('remotion/library.js');
  });

  it("inlines the AnimationProps interface with the lineTimings contract", () => {
    const tsx = buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC);
    expect(tsx).toContain("interface AnimationProps");
    expect(tsx).toContain("lineTimings: { startSec: number; endSec: number }[]");
    expect(tsx).toContain("subtitleSafeBottom: number");
  });

  it("rejects identifier-unsafe component names", () => {
    expect(() => buildAssemblyWrapper("KeyPoints; process.exit()", {})).toThrow(
      /invalid component name/
    );
    expect(() => buildAssemblyWrapper("lowercase", {})).toThrow(/invalid component name/);
  });

  it("rejects non-serializable specs", () => {
    expect(() => buildAssemblyWrapper("KeyPoints", undefined)).toThrow(
      /not JSON-serializable/
    );
    expect(() => buildAssemblyWrapper("KeyPoints", () => {})).toThrow(
      /not JSON-serializable/
    );
  });
});

// ---------------------------------------------------------------------------
// Anti-hollow: real static gates must pass on the generated source
// ---------------------------------------------------------------------------

describe("buildAssemblyWrapper — real validation gates", () => {
  it("passes the real astStaticScan", () => {
    const file = writeTempWrapper(buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC));
    const result = astStaticScan(file);
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.imports).toContain("react");
    expect(result.imports).toContain("../../../remotion/library");
  });

  it("passes astStaticScan for every registry component with its example", () => {
    for (const entry of VISUAL_REGISTRY) {
      const file = writeTempWrapper(
        buildAssemblyWrapper(entry.name, entry.exampleProps)
      );
      const result = astStaticScan(file);
      expect(result.errors, `${entry.name} wrapper must pass astStaticScan`).toEqual([]);
      expect(result.pass).toBe(true);
      fs.rmSync(tempDir!, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("passes checkNarrationSyncContract under a sync-intent description", () => {
    // The contract check only regex-scans for \blineTimings\b — the named
    // forward must be there even though the wrapper never reads the value.
    const tsx = buildAssemblyWrapper("KeyPoints", KEYPOINTS_SPEC);
    const result = checkNarrationSyncContract(
      "旁白推进列表：讲到第 N 项时高亮第 N 项（跟随旁白）",
      tsx
    );
    expect(result.pass).toBe(true);
    expect(result.feedback).toBe("");
  });

  it("passes checkNarrationSyncContract for a plain description too", () => {
    const tsx = buildAssemblyWrapper("TitleCard", { title: "片头" });
    const result = checkNarrationSyncContract("片头大字标题", tsx);
    expect(result.pass).toBe(true);
  });

  it("survives hostile spec content (quotes, newlines, backslashes, JSX-ish text)", () => {
    const hostile = {
      title: '引号"与"反斜杠\\',
      code: 'const s = `模板 ${1}`;\n// 注释 */ "双引号" <div>\nif (a) { return "}"; }',
      language: "ts",
    };
    const file = writeTempWrapper(buildAssemblyWrapper("CodeBlock", hostile));
    const result = astStaticScan(file);
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);

    // The inlined JSON must round-trip back to the original spec.
    const src = fs.readFileSync(file, "utf-8");
    const inline = src.match(/const SPEC: CodeBlockSpec = ([\s\S]*?);\n/);
    expect(inline).not.toBeNull();
    expect(JSON.parse(inline![1])).toEqual(hostile);
  });
});
