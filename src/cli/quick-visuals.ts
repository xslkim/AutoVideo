/**
 * AutoVideo — quick-visuals stage (quick-build only)
 *
 * 快速构建的视觉阶段替代品：不调用 LLM / 文生图 / Puppeteer，
 * 为每个需要视觉生成的块机械生成"文字简介卡片" Component.tsx：
 *   - animation 块        → 卡片（标题 + visual.description 原文）
 *   - 无 imageSource 的 image 块 → 卡片（同上），visualMode 改写为 'animation'
 *   - html 块             → 卡片（标题 + stripHtml(visual.description)），
 *                           visualMode 改写为 'animation'
 *   - video 块 / 有 imageSource 的 image 块 → 跳过（compile 已生成 wrapper，
 *     见 compile.ts Step 7.5/7.6）
 *
 * 改写后所有块均为 animation + componentPath，满足 assertRenderInputReady。
 */

import fs from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { Script, Block, ProgressEvent } from "../types/script.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class QuickVisualsError extends Error {
  code: string;
  constructor(message: string, code = "ERR_QUICK_VISUALS_FAILED") {
    super(message);
    this.name = "QuickVisualsError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Options / result
// ---------------------------------------------------------------------------

export interface QuickVisualsOptions {
  /** Path to script.json (inside the quick build out dir) */
  scriptPath: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Dry run mode — compute placeholders without writing files */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface QuickVisualsResult {
  script: Script;
  /** Blocks that got a placeholder card */
  placeholders: number;
  /** Blocks skipped (local image / video already set up by compile) */
  skipped: number;
}

// ---------------------------------------------------------------------------
// stripHtml — html 块的 visual.description 是 HTML 源码，提取纯文本
// ---------------------------------------------------------------------------

const HTML_TEXT_MAX = 500;

export function stripHtml(html: string): string {
  let text = html;
  // 去掉 script/style 整块内容
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // 去标签
  text = text.replace(/<[^>]+>/g, " ");
  // 解码常见实体（&amp; 最后解码，避免二次解码）
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  // 折叠空白
  text = text.replace(/\s+/g, " ").trim();
  // 截断
  if (text.length > HTML_TEXT_MAX) {
    text = text.slice(0, HTML_TEXT_MAX).trimEnd() + "…";
  }
  return text;
}

// ---------------------------------------------------------------------------
// 文字简介卡片组件模板（排版参照 remotion/library/components/KeyPoints.tsx）
// 文本经 JSON.stringify 注入，防模板注入。
// ---------------------------------------------------------------------------

function cardTsx(title: string, body: string): string {
  return `import React from "react";
import { AbsoluteFill } from "remotion";

interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: any; fps: number;
}

const TITLE = ${JSON.stringify(title)};
const BODY = ${JSON.stringify(body)};

const Component: React.FC<AnimationProps> = ({ width, height, subtitleSafeBottom, theme }) => {
  const bg = theme?.colors?.bg ?? "#10141f";
  const fg = theme?.colors?.fg ?? "#e6e8ee";
  const muted = theme?.colors?.muted ?? "#9aa4b2";
  const accent = theme?.colors?.accent ?? "#4f8cff";
  const marginX = Math.round(width * 0.08);
  const availH = height - subtitleSafeBottom;
  const titleSize = Math.round(height * 0.045);
  const bodySize = Math.round(height * 0.028);
  const labelSize = Math.round(height * 0.02);

  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      {/* Ambient accent wash, bottom-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: \`radial-gradient(ellipse at 82% 88%, \${accent} 0%, transparent 55%)\`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: Math.max(availH * 0.16, (availH - titleSize * 2 - bodySize * 8) / 2),
          left: marginX,
          width: width - marginX * 2,
        }}
      >
        {/* Mono label with accent rail */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: Math.round(height * 0.012),
            marginBottom: Math.round(height * 0.03),
          }}
        >
          <div
            style={{
              width: Math.round(height * 0.008),
              height: labelSize * 1.2,
              backgroundColor: accent,
              borderRadius: 1,
            }}
          />
          <div
            style={{
              fontFamily: theme?.fonts?.mono ?? "monospace",
              fontSize: labelSize,
              letterSpacing: "0.14em",
              color: muted,
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            快速预览 · 占位卡片
          </div>
        </div>

        {/* Block title */}
        <div
          style={{
            fontFamily: theme?.fonts?.sans ?? "sans-serif",
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.35,
            color: fg,
            marginBottom: Math.round(height * 0.03),
          }}
        >
          {TITLE}
        </div>

        {/* Visual description as plain text */}
        <div
          style={{
            fontFamily: theme?.fonts?.sans ?? "sans-serif",
            fontSize: bodySize,
            fontWeight: 400,
            lineHeight: 1.6,
            color: muted,
            maxWidth: Math.round(width * 0.72),
            whiteSpace: "pre-wrap",
          }}
        >
          {BODY}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default Component;
`;
}

// ---------------------------------------------------------------------------
// Per-block classification
// ---------------------------------------------------------------------------

/**
 * 判断块是否已由 compile 阶段就绪（本地图片/视频 wrapper），可跳过。
 */
function isReadyByCompile(block: Block): boolean {
  const mode = block.visualMode ?? "animation";
  if (mode === "video") return true;
  if (mode === "image" && block.imageSource) return true;
  return false;
}

/**
 * 提取卡片正文：html 块 strip 标签，其余用 description 原文。
 */
function cardBody(block: Block): string {
  const mode = block.visualMode ?? "animation";
  const raw = block.visual.description ?? "";
  if (mode === "html") return stripHtml(raw);
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > HTML_TEXT_MAX ? text.slice(0, HTML_TEXT_MAX).trimEnd() + "…" : text;
}

// ---------------------------------------------------------------------------
// quickVisuals()
// ---------------------------------------------------------------------------

export async function quickVisuals(
  options: QuickVisualsOptions,
): Promise<QuickVisualsResult> {
  const { verbose = false, dryRun = false, onProgress, signal } = options;
  const resolvedScriptPath = resolve(options.scriptPath);

  if (!fs.existsSync(resolvedScriptPath)) {
    throw new QuickVisualsError(
      `script.json not found: ${resolvedScriptPath}. Run compile first.`,
      "ERR_SCRIPT_NOT_FOUND",
    );
  }

  if (signal?.aborted) {
    throw new QuickVisualsError("Quick visuals cancelled", "ERR_CANCELLED");
  }

  const script: Script = JSON.parse(fs.readFileSync(resolvedScriptPath, "utf-8"));
  if (!script.meta || !Array.isArray(script.blocks)) {
    throw new QuickVisualsError(
      `Invalid script.json: ${resolvedScriptPath} (missing meta or blocks)`,
      "ERR_INVALID_SCRIPT",
    );
  }

  const outDir = dirname(resolvedScriptPath);
  const total = script.blocks.length;
  let placeholders = 0;
  let skipped = 0;

  for (let i = 0; i < total; i++) {
    const block = script.blocks[i];

    if (signal?.aborted) {
      throw new QuickVisualsError("Quick visuals cancelled", "ERR_CANCELLED");
    }

    // compile 已就绪的块（本地图片 / 本地视频）原样跳过
    if (isReadyByCompile(block)) {
      skipped++;
      if (verbose && !block.visual.componentPath) {
        console.warn(
          `[quick-visuals] ${block.id}: ${block.visualMode} block has no componentPath (compile wrapper missing?)`,
        );
      }
      onProgress?.({
        percent: Math.round(((i + 1) / total) * 100),
        step: `跳过 ${block.id}（本地素材已就绪）`,
        stage: "quick-visuals",
        blockId: block.id,
      });
      continue;
    }

    const body = cardBody(block);
    const componentRel = `src/blocks/${block.id}/Component.tsx`;

    if (dryRun) {
      console.log(
        `[quick-visuals] Would write placeholder card for ${block.id} → ${componentRel}`,
      );
    } else {
      const blockDir = join(outDir, "src", "blocks", block.id);
      fs.mkdirSync(blockDir, { recursive: true });
      fs.writeFileSync(join(blockDir, "Component.tsx"), cardTsx(block.title, body), "utf-8");
    }

    block.visual.componentPath = componentRel;
    // image（无源）/ html 块统一改写为 animation：render 的截图分支只认 html 模式，
    // image 模式断言要求 imagePath，改写后两者都走 React 组件分支。
    block.visualMode = "animation";
    placeholders++;

    onProgress?.({
      percent: Math.round(((i + 1) / total) * 100),
      step: `生成占位卡片 ${block.id}`,
      stage: "quick-visuals",
      blockId: block.id,
    });
  }

  if (!dryRun) {
    fs.writeFileSync(resolvedScriptPath, JSON.stringify(script, null, 2));
  }

  console.log(
    `[quick-visuals] ${dryRun ? "Dry run: would generate" : "Done"}: ` +
      `${placeholders} placeholder card(s), ${skipped} skipped`,
  );

  return { script, placeholders, skipped };
}
