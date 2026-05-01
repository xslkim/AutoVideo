/**
 * Tests for src/ai/validate.ts — T4.4
 *
 * Acceptance criteria:
 * 1. Forbidden import → AST static scan intercepts it
 * 2. Static error TSX → tsc blocks it + stderr captured
 * 3. (Integration) Valid TSX → renderStill produces non-pure-color PNG
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  astStaticScan,
  validateStatic,
  generateTsconfigVisuals,
  generateTypeShim,
  validateComponent,
  extractSourceSnippet,
  extractTscErrorContext,
} from "../../src/ai/validate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-validate-test-"));
}

function cleanupDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function writeFixture(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// AST Static Scan tests
// ---------------------------------------------------------------------------

describe("astStaticScan", () => {
  it("should pass for a valid component with allowed imports", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "Valid.tsx",
        `import React from "react";
import { useCurrentFrame, AbsoluteFill } from "remotion";

export default function Component(props: any) {
  const frame = useCurrentFrame();
  return React.createElement(AbsoluteFill, null,
    React.createElement("div", null, "Hello")
  );
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.imports).toContain("react");
      expect(result.imports).toContain("remotion");
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block forbidden import: fs", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadFS.tsx",
        `import React from "react";
import * as fs from "fs";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("fs"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block forbidden import: path", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadPath.tsx",
        `import React from "react";
import path from "path";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("path"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block forbidden import: child_process", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadChild.tsx",
        `import React from "react";
import { exec } from "child_process";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("child_process"))).toBe(
        true,
      );
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block forbidden import: http", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadHttp.tsx",
        `import React from "react";
import http from "http";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("http"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block forbidden import: https", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadHttps.tsx",
        `import React from "react";
import https from "https";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("https"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block require() calls", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadRequire.tsx",
        `import React from "react";

export default function Component() {
  const fs = require("fs");
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("require"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block eval() calls", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadEval.tsx",
        `import React from "react";

export default function Component() {
  eval("console.log('hack')");
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("eval"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block new Function() constructor", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadFunction.tsx",
        `import React from "react";

export default function Component() {
  const fn = new Function("return 1");
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("Function"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block node: prefixed imports", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "BadNodePrefix.tsx",
        `import React from "react";
import { readFileSync } from "node:fs";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("fs"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should allow imports from non-forbidden modules", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "Allowed.tsx",
        `import React from "react";
import { useCurrentFrame, interpolate, AbsoluteFill, useVideoConfig } from "remotion";

export default function Component() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1]);
  return React.createElement(AbsoluteFill, { style: { opacity } });
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(true);
      expect(result.imports).toContain("react");
      expect(result.imports).toContain("remotion");
    } finally {
      cleanupDir(dir);
    }
  });

  it("should report parse errors for invalid syntax", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "Invalid.tsx",
        `this is not valid JSX { {{{ }}`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("Parse error"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should block multiple forbidden imports in one file", () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "MultiBad.tsx",
        `import React from "react";
import fs from "fs";
import http from "http";
import { exec } from "child_process";

export default function Component() {
  return null;
}
`,
      );

      const result = astStaticScan(tsx);
      expect(result.pass).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    } finally {
      cleanupDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// tsconfig.visuals.json + shim generation tests
// ---------------------------------------------------------------------------

describe("generateTsconfigVisuals", () => {
  it("should generate a valid tsconfig with correct compilerOptions", () => {
    const dir = createTempDir();
    try {
      const componentPath = path.join(dir, "src/blocks/B01/Component.tsx");
      const shimPath = path.join(dir, "src/shims/types.ts");
      fs.mkdirSync(path.dirname(componentPath), { recursive: true });
      fs.writeFileSync(componentPath, "// component");
      fs.mkdirSync(path.dirname(shimPath), { recursive: true });
      fs.writeFileSync(shimPath, "// shim");

      const tsconfigPath = generateTsconfigVisuals(
        dir,
        [componentPath],
        shimPath,
      );

      expect(fs.existsSync(tsconfigPath)).toBe(true);
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));

      // Verify PRD-specified options
      expect(tsconfig.compilerOptions.types).toEqual(["react", "remotion"]);
      expect(tsconfig.compilerOptions.lib).toEqual(["ES2022", "DOM"]);
      expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
      expect(tsconfig.compilerOptions.strict).toBe(true);
      expect(tsconfig.compilerOptions.noEmit).toBe(true);
      expect(tsconfig.compilerOptions.allowJs).toBe(false);
      expect(tsconfig.compilerOptions.skipLibCheck).toBe(true);
      // include should contain both component and shim
      expect(tsconfig.include.length).toBe(2);
    } finally {
      cleanupDir(dir);
    }
  });
});

describe("generateTypeShim", () => {
  it("should generate a shim file with AnimationProps and Theme types", () => {
    const dir = createTempDir();
    try {
      const shimPath = path.join(dir, "types.ts");
      generateTypeShim(shimPath);

      expect(fs.existsSync(shimPath)).toBe(true);
      const content = fs.readFileSync(shimPath, "utf-8");
      expect(content).toContain("AnimationProps");
      expect(content).toContain("Theme");
      expect(content).toContain("frame");
      expect(content).toContain("durationInFrames");
      expect(content).toContain("subtitleSafeBottom");
    } finally {
      cleanupDir(dir);
    }
  });

  it("should create parent directories if they don't exist", () => {
    const dir = createTempDir();
    try {
      const shimPath = path.join(dir, "nested", "deep", "types.ts");
      generateTypeShim(shimPath);
      expect(fs.existsSync(shimPath)).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// tsc type-check tests
// ---------------------------------------------------------------------------

describe("validateStatic (tsc)", () => {
  it("should pass for a valid TSX component", async () => {
    const dir = createTempDir();
    try {
      const componentPath = path.join(dir, "src/blocks/B01/Component.tsx");
      const shimPath = path.join(dir, "src/shims/types.ts");

      fs.mkdirSync(path.dirname(componentPath), { recursive: true });
      fs.mkdirSync(path.dirname(shimPath), { recursive: true });

      // Write a valid component
      fs.writeFileSync(
        componentPath,
        `import React from "react";
import { AbsoluteFill } from "remotion";

export default function Component(): React.ReactElement {
  return React.createElement(AbsoluteFill, null, "Hello");
}
`,
      );

      // Generate shim and tsconfig
      generateTypeShim(shimPath);
      const tsconfigPath = generateTsconfigVisuals(
        dir,
        [componentPath],
        shimPath,
      );

      const result = await validateStatic(componentPath, tsconfigPath);
      expect(result.pass).toBe(true);
      expect(result.stderr).toBe("");
    } finally {
      cleanupDir(dir);
    }
  });

  it("should fail and capture stderr for a TSX with type errors", async () => {
    const dir = createTempDir();
    try {
      const componentPath = path.join(dir, "src/blocks/B01/Component.tsx");
      const shimPath = path.join(dir, "src/shims/types.ts");

      fs.mkdirSync(path.dirname(componentPath), { recursive: true });
      fs.mkdirSync(path.dirname(shimPath), { recursive: true });

      // Write a component with type errors
      fs.writeFileSync(
        componentPath,
        `import React from "react";

// Type error: missing return type, wrong usage
export default function Component() {
  const x: string = 42; // Type error: number is not assignable to string
  return React.createElement("div", null, "Hello");
}
`,
      );

      generateTypeShim(shimPath);
      const tsconfigPath = generateTsconfigVisuals(
        dir,
        [componentPath],
        shimPath,
      );

      const result = await validateStatic(componentPath, tsconfigPath);
      expect(result.pass).toBe(false);
      expect(result.stderr.length).toBeGreaterThan(0);
      // Should contain something about type error
      expect(
        result.stderr.includes("error") || result.stderr.includes("TS"),
      ).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should fail for a TSX with syntax errors", async () => {
    const dir = createTempDir();
    try {
      const componentPath = path.join(dir, "src/blocks/B01/Component.tsx");
      const shimPath = path.join(dir, "src/shims/types.ts");

      fs.mkdirSync(path.dirname(componentPath), { recursive: true });
      fs.mkdirSync(path.dirname(shimPath), { recursive: true });

      // Write a component with syntax errors
      fs.writeFileSync(
        componentPath,
        `import React from "react";

export default function Component() {
  return <div>{{{{</div>;
}
`,
      );

      generateTypeShim(shimPath);
      const tsconfigPath = generateTsconfigVisuals(
        dir,
        [componentPath],
        shimPath,
      );

      const result = await validateStatic(componentPath, tsconfigPath);
      expect(result.pass).toBe(false);
      expect(result.stderr.length).toBeGreaterThan(0);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should truncate stderr to 50 lines", async () => {
    // This test verifies the truncation logic works
    const dir = createTempDir();
    try {
      const componentPath = path.join(dir, "src/blocks/B01/Component.tsx");
      const shimPath = path.join(dir, "src/shims/types.ts");

      fs.mkdirSync(path.dirname(componentPath), { recursive: true });
      fs.mkdirSync(path.dirname(shimPath), { recursive: true });

      // Write a component with many errors
      const lines: string[] = [
        `import React from "react";`,
        ``,
        `export default function Component() {`,
      ];
      // Generate 100 type errors
      for (let i = 0; i < 100; i++) {
        lines.push(`  const x${i}: string = ${i};`);
      }
      lines.push(`  return React.createElement("div");`);
      lines.push(`}`);
      // These aren't actually type errors since numbers CAN be assigned to string...
      // Let's make actual errors:
      fs.writeFileSync(
        componentPath,
        `import React from "react";

export default function Component() {
  ${Array.from({ length: 60 }, (_, i) => `const a${i}: never = ${i};`).join("\n  ")}
  return React.createElement("div");
}
`,
      );

      generateTypeShim(shimPath);
      const tsconfigPath = generateTsconfigVisuals(
        dir,
        [componentPath],
        shimPath,
      );

      const result = await validateStatic(componentPath, tsconfigPath);
      if (!result.pass) {
        // Verify stderr is at most 50 lines (plus some slack for empty lines)
        const lineCount = result.stderr.split("\n").length;
        expect(lineCount).toBeLessThanOrEqual(51); // 50 lines + possible trailing newline
      }
    } finally {
      cleanupDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Error context extraction tests
// ---------------------------------------------------------------------------

describe("extractSourceSnippet", () => {
  it("should extract lines around a given line number", () => {
    const dir = createTempDir();
    try {
      const filePath = writeFixture(
        dir,
        "test.tsx",
        Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"),
      );

      const snippet = extractSourceSnippet(filePath, 10, 3);
      // Should show lines 7-13 (10-3 to 10+3) with >>> marker on line 10
      expect(snippet).toContain(">>>   10: line 10");
      expect(snippet).toContain("    7: line 7");
      expect(snippet).toContain("   13: line 13");
    } finally {
      cleanupDir(dir);
    }
  });
});

describe("extractTscErrorContext", () => {
  it("should parse tsc error format and extract snippets", () => {
    const dir = createTempDir();
    try {
      const filePath = writeFixture(
        dir,
        "Component.tsx",
        [
          "import React from 'react';",
          "export default function Component() {",
          "  const x: string = 42;", // line 3 - error
          "  return React.createElement('div');",
          "}",
        ].join("\n"),
      );

      const stderr = `${filePath}(3,7): error TS2322: Type 'number' is not assignable to type 'string'.`;

      const context = extractTscErrorContext(filePath, stderr);
      expect(context).toContain("3:");
      expect(context).toContain(">>>");
    } finally {
      cleanupDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Combined validateComponent tests
// ---------------------------------------------------------------------------

describe("validateComponent", () => {
  it("should fail immediately on AST scan violation (forbidden import)", async () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "src/blocks/B01/Component.tsx",
        `import React from "react";
import * as fs from "fs";

export default function Component() {
  return React.createElement("div");
}
`,
      );

      const result = await validateComponent(tsx, {
        buildOutDir: dir,
        runRenderSmoke: false,
      });

      expect(result.pass).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((e) => e.includes("forbidden") || e.includes("Forbidden")),
      ).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should fail on AST scan violation: require()", async () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "src/blocks/B01/Component.tsx",
        `import React from "react";

export default function Component() {
  const fs = require("fs");
  return null;
}
`,
      );

      const result = await validateComponent(tsx, {
        buildOutDir: dir,
        runRenderSmoke: false,
      });

      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.includes("require"))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should fail on tsc type errors for a component with type issues", async () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "src/blocks/B01/Component.tsx",
        `import React from "react";

export default function Component() {
  const x: string = 42;
  return React.createElement("div");
}
`,
      );

      const result = await validateComponent(tsx, {
        buildOutDir: dir,
        runRenderSmoke: false,
      });

      expect(result.pass).toBe(false);
      // Should mention TypeScript
      expect(
        result.errors.some(
          (e) =>
            e.includes("TypeScript") ||
            e.includes("type-check") ||
            e.includes("TS"),
        ),
      ).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should pass for a valid component with no render smoke", async () => {
    const dir = createTempDir();
    try {
      const tsx = writeFixture(
        dir,
        "src/blocks/B01/Component.tsx",
        `import React from "react";
import { AbsoluteFill } from "remotion";

export default function Component(): React.ReactElement {
  return React.createElement(AbsoluteFill, null, "Hello World");
}
`,
      );

      const result = await validateComponent(tsx, {
        buildOutDir: dir,
        runRenderSmoke: false,
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      cleanupDir(dir);
    }
  });

  it("should return error when component file doesn't exist", async () => {
    const result = await validateComponent(
      "/nonexistent/path/Component.tsx",
      {
        buildOutDir: "/tmp",
        runRenderSmoke: false,
      },
    );

    expect(result.pass).toBe(false);
    expect(result.errors.some((e) => e.includes("not found"))).toBe(true);
  });
});