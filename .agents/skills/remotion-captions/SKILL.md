---
name: remotion-captions
description: "处理 AutoVideo 字幕/卡拉OK 高亮时必用：@remotion/captions 的 Caption 数据结构、字级/词级时间戳（TTS lineTimings、FunASR 字级毫秒）、逐字高亮分页、CJK 无空格处理、底部安全区与可读性规范。源自 Remotion 官方 remotion-captions skill，按本仓库 SubtitleOverlay 约定裁剪。"
---

# remotion-captions — AutoVideo 字幕最佳实践

来源：Remotion 官方 `remotion-captions` skill（v4.0.534）+ 本仓库 `remotion/components/SubtitleOverlay.tsx` 现状。涉及字幕显示、逐字/逐词高亮、时间戳对齐时遵循本文件。

## 数据结构：Caption

所有字幕数据一律用 `@remotion/captions` 的 `Caption` 类型（毫秒，JSON 可序列化）：

```ts
import type { Caption } from "@remotion/captions";

type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null; // 单词中点，可选
  confidence: number | null;  // ASR 置信度，可选
  pageBreakAfter?: boolean;   // true = 该词后换一页字幕
};
```

## 时间戳来源（按精度分档）

1. **TTS 行级**（现状）：`block.audio.lineTimings` / 组件 props 的 `lineTimings: LineTimingSec[]`——行级 startSec/endSec，够做整行字幕切换和行级高亮。
2. **ASR 字级**（卡拉OK 升级方向）：FunASR `paraformer-zh` 原生输出字级 `[[startMs, endMs], ...]`，对合成音频回扫一遍即可得到逐字窗口，映射成逐字 `Caption`。Whisper 的 word timestamps 是 DTW 后验，中文精度差，别用。
3. 自由生成组件**不要自己渲染字幕**：全局字幕由引擎的 `SubtitleOverlay` 统一绘制；组件只需避让底部字幕带（`subtitleSafeBottom`）。块内的「关键词高亮/批注」是内容层，不算字幕，可以做。

## 逐字卡拉OK 模式

```tsx
const tMs = (frame / fps) * 1000;
// 当前字 = 最后一个 startMs <= tMs 的 caption（activeIndexAt 同款思路，跨静音缝隙保持高亮）
{captions.map((c, i) => (
  <span key={i} style={{ color: tMs >= c.startMs ? accent : baseColor }}>{c.text}</span>
))}
```

- 高亮颜色走 `theme.colors.accent`；已读/未读对比度差要足（已读 100% 亮度，未读 55–70%）。
- 高亮粒度：中文按**字**，英文按**词**（词前保留空格——Caption 的 `text` 对空白敏感）。
- 换页：`pageBreakAfter: true` 结束当前页；分页也可用 `@remotion/captions` 的 `createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds })` 自动把密集 token 合并成可读页。

## CJK 特别注意

- 中文词与词之间**没有空格**，逐字高亮天然适配；但若按词组分页，需先分词（pinyin-pro 链路已有拼音，不可当分词用）。
- 单页字幕 ≤ 2 行；按 `SubtitleOverlay` 现有做法用字符宽估算（CJK=1em、Latin≈0.55em）做字号收缩，不要去 DOM measure（逐帧独立渲染，layout effect 靠不住）。
- 标点级停顿（TTS 阶段的标点分级静音）是天然的 `pageBreakAfter` 候选点：句号/问号必断页，逗号看页长。

## 可读性红线

- 字幕永远待在底部安全区内；安全区高度 = `subtitleSafeBottom`，样式 token 在 `theme.subtitle`（fontSizePct/lineHeight/maxWidthPct/backgroundColor/paddingPx）。
- 必须背板：半透明深色胶囊（现有约定），纯白字直接压画面会死在浅背景上。
- 字号下限：1080p 下不低于 `typeSize(height, "caption")`（≈22px）；字间距正常，别用负 letterSpacing。
- 单行宽度 ≤ 画面宽 × `theme.subtitle.maxWidthPct`；超长先缩字号再换页。

## 接入检查

1. Caption 数组能 `JSON.stringify` 往返（要进 script.json / props）。
2. 时间单位统一毫秒；与帧换算只许 `frames(sec, fps)` / `frame / fps * 1000`。
3. 改了全局字幕行为时同步检查 `remotion/components/SubtitleOverlay.tsx` 与 `remotion/engine/types.ts` 的 `theme.subtitle` 约定，别在一个 block 里私改全局样式。
