/**
 * AutoVideo — quick-visuals stage tests
 *
 * 覆盖：
 *   - animation 块生成文字简介卡片
 *   - 无 imageSource 的 image 块改写为 animation + 卡片
 *   - html 块 strip 标签/实体后生成卡片
 *   - 本地图片 / 视频块跳过（compile 已生成 wrapper）
 *   - 写回 script.json 后满足 assertRenderInputReady
 *   - dry-run 不写文件
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { quickVisuals, stripHtml } from "../../src/cli/quick-visuals.js";
import { assertRenderInputReady } from "../../src/types/script.js";
import type { Block, Script } from "../../src/types/script.js";

// ── Helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;
let scriptPath: string;

function makeBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    title: `Block ${overrides.id}`,
    enter: "fade",
    exit: "fade",
    visualMode: "animation",
    visual: { description: "A test visual" },
    narration: {
      lines: [{ text: "Hello", ttsText: "Hello", highlights: [] }],
    },
    // 假 audio 字段（quick-visuals 不碰音频；仅为通过 render 输入断言）
    audio: {
      wavPath: `public/audio/${overrides.id}.wav`,
      durationSec: 2.0,
      lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 2000 }],
    },
    ...overrides,
  } as Block;
}

function makeScript(blocks: Block[]): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Quick Test",
      voiceRef: "/tmp/B00.wav",
      aspect: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      theme: "dark-code",
      subtitleSafeBottom: 162,
    },
    blocks,
    artifacts: {},
    assets: {},
  } as Script;
}

function writeScript(script: Script) {
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), "utf-8");
}

function readScript(): Script {
  return JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
}

function componentFile(id: string): string {
  return path.join(tmpDir, "src", "blocks", id, "Component.tsx");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quick-visuals-test-"));
  scriptPath = path.join(tmpDir, "script.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── stripHtml unit tests ────────────────────────────────────────────────

describe("stripHtml", () => {
  it("removes tags and decodes common entities", () => {
    expect(stripHtml('<div><p>Hello &amp; "World"</p></div>')).toBe('Hello & "World"');
    expect(stripHtml("<p>&lt;tag&gt; &quot;q&quot; &#39;s&#39;&nbsp;x</p>")).toBe(
      "<tag> \"q\" 's' x",
    );
  });

  it("drops script/style blocks and collapses whitespace", () => {
    const html = `<style>.a{color:red}</style><div>  多\n\n  空白  </div><script>alert(1)</script>`;
    expect(stripHtml(html)).toBe("多 空白");
  });

  it("truncates beyond ~500 chars with ellipsis", () => {
    const long = `<p>${"字".repeat(600)}</p>`;
    const out = stripHtml(long);
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith("…")).toBe(true);
  });
});

// ── quickVisuals ────────────────────────────────────────────────────────

describe("quickVisuals", () => {
  it("generates a placeholder card for animation blocks", async () => {
    writeScript(makeScript([
      makeBlock({ id: "B01", visualMode: "animation", visual: { description: "介绍编译流程" } }),
    ]));

    const result = await quickVisuals({ scriptPath });

    expect(result.placeholders).toBe(1);
    expect(result.skipped).toBe(0);

    const script = readScript();
    expect(script.blocks[0].visualMode).toBe("animation");
    expect(script.blocks[0].visual.componentPath).toBe("src/blocks/B01/Component.tsx");

    const tsx = fs.readFileSync(componentFile("B01"), "utf-8");
    expect(tsx).toContain(JSON.stringify("Block B01"));
    expect(tsx).toContain(JSON.stringify("介绍编译流程"));
    expect(tsx).toContain("AbsoluteFill");
  });

  it("rewrites source-less image blocks to animation + card", async () => {
    writeScript(makeScript([
      makeBlock({ id: "B02", visualMode: "image", visual: { description: "一张示意图" } }),
    ]));

    const result = await quickVisuals({ scriptPath });

    expect(result.placeholders).toBe(1);
    const script = readScript();
    expect(script.blocks[0].visualMode).toBe("animation");
    expect(script.blocks[0].visual.componentPath).toBe("src/blocks/B02/Component.tsx");
    expect(fs.existsSync(componentFile("B02"))).toBe(true);
  });

  it("strips html source into plain text for html blocks", async () => {
    writeScript(makeScript([
      makeBlock({
        id: "B03",
        visualMode: "html",
        visual: {
          description: '<div class="page"><h1>标题</h1><p>Hello &amp; World</p></div>',
          htmlPath: "public/html/B03.html",
        },
      }),
    ]));

    const result = await quickVisuals({ scriptPath });

    expect(result.placeholders).toBe(1);
    const script = readScript();
    // html → animation（render 的 Puppeteer 截图分支只认 html 模式）
    expect(script.blocks[0].visualMode).toBe("animation");
    expect(script.blocks[0].visual.componentPath).toBe("src/blocks/B03/Component.tsx");

    const tsx = fs.readFileSync(componentFile("B03"), "utf-8");
    expect(tsx).toContain(JSON.stringify("标题 Hello & World"));
    // 原始 HTML 源码不得进入卡片（组件自身的 JSX <div> 是合法的）
    expect(tsx).not.toContain('<div class="page"');
    expect(tsx).not.toContain("<h1>");
  });

  it("skips local image and video blocks set up by compile", async () => {
    const imageBlock = makeBlock({
      id: "B04",
      visualMode: "image",
      imageSource: "images/pic.png",
      visual: {
        description: "本地图片",
        imagePath: "public/images/B04.png",
        componentPath: "src/blocks/B04/Component.tsx",
      },
    });
    const videoBlock = makeBlock({
      id: "B05",
      visualMode: "video",
      videoSource: "videos/clip.mp4",
      visual: {
        description: "本地视频",
        videoPath: "public/videos/B05.mp4",
        componentPath: "src/blocks/B05/Component.tsx",
      },
    });
    writeScript(makeScript([imageBlock, videoBlock]));

    const result = await quickVisuals({ scriptPath });

    expect(result.placeholders).toBe(0);
    expect(result.skipped).toBe(2);

    const script = readScript();
    // 原样保留，不改写 visualMode / componentPath
    expect(script.blocks[0].visualMode).toBe("image");
    expect(script.blocks[0].visual.imagePath).toBe("public/images/B04.png");
    expect(script.blocks[1].visualMode).toBe("video");
    expect(script.blocks[1].visual.videoPath).toBe("public/videos/B05.mp4");
    // 未生成新文件
    expect(fs.existsSync(componentFile("B04"))).toBe(false);
    expect(fs.existsSync(componentFile("B05"))).toBe(false);
  });

  it("written script.json passes assertRenderInputReady", async () => {
    writeScript(makeScript([
      makeBlock({ id: "B01", visualMode: "animation" }),
      makeBlock({ id: "B02", visualMode: "image", visual: { description: "无源图片" } }),
      makeBlock({ id: "B03", visualMode: "html", visual: { description: "<p>html</p>" } }),
    ]));

    await quickVisuals({ scriptPath });

    expect(() => assertRenderInputReady(readScript())).not.toThrow();
  });

  it("dry-run writes nothing and leaves script.json unchanged", async () => {
    const script = makeScript([
      makeBlock({ id: "B01", visualMode: "animation" }),
    ]);
    writeScript(script);
    const before = fs.readFileSync(scriptPath, "utf-8");

    const result = await quickVisuals({ scriptPath, dryRun: true });

    expect(result.placeholders).toBe(1);
    expect(fs.readFileSync(scriptPath, "utf-8")).toBe(before);
    expect(fs.existsSync(componentFile("B01"))).toBe(false);
  });

  it("throws when script.json does not exist", async () => {
    await expect(
      quickVisuals({ scriptPath: path.join(tmpDir, "nope.json") }),
    ).rejects.toThrow("script.json not found");
  });
});
