/**
 * title-card.ts — 片头标题帧（视频封面帧）
 *
 * 视频第一帧默认是黑场（块入场动画从透明淡入），文件管理器/播放器的
 * 缩略预览只能看到一张黑图。本模块在 concat 前生成一段恰好 1 帧的
 * 标题卡片段（主题底色 + 居中标题 + accent 下划线），拼到 partials
 * 最前面，让第 0 帧直接展示视频标题。
 *
 * 流程：
 *   1. ffprobe 首个 partial 的编码参数（分辨率/帧率/pix_fmt/time_base/音频参数）
 *   2. 用 headless Chrome 把标题 HTML 截成 PNG（与 html 块同一浏览器链，
 *      中文字体走 FONTCONFIG，与正片渲染口径一致）
 *   3. ffmpeg 把 PNG + 静音轨编成 1 帧 mp4，参数与 partial 对齐
 *   4. 自检生成段与参考段参数一致，不一致则放弃（返回 null），
 *      绝不让 concat 校验在标题帧上炸掉
 *
 * 任何一步失败都只降级为「无标题帧」，不阻断渲染。
 */

import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "@remotion/renderer";

import type { Script, Theme } from "../types/script.js";
import type { AutoVideoConfig } from "../config/defaults.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TitleCardOptions {
  /** Build output directory */
  buildDir: string;
  /** Script metadata（title/width/height/fps） */
  meta: Script["meta"];
  /** Resolved theme tokens（底色/前景/accent/字体） */
  theme: Theme;
  /** 首个 partial 的绝对路径，用作编码参数参考 */
  refPartialPath: string;
  /** Merged config（读 render.browser / htmlRender.browserExecutable） */
  config: AutoVideoConfig;
}

interface RefStreamParams {
  width: number;
  height: number;
  fps: string; // r_frame_rate，如 "30/1"
  pixFmt: string;
  sar: string;
  timeBase: string; // 如 "1/90000"
  audioSampleRate: number;
  audioChannels: number;
}

// ── ffprobe helpers ────────────────────────────────────────────────────────

function probeJson(filePath: string): any {
  const out = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_streams", filePath],
    { encoding: "utf-8", timeout: 30_000 },
  );
  return JSON.parse(out);
}

function probeRefParams(filePath: string): RefStreamParams {
  const info = probeJson(filePath);
  const v = (info.streams ?? []).find((s: any) => s.codec_type === "video");
  const a = (info.streams ?? []).find((s: any) => s.codec_type === "audio");
  if (!v) throw new Error(`no video stream in ${filePath}`);
  return {
    width: v.width,
    height: v.height,
    fps: v.r_frame_rate ?? "30/1",
    pixFmt: v.pix_fmt ?? "yuv420p",
    sar: v.sample_aspect_ratio ?? "", // 与 concat.ts probeVideoStreams 同口径（缺省为空串）
    timeBase: v.time_base ?? "1/90000",
    audioSampleRate: a ? Number(a.sample_rate) : 48000,
    audioChannels: a ? Number(a.channels) : 2,
  };
}

/** 校验生成段与参考段在 concat 关键字段上一致（口径同 concat.ts validatePartials）。 */
function segmentMatchesRef(segPath: string, ref: RefStreamParams): boolean {
  const info = probeJson(segPath);
  const v = (info.streams ?? []).find((s: any) => s.codec_type === "video");
  if (!v) return false;
  return (
    (v.codec_name ?? "") === "h264" &&
    v.width === ref.width &&
    v.height === ref.height &&
    (v.r_frame_rate ?? "") === ref.fps &&
    (v.pix_fmt ?? "") === ref.pixFmt &&
    (v.sample_aspect_ratio ?? "") === ref.sar &&
    (v.time_base ?? "") === ref.timeBase
  );
}

// ── Title card HTML ────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 估算标题字宽（em）：CJK 全角 ≈1，ASCII ≈0.55。 */
function estimateEms(title: string): number {
  let ems = 0;
  for (const ch of title) {
    ems = ems + (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55);
  }
  return ems;
}

export function buildTitleCardHtml(title: string, theme: Theme, width: number, _height: number): string {
  const bg = theme.colors.bg;
  const fg = theme.colors.fg;
  const accent = theme.colors.accent;
  const sans = theme.fonts.sans;
  // 标题占宽 ≤ 85% 画布；64px 为基准字号，超长自动缩
  const fontSize = Math.min(64, Math.floor((width * 0.85) / Math.max(estimateEms(title), 1)));
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:${bg};width:${width}px;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="text-align:center;font-family:${sans};color:${fg}">
    <div style="font-size:${fontSize}px;font-weight:700;line-height:1.4;white-space:nowrap">${escapeHtml(title)}</div>
    <div style="margin:36px auto 0;height:6px;width:160px;background:${accent};border-radius:3px"></div>
  </div>
</body></html>`;
}

// ── Browser resolution（与 html-render.ts 同一优先级链的精简版） ──────────

async function resolveBrowserPath(config: AutoVideoConfig): Promise<string> {
  if (config.htmlRender?.browserExecutable) return config.htmlRender.browserExecutable;
  if (config.render?.browser) return config.render.browser;
  const status = await ensureBrowser();
  if (status.type === "user-defined-path" || status.type === "local-puppeteer-browser") {
    return status.path;
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  throw new Error("no Chrome executable found for title card capture");
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * 生成 1 帧标题卡片段，返回相对 buildDir 的路径（"output/title-card.mp4"）。
 * 失败返回 null（调用方照常拼接，不带标题帧）。
 */
export async function buildTitleCardSegment(opts: TitleCardOptions): Promise<string | null> {
  const { buildDir, meta, theme, refPartialPath, config } = opts;
  const relPath = "output/title-card.mp4";
  const outDir = path.join(buildDir, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const pngPath = path.join(outDir, "title-card.png");
  const htmlPath = path.join(outDir, "title-card.html");
  const segPath = path.join(buildDir, relPath);

  try {
    const ref = probeRefParams(refPartialPath);

    // ── 1. 标题 HTML → PNG ────────────────────────────────────────────────
    fs.writeFileSync(htmlPath, buildTitleCardHtml(meta.title, theme, ref.width, ref.height), "utf-8");

    const browser = await puppeteer.launch({
      executablePath: await resolveBrowserPath(config),
      headless: "shell",
      args: ["--no-sandbox", "--allow-file-access-from-files", "--force-device-scale-factor=1"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: ref.width, height: ref.height, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.screenshot({ path: pngPath, type: "png", omitBackground: false });
    } finally {
      await browser.close().catch(() => {});
    }

    // ── 2. PNG + 静音 → 1 帧 mp4（参数对齐 partial） ──────────────────────
    const [fpsNum] = ref.fps.split("/").map(Number);
    const fps = fpsNum || meta.fps || 30;
    const timescale = ref.timeBase.split("/")[1] || "90000";
    const dur = (1 / fps).toFixed(6);
    const channelLayout = ref.audioChannels === 1 ? "mono" : "stereo";

    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loop", "1",
        "-framerate", String(fps),
        "-i", pngPath,
        "-f", "lavfi",
        "-i", `anullsrc=r=${ref.audioSampleRate}:cl=${channelLayout}`,
        "-t", dur,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", ref.pixFmt,
        "-r", String(fps),
        "-video_track_timescale", timescale,
        "-c:a", "aac",
        "-ar", String(ref.audioSampleRate),
        "-ac", String(ref.audioChannels),
        segPath,
      ],
      { encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] },
    );

    // ── 3. 参数自检，不一致则放弃标题帧 ───────────────────────────────────
    if (!segmentMatchesRef(segPath, ref)) {
      console.warn(`[title-card] 生成段编码参数与 partial 不一致，跳过标题帧`);
      try { fs.unlinkSync(segPath); } catch {}
      return null;
    }

    console.log(`[title-card] 标题帧生成 → ${relPath}（"${meta.title}"）`);
    return relPath;
  } catch (err) {
    console.warn(
      `[title-card] 标题帧生成失败，按无标题帧继续：${(err as Error).message ?? err}`,
    );
    try { if (fs.existsSync(segPath)) fs.unlinkSync(segPath); } catch {}
    return null;
  }
}
