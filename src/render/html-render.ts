/**
 * html-render.ts — Headless Chrome renderer for @visual: html blocks.
 *
 * Renders user-authored HTML/CSS/JS into a partial MP4 using puppeteer-core
 * + the Remotion-installed Chrome Headless Shell (no extra browser download).
 *
 * Phase 1 (MVP): static screenshot + audio mixing.
 *   - Single PNG screenshot captured at meta dimensions.
 *   - ffmpeg loops the frame for the block duration and mixes the block WAV
 *     with adelay=enterSec (matching Remotion's <Sequence from={enterFrames}>).
 *   - Encoding parameters mirror Remotion's renderMedia output so the partial
 *     passes concat's validatePartials (h264 / yuv420p / same fps & SAR).
 *
 * Phase 2 (future): __seek per-frame animation + enter/exit wrapper + subtitle layer.
 * See docs/architecture/HTML_VISUAL_PRD.md §5 / §11.
 *
 * PRD references: §4.2 (render flow), §4.3 (browser chain), §8.2 (sandbox),
 *                §10.2 (ffmpeg command), §9.1 (cache key).
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "@remotion/renderer";

import type { Block, Script, Theme } from "../types/script.js";
import type {
  AutoVideoConfig,
  QualityConfig,
  HtmlRenderConfig,
} from "../config/defaults.js";
import { DEFAULT_HTML_RENDER } from "../config/defaults.js";

// ── Version tag ────────────────────────────────────────────────────────────

/**
 * Bumped whenever the framework injection layer (wrapper, subtitle DOM,
 * enter/exit mapping) or the ffmpeg pipeline changes in a way that would
 * produce visibly different output. Part of the partial cache key (§9.1) so
 * old partials are invalidated.
 */
export const HTML_RENDERER_VERSION = "p1-static-1";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RenderHtmlBlockOptions {
  /** Build output directory (cwd for all relative paths) */
  buildDir: string;
  /** Script metadata (width/height/fps/theme/subtitleSafeBottom) */
  meta: Script["meta"];
  /** Resolved theme tokens (for background color; subtitle layer in P2) */
  theme: Theme;
  /** Encoding quality (mirrors Remotion renderMedia settings) */
  quality: QualityConfig;
  /** Absolute path to write the partial MP4 */
  outputMp4Path: string;
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

// ── ffmpeg color tagging (§10.2, mirrors lipsync.ts colorSpaceArgs) ───────

function colorSpaceArgs(colorSpace: string): string[] {
  if (colorSpace === "bt709") {
    return ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
  }
  if (colorSpace === "bt2020-ncl") {
    return ["-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "smpte2084"];
  }
  return [];
}

// ── Main render function ───────────────────────────────────────────────────

/**
 * Render a single html block to a partial MP4.
 *
 * Phase 1 flow:
 *   1. Resolve HTML file path + audio path + timing
 *   2. Launch headless Chrome (puppeteer-core, headless: 'shell')
 *   3. Set viewport to meta dimensions
 *   4. Intercept requests (file:// whitelist = buildDir; block http/https)
 *   5. Navigate to the HTML file
 *   6. Capture a single PNG screenshot (static)
 *   7. ffmpeg: -loop 1 -i frame.png -i audio.wav → mp4 (h264 + aac)
 *
 * @param block  Block with visual.htmlPath, audio.wavPath, timing
 * @param opts   Render options (buildDir, meta, quality, output path, config)
 */
export async function renderHtmlBlock(
  block: Block,
  opts: RenderHtmlBlockOptions,
): Promise<void> {
  const { buildDir, meta, theme, quality, outputMp4Path, config, signal } = opts;

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

  const audioRelPath = block.audio?.wavPath;
  if (!audioRelPath) {
    throw new HtmlRenderError(
      `Block ${block.id}: audio.wavPath is not set (run TTS stage first).`,
      "ERR_AUDIO_MISSING",
    );
  }
  const audioAbsPath = path.resolve(buildDir, audioRelPath);
  if (!fs.existsSync(audioAbsPath)) {
    throw new HtmlRenderError(
      `Block ${block.id}: audio WAV not found at ${audioAbsPath}.`,
      "ERR_AUDIO_FILE_MISSING",
    );
  }

  const timing = block.timing;
  if (!timing) {
    throw new HtmlRenderError(
      `Block ${block.id}: timing is not set (render stage should compute it).`,
      "ERR_TIMING_MISSING",
    );
  }

  // ── Resolve browser ────────────────────────────────────────────────────

  const browserPath = await resolveBrowserPath(config);
  const htmlCfg: HtmlRenderConfig = {
    ...DEFAULT_HTML_RENDER,
    ...config.htmlRender,
  };

  // ── Temp dir for screenshot ────────────────────────────────────────────

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-html-"));
  const screenshotPath = path.join(tmpDir, `${block.id}-frame.png`);

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

    // ── Probe for __seek (Phase 2 animation hook) ───────────────────────
    // P1 only does static screenshots; if __seek exists we note it but still
    // capture a static first frame. P2 will do per-frame seek.

    const hasSeek = await page
      .waitForFunction(
        () => typeof (window as any).__seek === "function",
        { timeout: 1000 },
      )
      .then(() => true)
      .catch(() => false);

    if (hasSeek) {
      console.warn(
        `[html-render] Block ${block.id}: HTML defines window.__seek but P1 only ` +
          `captures a static first frame. Animation will be frozen at t=0. ` +
          `(Phase 2 will support per-frame seek.)`,
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
      path: screenshotPath,
      type: "png",
      omitBackground: false,
    });

    console.log(`[html-render] Block ${block.id}: screenshot captured → ${screenshotPath}`);

    if (signal?.aborted) throw new HtmlRenderError("Cancelled", "ERR_CANCELLED");

    // ── Close browser before ffmpeg (frees memory) ──────────────────────

    await browser.close();
    browser = null;

    // ── ffmpeg: static frame + audio → partial mp4 (§10.2) ──────────────

    await encodePartialMp4({
      screenshotPath,
      audioPath: audioAbsPath,
      outputMp4Path,
      fps: meta.fps,
      totalSec: timing.totalSec,
      enterMs: Math.round(timing.enterSec * 1000),
      quality,
      signal,
      blockId: block.id,
    });

    console.log(`[html-render] Block ${block.id}: partial mp4 written → ${outputMp4Path}`);
  } finally {
    // Ensure browser is closed even on error
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    // Clean up temp screenshot
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// ── ffmpeg encoding ────────────────────────────────────────────────────────

interface EncodeOptions {
  screenshotPath: string;
  audioPath: string;
  outputMp4Path: string;
  fps: number;
  totalSec: number;
  enterMs: number;
  quality: QualityConfig;
  signal?: AbortSignal;
  blockId: string;
}

/**
 * Encode a static screenshot + audio WAV into a partial MP4.
 *
 * ffmpeg command (§10.2, static档):
 *   ffmpeg -y -loop 1 -framerate {fps} -i frame.png \
 *     -i audio.wav \
 *     -map 0:v -map 1:a \
 *     -af "adelay={enterMs}:all=1,apad" \
 *     -t {totalSec} \
 *     -c:v libx264 -preset {preset} -crf {crf} \
 *     -pix_fmt {pixelFormat} {colorTags} \
 *     -c:a aac -b:a 192k -ar 48000 -ac 2 \
 *     {output}
 *
 * - `-loop 1`: repeat the single PNG for the whole duration.
 * - `adelay`: shift audio by enterMs to match Remotion's <Sequence from={enterFrames}>.
 * - `apad` + `-t`: pad audio with silence so it matches totalSec (WAV short → silence).
 * - Audio: AAC 48kHz stereo — must match Remotion's renderMedia output for concat.
 */
function encodePartialMp4(opts: EncodeOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const {
      screenshotPath,
      audioPath,
      outputMp4Path,
      fps,
      totalSec,
      enterMs,
      quality,
      signal,
      blockId,
    } = opts;

    const args: string[] = [
      "-y",
      "-loop", "1",
      "-framerate", String(fps),
      "-i", screenshotPath,
      "-i", audioPath,
      "-map", "0:v",
      "-map", "1:a",
      "-af", `adelay=${enterMs}:all=1,apad`,
      "-t", String(totalSec),
      "-c:v", "libx264",
      "-preset", quality.x264Preset,
      "-crf", String(quality.crf),
      "-pix_fmt", quality.pixelFormat,
      ...colorSpaceArgs(quality.colorSpace),
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      outputMp4Path,
    ];

    console.log(`[html-render] Block ${blockId}: ffmpeg ${args.join(" ")}`);

    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    // Forward cancellation
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGKILL");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve();
      } else if (signal?.aborted) {
        reject(new HtmlRenderError(`Block ${blockId}: ffmpeg cancelled`, "ERR_CANCELLED"));
      } else {
        reject(
          new HtmlRenderError(
            `Block ${blockId}: ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`,
            "ERR_FFMPEG_FAILED",
          ),
        );
      }
    });

    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(
        new HtmlRenderError(
          `Block ${blockId}: failed to spawn ffmpeg: ${err.message}`,
          "ERR_FFMPEG_SPAWN",
        ),
      );
    });
  });
}
