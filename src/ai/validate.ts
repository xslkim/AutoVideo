/**
 * T4.4 — Component Validation (tsc + render smoke)
 *
 * Validates LLM-generated React components:
 * 1. AST static scan: blocks forbidden imports/calls
 * 2. tsc type-check: run isolated TypeScript compiler with tsconfig.visuals.json
 * 3. Render smoke: renderStill a single frame PNG, verify non-pure-black/white
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "@babel/parser";
import type {
  File as BabelFile,
  ImportDeclaration,
  CallExpression,
  MemberExpression,
  NewExpression,
} from "@babel/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FORBIDDEN_MODULES = new Set([
  "fs", "path", "child_process", "http", "https", "net", "os", "crypto",
  "stream", "buffer", "url", "dns", "tls", "cluster", "dgram", "readline",
  "repl", "timers", "zlib", "punycode", "querystring", "string_decoder",
  "sys", "vm", "worker_threads", "perf_hooks", "async_hooks",
]);

const FORBIDDEN_GLOBALS = new Set(["eval", "Function", "require"]);

// --- Types ---

export interface ValidationResult { pass: boolean; errors: string[]; }
export interface ASTScanResult { pass: boolean; errors: string[]; imports: string[]; }
export interface TSCResult { pass: boolean; stderr: string; }
export interface RenderSmokeResult { pass: boolean; error?: string; outputPath?: string; }

export interface ValidateComponentOptions {
  buildOutDir: string;
  scriptPath?: string;
  projectRoot?: string;
  fps?: number;
  width?: number;
  height?: number;
  runRenderSmoke?: boolean;
  renderTimeoutMs?: number;
}

// --- Ensure node_modules available for tsc module resolution ---

function ensureNodeModules(outDir: string, projectRoot?: string): void {
  const nmPath = path.join(outDir, "node_modules");
  if (fs.existsSync(nmPath)) return;
  const root = projectRoot ?? process.cwd();
  const rootNm = path.join(root, "node_modules");
  if (!fs.existsSync(rootNm)) return;
  try {
    fs.symlinkSync(rootNm, nmPath, "junction");
  } catch { /* skip */ }
}

// --- tsconfig.visuals.json ---

export function generateTsconfigVisuals(
  outDir: string,
  componentPaths: string[],
  shimPath: string,
  projectRoot?: string,
): string {
  ensureNodeModules(outDir, projectRoot);
  const includePaths = [
    ...componentPaths.map((p) => path.relative(outDir, p).replace(/\\/g, "/")),
    path.relative(outDir, shimPath).replace(/\\/g, "/"),
  ];
  const tsconfig = {
    compilerOptions: {
      types: ["react", "remotion"],
      lib: ["ES2022", "DOM"],
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      allowJs: false,
      skipLibCheck: true,
      moduleResolution: "bundler",
      module: "esnext",
      target: "es2022",
      esModuleInterop: true,
      resolveJsonModule: true,
      isolatedModules: true,
    },
    include: includePaths,
  };
  const tsconfigPath = path.join(outDir, "tsconfig.visuals.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  return tsconfigPath;
}

// --- Type shim ---

export function generateTypeShim(shimPath: string): void {
  const content = `// Auto-generated type shim for component validation
export interface ThemeColors {
  bg: string; fg: string; accent: string; muted: string;
  code: { bg: string; fg: string; keyword: string; string: string; comment: string; };
}
export interface ThemeFonts { sans: string; mono: string; }
export interface ThemeSpacing { unit: number; }
export interface ThemeSubtitle {
  fontFamily: string; fontSizePct: number; lineHeight: number;
  maxWidthPct: number; backgroundColor: string; paddingPx: number;
}
export interface Theme {
  name: string; colors: ThemeColors; fonts: ThemeFonts;
  spacing: ThemeSpacing; subtitle: ThemeSubtitle;
}
export interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: Theme; fps: number;
}
`;
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(shimPath, content);
}

// --- AST Static Scan ---

export function astStaticScan(tsxPath: string): ASTScanResult {
  const errors: string[] = [];
  const imports: string[] = [];
  const code = fs.readFileSync(tsxPath, "utf-8");
  let ast: BabelFile;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err: unknown) {
    return {
      pass: false,
      errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
      imports: [],
    };
  }

  function getLine(node: unknown): string {
    const n = node as Record<string, unknown>;
    const loc = n.loc as { start: { line: number } } | undefined;
    return loc?.start?.line != null ? String(loc.start.line) : "?";
  }

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    if (n.type === "ImportDeclaration") {
      const source = String((n as unknown as ImportDeclaration).source.value).replace(/^node:/, "");
      const baseModule = source.split("/")[0];
      if (FORBIDDEN_MODULES.has(baseModule)) {
        errors.push(`Forbidden import: "${source}" (line ${getLine(node)})`);
      } else {
        imports.push(source);
      }
    }

    if (n.type === "CallExpression") {
      const callExpr = n as unknown as CallExpression;
      if (callExpr.callee.type === "Identifier" && FORBIDDEN_GLOBALS.has(callExpr.callee.name)) {
        errors.push(`Forbidden call: ${callExpr.callee.name}() (line ${getLine(node)})`);
      }
      if (callExpr.callee.type === "MemberExpression") {
        const memberExpr = callExpr.callee as MemberExpression;
        if (memberExpr.property.type === "Identifier" && FORBIDDEN_GLOBALS.has(memberExpr.property.name)) {
          errors.push(`Forbidden call: .${memberExpr.property.name}() (line ${getLine(node)})`);
        }
      }
    }

    if (n.type === "NewExpression") {
      const newExpr = n as unknown as NewExpression;
      if (newExpr.callee.type === "Identifier" && newExpr.callee.name === "Function") {
        errors.push(`Forbidden: new Function() (line ${getLine(node)})`);
      }
    }

    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "type" || key === "range") continue;
      const child = n[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && (item as Record<string, unknown>).type) walk(item);
        }
      } else if (child && typeof child === "object" && (child as Record<string, unknown>).type) {
        walk(child);
      }
    }
  }

  walk(ast);
  return { pass: errors.length === 0, errors, imports };
}

// --- tsc type-check ---

// Resolve AutoVideo project root from this source file's location.
// When compiled to dist/server/src/ai/, we need 4 levels up; in src/ai/, 2 levels up.
const __validateDirname = path.dirname(new URL(import.meta.url).pathname);
const _projectRoot = __validateDirname.includes(path.join('dist', 'server'))
  ? path.resolve(__validateDirname, '..', '..', '..', '..')
  : path.resolve(__validateDirname, '..', '..');

export async function validateStatic(tsxPath: string, tsconfigPath: string): Promise<TSCResult> {
  const tscPath = path.join(_projectRoot, "node_modules", ".bin", "tsc");
  if (!fs.existsSync(tscPath)) {
    return { pass: false, stderr: `tsc binary not found in node_modules/.bin (looked at ${tscPath})` };
  }
  try {
    const { stdout, stderr } = await execFileAsync(tscPath, ["-p", tsconfigPath], {
      cwd: path.dirname(tsconfigPath),
      timeout: 30000,
      env: { ...process.env },
      maxBuffer: 1024 * 1024,
    });
    const combined = (stdout || "") + (stderr || "");
    if (combined.trim().length > 0) {
      return { pass: false, stderr: combined.split("\n").slice(0, 50).join("\n") };
    }
    return { pass: true, stderr: "" };
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const output = (e.stderr || e.stdout || e.message || "").toString();
    return { pass: false, stderr: output.split("\n").slice(0, 50).join("\n") };
  }
}

// --- Render smoke ---

/**
 * Render a single mid-frame PNG of the component into a temp directory and
 * return its path WITHOUT deleting it. The caller is responsible for calling
 * `cleanupStill(tempDir)` once the PNG is no longer needed.
 *
 * This is the shared rendering primitive used by both the render-smoke check
 * and the visual-quality feedback loop (deterministic metrics + multimodal
 * review), all of which need the rendered still to inspect.
 */
export interface RenderStillResult {
  ok: boolean;
  /** First rendered frame; kept for callers that only need one still. */
  pngPath?: string;
  /** Every rendered frame, in the order of `frameFractions` (default: one mid-frame). */
  pngPaths?: string[];
  tempDir: string;
  error?: string;
}

export async function renderComponentStill(
  tsxPath: string,
  options: {
    buildOutDir: string;
    width: number;
    height: number;
    fps: number;
    durationSec?: number;
    theme?: Record<string, unknown>;
    projectRoot?: string;
    /**
     * Fractions (0..1) of `durationSec` to render, one PNG each. A single
     * mid-frame still cannot show motion — pass several fractions spread
     * across the timeline (e.g. [0.05, 0.35, 0.65, 0.95]) to inspect
     * choreography instead of just composition. Defaults to one mid-frame.
     */
    frameFractions?: number[];
  },
): Promise<RenderStillResult> {
  const { buildOutDir, width, height, fps, durationSec = 5, theme } = options;
  const fractions = options.frameFractions?.length ? options.frameFractions : [0.5];
  // Unique temp dir so concurrent block renders never collide.
  // Must be absolute — the bundler requires an absolute output path.
  const tempDir = path.resolve(
    buildOutDir,
    ".visual-still",
    `still-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const componentRelPath = path.relative(tempDir, tsxPath).replace(/\\/g, "/");
    const rootContent = generateSmokeTestRoot(componentRelPath, { width, height, fps, tempDurationSec: durationSec, theme });
    const rootPath = path.join(tempDir, "SmokeRoot.tsx");
    fs.writeFileSync(rootPath, rootContent);
    const publicDir = path.join(buildOutDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    ensureNodeModules(tempDir, options.projectRoot);

    const bundler = await import("@remotion/bundler");
    const renderer = await import("@remotion/renderer");

    const bundleDir = path.join(tempDir, "bundle");
    const serveUrl = await bundler.bundle({ entryPoint: rootPath, publicDir, outDir: bundleDir });
    const composition = await renderer.selectComposition({ serveUrl, id: "SmokeTest", inputProps: {} });
    const totalFrames = Math.max(1, Math.floor(durationSec * fps));

    const pngPaths: string[] = [];
    for (let i = 0; i < fractions.length; i++) {
      const frame = Math.min(totalFrames - 1, Math.max(0, Math.round(fractions[i] * (totalFrames - 1))));
      const outputPath = path.join(tempDir, `still-${i}.png`);
      await renderer.renderStill({ composition, serveUrl, frame, output: outputPath, imageFormat: "png" });
      pngPaths.push(outputPath);
    }

    if (pngPaths.some((p) => !fs.existsSync(p))) {
      return { ok: false, tempDir, error: "Render output PNG not found" };
    }
    return { ok: true, pngPath: pngPaths[0], pngPaths, tempDir };
  } catch (err: unknown) {
    return { ok: false, tempDir, error: err instanceof Error ? err.message : String(err) };
  }
}

export function cleanupStill(tempDir: string): void {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

export async function validateRenderSmoke(
  tsxPath: string,
  tempDurationSec: number,
  fps: number,
  options: {
    buildOutDir: string;
    width: number;
    height: number;
    theme?: Record<string, unknown>;
    timeoutMs?: number;
    projectRoot?: string;
  },
): Promise<RenderSmokeResult> {
  const { buildOutDir, width, height, theme } = options;
  const still = await renderComponentStill(tsxPath, {
    buildOutDir, width, height, fps, durationSec: tempDurationSec, theme, projectRoot: options.projectRoot,
  });
  try {
    if (!still.ok || !still.pngPath) {
      return { pass: false, error: `Render smoke test failed: ${still.error ?? "unknown error"}` };
    }
    return await analyzeImage(still.pngPath);
  } finally {
    cleanupStill(still.tempDir);
  }
}

async function analyzeImage(imagePath: string): Promise<RenderSmokeResult> {
  if (!fs.existsSync(imagePath)) return { pass: false, error: "Output image not found" };
  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", [
      "-i", imagePath,
      "-vf", "colorchannelmixer=0=.2126:1=.7152:2=.0722,format=gray,signalstats",
      "-f", "null", "-",
    ], { timeout: 10000, maxBuffer: 256 * 1024 });
    const statsOutput = (stdout || "") + (stderr || "");
    const meanMatch = statsOutput.match(/lavfi\.signalstats\.YAVG=(\S+)/);
    if (meanMatch) {
      const mean = parseFloat(meanMatch[1]);
      if (mean < 2) return { pass: false, error: `Image appears to be pure black (mean brightness: ${mean.toFixed(2)})` };
      if (mean > 253) return { pass: false, error: `Image appears to be pure white (mean brightness: ${mean.toFixed(2)})` };
      return { pass: true, outputPath: imagePath };
    }
    return analyzeByFileSize(imagePath);
  } catch { return analyzeByFileSize(imagePath); }
}

function analyzeByFileSize(imagePath: string): RenderSmokeResult {
  const stats = fs.statSync(imagePath);
  const fileSizeKB = stats.size / 1024;
  if (fileSizeKB < 1) return { pass: false, error: `Image file too small (${fileSizeKB.toFixed(1)}KB), likely pure black/white` };
  return { pass: true, outputPath: imagePath };
}

function generateSmokeTestRoot(
  componentRelPath: string,
  options: { width: number; height: number; fps: number; tempDurationSec: number; theme?: Record<string, unknown>; },
): string {
  const { width, height, fps, tempDurationSec, theme } = options;
  const totalFrames = Math.max(1, Math.floor(tempDurationSec * fps));
  const defaultTheme = theme || {
    name: "dark-code",
    colors: { bg: "#1a1a2e", fg: "#e0e0e0", accent: "#64ffda", muted: "#6c6c8a", code: { bg: "#16213e", fg: "#e0e0e0", keyword: "#c792ea", string: "#c3e88d", comment: "#546e7a" } },
    fonts: { sans: "Inter, sans-serif", mono: "JetBrains Mono, monospace" },
    spacing: { unit: 8 },
    subtitle: { fontFamily: "Noto Sans SC, sans-serif", fontSizePct: 0.035, lineHeight: 1.4, maxWidthPct: 0.8, backgroundColor: "rgba(0,0,0,0.7)", paddingPx: 12 },
  };
  return `// Auto-generated smoke test root
import React from "react";
import { Composition, useCurrentFrame, useVideoConfig, registerRoot } from "remotion";
import Component from "${componentRelPath}";
const theme = ${JSON.stringify(defaultTheme, null, 2)};
const SmokeTestComp: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  return React.createElement(Component, {
    frame, durationInFrames: ${totalFrames}, width, height,
    subtitleSafeBottom: Math.round(height * 0.15), theme, fps,
  });
};
export const RemotionRoot: React.FC = () => {
  return React.createElement(Composition, {
    id: "SmokeTest", component: SmokeTestComp,
    durationInFrames: ${totalFrames}, fps: ${fps}, width: ${width}, height: ${height},
  });
};
registerRoot(RemotionRoot);
`;
}

// --- Combined validation ---

export async function validateComponent(
  tsxPath: string,
  options: ValidateComponentOptions,
): Promise<ValidationResult> {
  const { buildOutDir, runRenderSmoke = false, renderTimeoutMs = 30000, projectRoot, fps: fpsOverride, width: widthOverride, height: heightOverride } = options;
  if (!fs.existsSync(tsxPath)) return { pass: false, errors: [`Component file not found: ${tsxPath}`] };

  // Step 1: AST scan
  const astResult = astStaticScan(tsxPath);
  if (!astResult.pass) return { pass: false, errors: ["AST static scan failed (forbidden imports/calls detected):", ...astResult.errors] };

  // Step 2: tsc
  const shimDir = path.join(buildOutDir, "src", "shims");
  const shimPath = path.join(shimDir, "types.ts");
  generateTypeShim(shimPath);
  const tsconfigPath = generateTsconfigVisuals(buildOutDir, [tsxPath], shimPath, projectRoot);
  const tscResult = await validateStatic(tsxPath, tsconfigPath);
  if (!tscResult.pass) return { pass: false, errors: ["TypeScript type-check failed:", ...tscResult.stderr.split("\n").filter((l) => l.trim())] };

  // Step 3: Render smoke (optional)
  if (runRenderSmoke) {
    let fps = fpsOverride ?? 30;
    let width = widthOverride ?? 1920;
    let height = heightOverride ?? 1080;
    const tempDurationSec = 5;
    if (options.scriptPath && fs.existsSync(options.scriptPath)) {
      try {
        const script = JSON.parse(fs.readFileSync(options.scriptPath, "utf-8"));
        fps = fpsOverride ?? script.meta?.fps ?? 30;
        width = widthOverride ?? script.meta?.width ?? 1920;
        height = heightOverride ?? script.meta?.height ?? 1080;
      } catch { /* use defaults */ }
    }
    const smokeResult = await validateRenderSmoke(tsxPath, tempDurationSec, fps, { buildOutDir, width, height, timeoutMs: renderTimeoutMs, projectRoot });
    if (!smokeResult.pass) return { pass: false, errors: [`Render smoke test failed: ${smokeResult.error ?? "unknown error"}`] };
  }

  return { pass: true, errors: [] };
}

// --- Error context helpers ---

export function extractSourceSnippet(filePath: string, lineNumber: number, contextLines: number = 5): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const start = Math.max(0, lineNumber - contextLines - 1);
  const end = Math.min(lines.length, lineNumber + contextLines);
  return lines.slice(start, end).map((line, i) => {
    const lineNum = start + i + 1;
    const marker = lineNum === lineNumber ? ">>>" : "   ";
    return `${marker} ${lineNum.toString().padStart(4)}: ${line}`;
  }).join("\n");
}

export function extractTscErrorContext(tsxPath: string, stderr: string, maxSnippets: number = 3): string {
  const snippets: string[] = [];
  const escaped = tsxPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineRegex = new RegExp(`${escaped}\\((\\d+),(\\d+)\\)`, "g");
  let match;
  while ((match = lineRegex.exec(stderr)) !== null && snippets.length < maxSnippets) {
    snippets.push(extractSourceSnippet(tsxPath, parseInt(match[1], 10)));
  }
  return snippets.join("\n\n---\n\n");
}
