# packaging — 频道化包装（集成笔记）

> 来源任务：packaging。产出文件：
> - `remotion/library/components/ProgressBar.tsx`（新）
> - `remotion/library/components/Watermark.tsx`（新）
> - `remotion/library/components/EndCard.tsx`（新）
> - `src/render/concat.ts`（改：ffmetadata 章节写入 + 开关）
> - `tests/render/concat-chapters.test.ts`（新，11 个用例全绿）
>
> 验证：`npx tsc -p tsconfig.remotion.json` ✅ · `npm run build` ✅ ·
> `HOME=/tmp/fakehome npx vitest run tests/render/ tests/library/` ✅（51 通过）

---

## 1. `remotion/library/index.ts` 需要追加的导出行

值导出保持无扩展名、类型导出带 `.js`（仓库既有双轨约定）：

```ts
export { ProgressBar } from "./components/ProgressBar";
export { Watermark } from "./components/Watermark";
export { EndCard } from "./components/EndCard";

export type { ProgressBarSpec, ProgressBarProps, ProgressBarChapter } from "./components/ProgressBar.js";
export type { WatermarkSpec, WatermarkProps, WatermarkPosition } from "./components/Watermark.js";
export type { EndCardSpec, EndCardProps } from "./components/EndCard.js";
```

## 2. `src/ai/visual-registry.ts` 注册草案

zod schema（沿用文件里现有 `accentField` 辅助）：

```ts
/** remotion/library/components/ProgressBar.tsx — ProgressBarSpec */
const progressBarSchema = z.object({
  progress: z.union([
    z.number().min(0).max(1),
    z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1) }),
  ]),
  chapters: z
    .array(z.object({ title: z.string().min(1), at: z.number().min(0).max(1) }))
    .max(12)
    .optional(),
  showLabel: z.boolean().optional(),
  accent: accentField,
});

/** remotion/library/components/Watermark.tsx — WatermarkSpec */
const watermarkSchema = z.object({
  text: z.string().min(1),
  badge: z.string().min(1).max(2).optional(),
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  accent: accentField,
});

/** remotion/library/components/EndCard.tsx — EndCardSpec */
const endCardSchema = z.object({
  brand: z.string().min(1),
  monogram: z.string().min(1).max(2).optional(),
  kicker: z.string().optional(),
  followPrompt: z.string().optional(),
  nextTeaser: z.string().optional(),
  accent: accentField,
});
```

registry 条目（追加进 `VISUAL_REGISTRY` 数组）：

```ts
{
  name: "ProgressBar",
  componentFile: "remotion/library/components/ProgressBar.tsx",
  description:
    "Channel-packaging top rail: hairline progress fill, diamond chapter ticks that light up as the playhead passes, and a mono label naming the current chapter. Position comes from pure-data global progress, so it stays continuous across block cuts.",
  whenToUse:
    "Overlay for any block when the video wants a persistent top progress indicator. progress/at are whole-video 0..1 fractions — the caller must compute them from block timings; never let the LLM invent them. Not a standalone content visual.",
  propsSchema: progressBarSchema,
  fields: [
    { name: "progress", type: "number | { from: number; to: number }", required: true, description: "Whole-video progress 0..1. Bare number = static; { from, to } sweeps linearly across the block's frames." },
    { name: "chapters", type: "{ title: string; at: number }[]", required: false, description: "Chapter ticks; at is the chapter start as a whole-video fraction 0..1. ≤ 12." },
    { name: "showLabel", type: "boolean", required: false, description: "Show the active chapter name under the rail. Default true." },
    { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
  ],
  exampleProps: {
    progress: { from: 0.32, to: 0.48 },
    chapters: [
      { title: "开场", at: 0 },
      { title: "注意力机制", at: 0.3 },
      { title: "总结", at: 0.85 },
    ],
    showLabel: true,
  },
},
{
  name: "Watermark",
  componentFile: "remotion/library/components/Watermark.tsx",
  description:
    "Persistent channel watermark: badge chip + text lockup pinned to a corner (bottom-right default), semi-transparent with a slow breathing opacity. Bottom corners clear the subtitle safe band.",
  whenToUse:
    "Overlay for branding when the video should carry a channel mark throughout. Best injected system-wide rather than per content block.",
  propsSchema: watermarkSchema,
  fields: [
    { name: "text", type: "string", required: true, description: "Watermark text, e.g. the channel name \"@AutoVideo\"." },
    { name: "badge", type: "string", required: false, description: "1–2 characters in a solid accent chip before the text (logo 位)." },
    { name: "position", type: "\"top-left\" | \"top-right\" | \"bottom-left\" | \"bottom-right\"", required: false, description: "Corner to pin to. Default \"bottom-right\"." },
    { name: "opacity", type: "number", required: false, description: "Peak opacity 0..1; breathing oscillates gently below it. Default 0.45." },
    { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
  ],
  exampleProps: { text: "@AutoVideo 频道", badge: "AV", position: "bottom-right", opacity: 0.45 },
},
{
  name: "EndCard",
  componentFile: "remotion/library/components/EndCard.tsx",
  description:
    "2-second brand end card: accent logo tile with monogram, brand lockup, growing hairline, follow CTA pill with a radar-ping ring, optional next-episode teaser. Elements stagger in with springs and hold.",
  whenToUse:
    "The closing block of a video — brand sign-off, follow call-to-action and next-episode teaser. Not for openers (use TitleCard) or content blocks.",
  propsSchema: endCardSchema,
  fields: [
    { name: "brand", type: "string", required: true, description: "Brand / channel lockup, e.g. \"AutoVideo 频道\"." },
    { name: "monogram", type: "string", required: false, description: "1–2 chars inside the logo tile; defaults to brand's first character." },
    { name: "kicker", type: "string", required: false, description: "Small mono kicker above the tile, e.g. \"感谢观看\"." },
    { name: "followPrompt", type: "string", required: false, description: "CTA inside the accent pill, e.g. \"关注频道，不错过更新\"." },
    { name: "nextTeaser", type: "string", required: false, description: "Next-episode teaser line, e.g. \"下集预告：动手写出你的第一个渲染器\"." },
    { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
  ],
  exampleProps: {
    brand: "AutoVideo 频道",
    kicker: "感谢观看",
    followPrompt: "关注频道，不错过更新",
    nextTeaser: "下集预告：动手写出你的第一个渲染器",
  },
},
```

## 3. concat.ts 章节元数据 — `src/cli/render.ts` 接线草案

concat.ts 新增导出：`ChapterSpec`、`chaptersFromBlocks(blocks, { offsetSec? })`、`buildFfmetadata(chapters)`；
`ConcatOptions` 新增可选 `chapters` / `writeChapters`；`ConcatResult` 新增 `chapterCount: number`。
两个 `concatPartials` 调用点（正常流程 ~L728、concatOnly 流程 ~L341）都改成：

```ts
import { concatPartials, chaptersFromBlocks } from "../render/concat.js";

const concatList = await withTitleCardSegment(partialRelPaths, meta, buildDir, config);
// 片头 1 帧标题卡会让正片整体后移 1 帧，章节起点同步偏移
const leadSec = concatList.length > partialRelPaths.length ? 1 / meta.fps : 0;
concatPartials(concatList, {
  buildDir,
  chapters: chaptersFromBlocks(blocks, { offsetSec: leadSec }),
  writeChapters: config.render?.chapters !== false,
});
```

说明：
- `chaptersFromBlocks` 依赖 block.timing（render 阶段已填）；concatOnly 模式读的是上一轮的 script.json，同样有 timing。遇到无 timing 的块会截断后续章节（起点不可知），不会报错。
- 章节在 concat 同一趟 ffmpeg 写入（`-f ffmetadata -i chapters.ffmeta -map_metadata 1 -map_chapters 1`，stream copy，无重编码）。产物 `output/chapters.ffmeta` 留在 build 目录可检查。
- 下游已核实兼容：loudnorm 与 avatar overlay 都以 final.mp4 为 input 0，ffmpeg 默认从首个含章节的输入复制章节，最终 `final_normalized.mp4` 保留分段。
- 开关（默认开）：`ConcatOptions.writeChapters === false` 或环境变量 `AUTOVIDEO_CHAPTERS=0|false|off|no` 均可关闭（env 优先）。

## 4. `src/config/defaults.ts` 可选配置字段草案（集成 Agent 决定要不要落）

```ts
// AutoVideoConfig["render"] 内：
/** Embed chapter markers into final.mp4 (YouTube/B站 自动分段). Default true. */
chapters?: boolean;
```

web 端设置面板可加一个「章节分段」开关（默认开），不配置不影响现有行为。

## 5. README 组件表格行草案（共享 README，由集成 Agent 统一加）

| `ProgressBar` | 顶部进度条：细条填充 + 章节菱形刻度 + 当前章节名淡入，纯数据全局进度跨块连续 |
| `Watermark` | 右下角常驻半透明水印（badge + 文字），呼吸微透明，避让字幕安全区 |
| `EndCard` | 2s 品牌片尾：logo 块 + 品牌名 + 关注 CTA（雷达脉冲环）+ 下集预告，stagger 入场 |

## 6. 组装侧使用建议（ProgressBar / Watermark 的全局性）

- 这两个是**跨块 HUD**，不是内容组件。建议在组装 wrapper（或每个 block 的组件树根部）统一注入，而不是让 LLM 逐块选择。
- `ProgressBar.spec.progress` 用 `{ from, to }` 形式：由集成侧用块的全局时间窗口计算
  `from = blockStartSec / totalSec`、`to = (blockStartSec + blockTotalSec) / totalSec`，组件内部按局部 frame 线性插值，块间完全连续。
- `chapters` 与 concat.ts 的章节同源：`at = chapterStartSec / totalSec`。
- `Watermark` 的呼吸是块局部 frame 驱动的正弦（周期 4.2s），块切换处相位不连续但振幅仅 ±15% 峰值，视觉上不可察觉；如在意可后续给 spec 加 `phase` 字段。
