/**
 * Tests for src/ai/visual-registry.ts
 *
 * Acceptance criteria:
 * - Valid props pass; invalid props fail with readable field paths
 * - {"component": null} fallback signal passes (with or without reason)
 * - Unregistered component names fail and list the valid names
 * - Unknown props keys are stripped (zod default), never passed through
 * - Registry name set === component export names statically extracted from
 *   remotion/library/index.ts source (no barrel import — that would pull
 *   the remotion dependency tree into vitest)
 * - Every entry's componentFile points at a real library file
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  VISUAL_REGISTRY,
  buildRegistryDocs,
  registeredComponentNames,
  validateAssembly,
} from "../../src/ai/visual-registry.js";

const REPO_ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// validateAssembly — happy paths
// ---------------------------------------------------------------------------

describe("validateAssembly — valid input", () => {
  it("accepts a valid KeyPoints selection and returns the parsed props", () => {
    const result = validateAssembly({
      component: "KeyPoints",
      props: {
        title: "核心要点",
        points: [
          { title: "第一点", detail: "细节" },
          { title: "第二点" },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.component !== null) {
      expect(result.value.component).toBe("KeyPoints");
      expect(result.value.props).toEqual({
        title: "核心要点",
        points: [
          { title: "第一点", detail: "细节" },
          { title: "第二点" },
        ],
      });
    } else {
      expect.unreachable();
    }
  });

  it("accepts every registry component with its documented example props", () => {
    for (const entry of VISUAL_REGISTRY) {
      const result = validateAssembly({
        component: entry.name,
        props: entry.exampleProps,
      });
      expect(result.ok, `example props for ${entry.name} must validate`).toBe(true);
    }
  });

  it("accepts a TitleCard with only the required field", () => {
    const result = validateAssembly({
      component: "TitleCard",
      props: { title: "注意力机制" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts the component:null fallback signal with a reason", () => {
    const result = validateAssembly({
      component: null,
      reason: "描述需要自由布局的对比画面，注册组件都不合适",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        component: null,
        reason: "描述需要自由布局的对比画面，注册组件都不合适",
      });
    }
  });

  it("accepts component:null without a reason (placeholder filled in)", () => {
    const result = validateAssembly({ component: null });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.component === null) {
      expect(result.value.reason.length).toBeGreaterThan(0);
    } else {
      expect.unreachable();
    }
  });
});

// ---------------------------------------------------------------------------
// validateAssembly — invalid input
// ---------------------------------------------------------------------------

describe("validateAssembly — invalid input", () => {
  it("rejects an unknown component name and lists the registered ones", () => {
    const result = validateAssembly({
      component: "PieChart",
      props: { bars: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("PieChart");
      for (const name of registeredComponentNames()) {
        expect(result.errors[0]).toContain(name);
      }
    }
  });

  it("rejects missing required props with a readable field path", () => {
    const result = validateAssembly({ component: "TitleCard", props: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("props.title"))).toBe(true);
    }
  });

  it("rejects wrong-typed fields with path and reason", () => {
    const result = validateAssembly({
      component: "DataBars",
      props: { bars: [{ label: "A", value: "not-a-number" }, { label: "B", value: 2 }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("props.bars[0].value"))).toBe(true);
    }
  });

  it("rejects arrays below the minimum length", () => {
    const result = validateAssembly({
      component: "KeyPoints",
      props: { points: [{ title: "只有一个" }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("props.points"))).toBe(true);
    }
  });

  it("rejects arrays above the maximum length", () => {
    const result = validateAssembly({
      component: "FlowDiagram",
      props: {
        nodes: Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, label: `节点${i}` })),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("props.nodes"))).toBe(true);
    }
  });

  it("rejects bad enum values", () => {
    const result = validateAssembly({
      component: "FlowDiagram",
      props: {
        direction: "diagonal",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("props.direction"))).toBe(true);
    }
  });

  it("rejects a missing props object for a named component", () => {
    const result = validateAssembly({ component: "CodeBlock" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('"props"'))).toBe(true);
      expect(result.errors.some((e) => e.includes("CodeBlock"))).toBe(true);
    }
  });

  it("rejects non-object output and missing component field", () => {
    expect(validateAssembly("not an object").ok).toBe(false);
    expect(validateAssembly(null).ok).toBe(false);
    expect(validateAssembly([{ component: null }]).ok).toBe(false);
    expect(validateAssembly({ props: {} }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown-key stripping
// ---------------------------------------------------------------------------

describe("validateAssembly — unknown keys", () => {
  it("strips invented props keys instead of failing", () => {
    const result = validateAssembly({
      component: "TitleCard",
      props: { title: "标题", inventedField: "幻觉", theme: "dark" },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.component !== null) {
      expect(result.value.props).toEqual({ title: "标题" });
      expect(result.value.props).not.toHaveProperty("inventedField");
    } else {
      expect.unreachable();
    }
  });

  it("strips unknown keys nested inside array items", () => {
    const result = validateAssembly({
      component: "KeyPoints",
      props: {
        points: [
          { title: "一", extra: 1 },
          { title: "二", extra: 2 },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.component !== null) {
      expect(result.value.props.points).toEqual([{ title: "一" }, { title: "二" }]);
    } else {
      expect.unreachable();
    }
  });
});

// ---------------------------------------------------------------------------
// buildRegistryDocs
// ---------------------------------------------------------------------------

describe("buildRegistryDocs", () => {
  it("documents every component with its field table and an example", () => {
    const docs = buildRegistryDocs();
    for (const entry of VISUAL_REGISTRY) {
      expect(docs).toContain(`### ${entry.name}`);
      for (const field of entry.fields) {
        expect(docs).toContain(`| ${field.name} |`);
      }
    }
    expect(docs).toContain("```json");
    expect(docs).toContain("Use when:");
  });
});

// ---------------------------------------------------------------------------
// Drift guards
// ---------------------------------------------------------------------------

describe("registry ↔ library drift guards", () => {
  it("registry names === component export names in remotion/library/index.ts", () => {
    // Statically read the barrel source — importing it here would pull the
    // whole remotion/react dependency tree into vitest.
    const barrelPath = path.join(REPO_ROOT, "remotion/library/index.ts");
    const src = fs.readFileSync(barrelPath, "utf-8");
    const exported = [
      ...src.matchAll(/export\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*"\.\/components\//g),
    ].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    expect(registeredComponentNames().sort()).toEqual(exported.sort());
  });

  it("every entry's componentFile exists on disk", () => {
    for (const entry of VISUAL_REGISTRY) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, entry.componentFile)),
        `${entry.name} → ${entry.componentFile}`
      ).toBe(true);
    }
  });

  it("component files point back at their registry entry (header comment)", () => {
    for (const entry of VISUAL_REGISTRY) {
      const src = fs.readFileSync(path.join(REPO_ROOT, entry.componentFile), "utf-8");
      const header = src.slice(0, 800);
      expect(header).toContain("visual-registry.ts");
      expect(header).toContain(`"${entry.name}"`);
    }
  });

  it("component names are unique", () => {
    const names = registeredComponentNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
