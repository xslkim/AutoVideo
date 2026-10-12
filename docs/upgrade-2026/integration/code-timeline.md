# 集成笔记：code-timeline（CodeWindow + TimelineRuler）

本任务新增两个预制组件，均已完成并通过 `npx tsc -p tsconfig.remotion.json`：

- `remotion/library/components/CodeWindow.tsx` — macOS 三灯代码窗口：文件名居中标题栏、打字机逐字出现（帧驱动闪烁方块光标）、旁白节拍驱动的**弹簧滑动**扫行高亮（lineTimings 对齐，不再跳变）、可选 diff 模式（新增绿底/删除红底 + gutter +/− 标记 + 标题栏 `+n −m` 统计）、`highlightLines` 常驻强调。
- `remotion/library/components/TimelineRuler.tsx` — 横向时间轴：主轴从左生长 + 刻度细节、节点 pop 弹出、accent 进度线随节拍向当前节点生长（弹簧平滑推进、端点发光头）、当前节点放大 + 呼吸光环 + 卡片提亮；事件卡片沿轴上下交替排布；`activeIndex` 可手动钉住当前节点，缺省时随旁白节拍自动推进。

以下共享文件改动需集成 Agent 落地（本任务按规则未触碰）。

## 1. `remotion/library/index.ts`（barrel 导出）

在现有组件导出块末尾追加（注意仓库双规则：值导出无扩展名、类型导出带 `.js` 且必须 `export type`）：

```ts
export { CodeWindow } from "./components/CodeWindow";
export { TimelineRuler } from "./components/TimelineRuler";
```

```ts
export type { CodeWindowSpec, CodeWindowProps } from "./components/CodeWindow.js";
export type { TimelineRulerSpec, TimelineRulerProps } from "./components/TimelineRuler.js";
```

## 2. `src/ai/visual-registry.ts`（zod schema + registry 条目）

⚠️ `tests/ai/visual-registry.test.ts` 断言 barrel 导出名集合 == registry 名集合，**index.ts 与 registry 必须同批落地**，否则测试红。

### 2.1 schema 草案（追加在 `dataBarsSchema` 之后）

```ts
/** remotion/library/components/CodeWindow.tsx — CodeWindowSpec */
const codeWindowSchema = z.object({
  code: z.string().min(1),
  language: z.string().optional(),
  filename: z.string().optional(),
  highlightLines: z.array(z.number().int().min(1)).optional(),
  diff: z
    .object({
      added: z.array(z.number().int().min(1)).optional(),
      removed: z.array(z.number().int().min(1)).optional(),
    })
    .optional(),
  typewriter: z.boolean().optional(),
  accent: accentField,
});

/** remotion/library/components/TimelineRuler.tsx — TimelineRulerSpec */
const timelineRulerSchema = z.object({
  title: z.string().optional(),
  events: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().optional(),
        time: z.string().optional(),
      })
    )
    .min(2)
    .max(6),
  activeIndex: z.number().int().min(0).optional(),
  accent: accentField,
});
```

### 2.2 registry 条目（追加进 `VISUAL_REGISTRY` 数组）

```ts
  {
    name: "CodeWindow",
    componentFile: "remotion/library/components/CodeWindow.tsx",
    description:
      "macOS-style code window: traffic-light title bar with centred filename, optional typewriter reveal with blinking block cursor, a narration-beat highlight that glides between lines, persistent highlightLines emphasis, and optional diff mode (added green / removed red with +/− gutter markers).",
    whenToUse:
      "The description shows source code or a config listing and asks for an editor/IDE window look, a typing effect, diff/改动标注 (新增/删除行), or specific lines to stay emphasised. Prefer over CodeBlock when the visual brief mentions 窗口/打字机/diff/高亮第 N 行.",
    propsSchema: codeWindowSchema,
    fields: [
      { name: "code", type: "string", required: true, description: "Source code, \"\\n\" separated. Blank lines are preserved. Keep it short enough to stay legible (roughly ≤ 14 lines)." },
      { name: "language", type: "string", required: false, description: "Language badge, e.g. \"ts\". Purely decorative." },
      { name: "filename", type: "string", required: false, description: "File name centred in the window title bar, e.g. \"train.py\"." },
      { name: "highlightLines", type: "number[]", required: false, description: "1-based line numbers that keep a persistent accent emphasis plate." },
      { name: "diff", type: "{ added?: number[]; removed?: number[] }", required: false, description: "Diff mode: 1-based added lines go green, removed lines red, with +/− gutter markers and a header stat pill." },
      { name: "typewriter", type: "boolean", required: false, description: "Typewriter reveal: lines type out char by char under a blinking block cursor. Default false." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      filename: "train.py",
      language: "py",
      typewriter: true,
      highlightLines: [3],
      code: "import torch\n\nmodel = GPT(vocab=32000)\noptim = AdamW(model.parameters(), lr=3e-4)",
    },
  },
  {
    name: "TimelineRuler",
    componentFile: "remotion/library/components/TimelineRuler.tsx",
    description:
      "Horizontal timeline ruler: the axis draws itself with minor ticks, event nodes pop in, an accent progress line grows node to node with the narration beat, and the featured node enlarges with a glow. Event cards alternate above/below the axis.",
    whenToUse:
      "The narration walks a chronological development (发展史/演进/版本迭代) or an ordered sequence of milestones/steps with 2–6 events, especially when events carry dates or version labels.",
    propsSchema: timelineRulerSchema,
    fields: [
      { name: "events", type: "{ label: string; detail?: string; time?: string }[]", required: true, description: "2–6 events in chronological order. label = main text, time = small mono chip (e.g. \"2017\"), detail = muted secondary line." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"发展史\"." },
      { name: "activeIndex", type: "number (int, 0-based)", required: false, description: "Pin the featured node; omit to auto-advance with the narration beat." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "发展史",
      events: [
        { time: "2017", label: "Transformer 发布", detail: "自注意力取代循环结构" },
        { time: "2018", label: "BERT / GPT-1" },
        { time: "2020", label: "GPT-3", detail: "1750 亿参数" },
      ],
    },
  },
```

## 3. `docs/guidelines/AUTHORING.md`（组件速查表）

§3.1 表格（约 272–278 行）追加两行：

```
> | `CodeWindow` | macOS 代码窗口：打字机逐字 + 扫行高亮 + diff 红绿标注 | "代码窗口：文件 train.py，打字机逐行出现，第 3–5 行为新增改动" |
> | `TimelineRuler` | 横向时间轴：节点弹出 + 进度生长 + 当前节点放大（2–6 个事件） | "时间轴：2017 Transformer → 2018 BERT → 2020 GPT-3，各一句话说明" |
```

另外约 525 行的库组件枚举句「（`TitleCard` / `KeyPoints` / `CodeBlock` / `FlowDiagram` / `DataBars` 及 tokens/motion 原语）」需补上 `CodeWindow` / `TimelineRuler`。

## 4. 无需改动

- `schemas/script.schema.json`：spec 内联进生成的 wrapper，不进中间表示 schema。
- `src/config/`、`autovideo.config*.json`：无新配置项。
- README.md：无库组件表格（grep 确认），无需加行。

## 5. 设计/实现备注（供评审）

- 全部动画帧驱动：扫行/进度线的平滑推进用「当前节拍起点 + springIn(snappy)」实现（stateless spring，可从任一帧求值）；打字机光标闪烁用 `Math.floor(frame / blink) % 2` 方波，无墙钟。
- diff 颜色用 GitHub dark 语义色（`#3fb950` / `#f85149` 及 15% 透明度底色），macOS 三灯用标准 `#ff5f57/#febc2e/#28c840`，均为硬编码语义色，不走 theme。
- CodeWindow 复用 CodeBlock 同款正则 tokenizer（CodeBlock 未导出该函数，组件内保留一份拷贝，注释已注明）。
- 两组件 spec 均 JSON 可序列化；字号/间距全部走 tokens；底部避让 `subtitleSafeBottom`（availHeight）。
