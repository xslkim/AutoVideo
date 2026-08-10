import { describe, it, expect } from "vitest";
import {
  enumeratesNarration,
  declaresSyncIntent,
  lintNarrationSync,
} from "../../src/compile/sync-lint.js";
import type { Block } from "../../src/types/script.js";

function makeBlock(overrides: {
  id?: string;
  description?: string;
  lines?: string[];
  visualMode?: Block["visualMode"];
}): Block {
  return {
    id: overrides.id ?? "B01",
    title: "t",
    enter: "fade",
    exit: "fade",
    visualMode: overrides.visualMode ?? "animation",
    visual: { description: overrides.description ?? "" },
    narration: {
      lines: (overrides.lines ?? []).map((text) => ({
        text,
        ttsText: text,
        highlights: [],
      })),
    },
  } as Block;
}

describe("enumeratesNarration", () => {
  it("detects 第一/第二/第三 walkthroughs", () => {
    expect(
      enumeratesNarration([
        { text: "这一集 我们会走完五个站点" },
        { text: "第一 大模型的结构" },
        { text: "第二 推理的原理" },
      ]),
    ).toBe(true);
  });

  it("detects numbered and circled enumerations", () => {
    expect(enumeratesNarration([{ text: "1. 安装依赖" }, { text: "2. 启动服务" }])).toBe(true);
    expect(enumeratesNarration([{ text: "① 结构" }, { text: "② 推理" }])).toBe(true);
  });

  it("ignores plain narration", () => {
    expect(
      enumeratesNarration([{ text: "大模型本质上是一个概率程序" }, { text: "给定一段文字" }]),
    ).toBe(false);
  });

  it("requires at least two enumerated lines", () => {
    expect(enumeratesNarration([{ text: "第一 唯一的条目" }, { text: "普通句子" }])).toBe(false);
  });
});

describe("declaresSyncIntent", () => {
  it("matches narration-following phrases", () => {
    expect(declaresSyncIntent("节点高亮跟随旁白推进")).toBe(true);
    expect(declaresSyncIntent("必须用 props.lineTimings 驱动")).toBe(true);
    expect(declaresSyncIntent("旁白讲到哪一站就高亮哪个节点")).toBe(true);
  });

  it("does not match plain descriptions", () => {
    expect(declaresSyncIntent("全屏背景 #0d1117，顶部居中标题")).toBe(false);
  });
});

describe("lintNarrationSync", () => {
  it("warns on absolute beats beyond the entrance window", () => {
    const warnings = lintNarrationSync([
      makeBlock({ description: "[0.5s] 线扫出。[4.5s] 节点①高亮。" }),
    ]);
    expect(warnings.some((w) => w.rule === "absolute-beat")).toBe(true);
  });

  it("allows absolute beats inside the entrance window", () => {
    const warnings = lintNarrationSync([
      makeBlock({ description: "[0s] 标题淡入。[1.5s] 副标题滑入。[2.8s] 横线扫出。" }),
    ]);
    expect(warnings.filter((w) => w.rule === "absolute-beat")).toHaveLength(0);
  });

  it("warns when enumerated narration lacks a visual mapping", () => {
    const warnings = lintNarrationSync([
      makeBlock({
        description: "五个节点从左到右依次弹出。",
        lines: ["开场白", "第一 结构", "第二 推理"],
      }),
    ]);
    expect(warnings.some((w) => w.rule === "missing-mapping")).toBe(true);
  });

  it("stays quiet when the mapping is declared", () => {
    const warnings = lintNarrationSync([
      makeBlock({
        description: "五个节点依次弹出，高亮跟随旁白推进（用 props.lineTimings）。",
        lines: ["开场白", "第一 结构", "第二 推理"],
      }),
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("skips non-animation modes", () => {
    const warnings = lintNarrationSync([
      makeBlock({
        visualMode: "image",
        description: "[8s] 无所谓",
        lines: ["第一 a", "第二 b"],
      }),
    ]);
    expect(warnings).toHaveLength(0);
  });
});
