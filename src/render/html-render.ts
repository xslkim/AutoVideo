/**
 * html-render.ts — Headless Chrome screenshotter for @visual: html blocks.
 *
 * Captures user-authored HTML/CSS/JS into a single static PNG using
 * puppeteer-core + the Remotion-installed Chrome Headless Shell (no extra
 * browser download).
 *
 * Phase 2 flow: the PNG is placed under buildDir/public/html-shots/ and the
 * block is rendered through Remotion's BlockComposition like every other
 * block — the screenshot is the visual base layer (<Img>), SubtitleOverlay
 * and Audio stack on top, and BlockFrame applies enter/exit. Subtitles and
 * transitions are therefore identical to animation/video blocks.
 *
 * PRD references: §4.3 (browser chain), §8.2 (sandbox), §9.1 (cache key).
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "@remotion/renderer";

import type { Block, Script, Theme } from "../types/script.js";
import type { AutoVideoConfig, HtmlRenderConfig } from "../config/defaults.js";
import { DEFAULT_HTML_RENDER } from "../config/defaults.js";

// ── Version tag ────────────────────────────────────────────────────────────

/**
 * Bumped whenever the capture layer (wrapper, sandbox, screenshot settings)
 * or the downstream composition changes in a way that would produce visibly
 * different output. Part of the partial cache key (§9.1) so old partials are
 * invalidated.
 *
 * p2-remotion-1: html blocks now render through Remotion (screenshot base +
 * SubtitleOverlay + enter/exit) instead of the P1 ffmpeg static loop.
 */
export const HTML_RENDERER_VERSION = "p2-remotion-1";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CaptureHtmlScreenshotOptions {
  /** Build output directory (cwd for all relative paths) */
  buildDir: string;
  /** Script metadata (width/height used for the viewport) */
  meta: Script["meta"];
  /** Resolved theme tokens (for background color) */
  theme: Theme;
  /** Absolute path to write the PNG screenshot */
  outputPngPath: string;
  /** Merged config (htmlRender section read for browser/timeouts) */
  config: AutoVideoConfig;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class HtmlRenderError extends Error {
  code: string;
  constructor(message: string, code = "ERR_HTML_RENDER_FAILED") {
    super(message);
    this.name = "HtmlRenderError";
    this.code = code;
  }
}

// ── Browser resolution (§4.3) ──────────────────────────────────────────────

/**
 * Resolve the Chrome executable path via the priority chain:
 *   1. config.htmlRender.browserExecutable (explicit override)
 *   2. config.render.browser (shared with Remotion)
 *   3. @remotion/renderer ensureBrowser() → BrowserStatus.path
 *   4. PUPPETEER_EXECUTABLE_PATH env var
 *   5. System google-chrome / chromium (with warning)
 *
 * @returns Absolute path to a Chrome/Headless Shell executable.
 * @throws HtmlRenderError if no browser can be found.
 */
async function resolveBrowserPath(config: AutoVideoConfig): Promise<string> {
  const htmlCfg: HtmlRenderConfig = {
    ...DEFAULT_HTML_RENDER,
    ...config.htmlRender,
  };

  // 1. Explicit htmlRender override
  if (htmlCfg.browserExecutable) {
    return htmlCfg.browserExecutable;
  }

  // 2. Shared render.browser config
  if (config.render?.browser) {
    return config.render.browser;
  }

  // 3. Remotion's ensureBrowser() — returns the chrome-headless-shell path
  try {
    const status = await ensureBrowser();
    if (status.type === "user-defined-path" || status.type === "local-puppeteer-browser") {
      return status.path;
    }
  } catch {
    // Fall through to env / system lookup
  }

  // 4. PUPPETEER_EXECUTABLE_PATH
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // 5. System browser (last resort — determinism may suffer)
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const resolved = await resolveSystemBinary(candidate);
      if (resolved) {
        console.warn(
          `[html-render] Falling back to system browser "${resolved}". ` +
            `Determinism may differ from Remotion's Chrome Headless Shell; ` +
            `consider setting config.render.browser or PUPPETEER_EXECUTABLE_PATH.`,
        );
        return resolved;
      }
    } catch {
      // continue
    }
  }

  throw new HtmlRenderError(
    "No Chrome executable found. Set config.render.browser, config.htmlRender.browserExecutable, " +
      "PUPPETEER_EXECUTABLE_PATH, or ensure @remotion/renderer's Chrome Headless Shell is installed.",
    "ERR_BROWSER_NOT_FOUND",
  );
}

/** Look up a binary on PATH (cross-platform `which`). */
function resolveSystemBinary(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      os.platform() === "win32" ? "where" : "which",
      [name],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
      const trimmed = out.trim().split("\n")[0]?.trim();
      resolve(trimmed || null);
    });
    child.on("error", () => resolve(null));
  });
}

// ── Main capture function ──────────────────────────────────────────────────

/**
 * Capture a single static PNG screenshot of an html block.
 *
 * Flow:
 *   1. Resolve HTML file path
 *   2. Launch headless Chrome (puppeteer-core, headless: 'shell')
 *   3. Set viewport to meta dimensions
 *   4. Intercept requests (file:// whitelist = buildDir; block http/https)
 *   5. Navigate to the HTML file
 *   6. Capture PNG screenshot → opts.outputPngPath
 *
 * @param block  Block with visual.htmlPath
 * @param opts   Capture options (buildDir, meta, theme, output path, config)
 */
export async function captureHtmlScreenshot(
  block: Block,
  opts: CaptureHtmlScreenshotOptions,
): Promise<void> {
  const { buildDir, meta, theme, outputPngPath, config, signal } = opts;

  // ── Validate inputs ────────────────────────────────────────────────────

  if (!block.visual.htmlPath) {
    throw new HtmlRenderError(
      `Block ${block.id}: visual.htmlPath is not set (compile should have written it).`,
      "ERR_HTML_PATH_MISSING",
    );
  }

  const htmlAbsPath = path.resolve(buildDir, block.visual.htmlPath);
  if (!fs.existsSync(htmlAbsPath)) {
    throw new HtmlRenderError(
      `Block ${block.id}: HTML file not found at ${htmlAbsPath}.`,
      "ERR_HTML_FILE_MISSING",
    );
  }

  // ── Resolve browser ────────────────────────────────────────────────────

  const browserPath = await resolveBrowserPath(config);
  const htmlCfg: HtmlRenderConfig = {
    ...DEFAULT_HTML_RENDER,
    ...config.htmlRender,
  };

  fs.mkdirSync(path.dirname(outputPngPath), { recursive: true });

  let browser: puppeteer.Browser | null = null;

  try {
    if (signal?.aborted) throw new HtmlRenderError("Cancelled", "ERR_CANCELLED");

    // ── Launch Chrome ────────────────────────────────────────────────────

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: "shell",
      args: [
        "--no-sandbox",
        "--allow-file-access-from-files",
        "--block-new-web-contents",
        "--disable-features=SitePerProcess",
        `--force-device-scale-factor=1`,
      ],
    });

    if (signal?.aborted) {
      throw new HtmlRenderError("Cancelled", "ERR_CANCELLED");
    }

    const page = await browser.newPage();

    // Viewport = canvas dimensions (§4.2 step 3). deviceScaleFactor 1 so
    // screenshot pixels map 1:1 to viewport pixels.
    await page.setViewport({
      width: meta.width,
      height: meta.height,
      deviceScaleFactor: 1,
    });

    // ── Request interception (§8.2) ─────────────────────────────────────
    // Allow data:/blob:/about:blank; allow file: only within buildDir;
    // block all http/https (offline + determinism).

    const allowedRoot = path.resolve(buildDir);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        url === "about:blank"
      ) {
        return req.continue();
      }
      if (url.startsWith("file:")) {
        try {
          const p = path.resolve(
            decodeURIComponent(new URL(url).pathname),
          );
          if (p === allowedRoot || p.startsWith(allowedRoot + path.sep)) {
            return req.continue();
          }
        } catch {
          // malformed file:// URL → block
        }
        return req.abort("blockedbyclient");
      }
      // Block all http/https
      return req.abort("blockedbyclient");
    });

    // ── Navigate to HTML ────────────────────────────────────────────────

    const fileUrl = `file://${htmlAbsPath}`;
    await page.goto(fileUrl, {
      waitUntil: "networkidle0",
      timeout: htmlCfg.frameTimeoutMs,
    });

    if (signal?.aborted) throw new HtmlRenderError("Cancelled", "ERR_CANCELLED");

    // ── Probe for __seek (animation hook) ───────────────────────────────
    // The capture is still a static first frame; if __seek exists we note
    // it but do not seek. Per-frame seek is a future enhancement.

    const hasSeek = await page
      .waitForFunction(
        () => typeof (window as any).__seek === "function",
        { timeout: 1000 },
      )
      .then(() => true)
      .catch(() => false);

    if (hasSeek) {
      console.warn(
        `[html-render] Block ${block.id}: HTML defines window.__seek but only ` +
          `a static first frame is captured. Animation will be frozen at t=0.`,
      );
    }

    // Set background to theme.colors.bg so any transparent areas match
    // Remotion's AbsoluteFill background.
    await page.evaluate((bg) => {
      document.body.style.backgroundColor = bg;
    }, theme.colors.bg);

    if (signal?.aborted) throw new HtmlRenderError("Cancelled", "ERR_CANCELLED");

    // ── Screenshot ──────────────────────────────────────────────────────

    await page.screenshot({
      path: outputPngPath,
      type: "png",
      omitBackground: false,
    });

    console.log(`[html-render] Block ${block.id}: screenshot captured → ${outputPngPath}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}
