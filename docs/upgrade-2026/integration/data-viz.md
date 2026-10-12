# data-viz 集成事项

新增两个预制组件（已在 `remotion/library/components/` 就位，**未**注册）：

- `NumberTicker.tsx` — 大数字冲击：odometer 滚筒逐位滚动（低位多圈）+ pop spring 落定回弹 + 可选 sparkline 描画生长 + 落定辉光。Spec：`{ value, label, unit?, decimals?, sparkline?, accent? }`。
- `ChartGrow.tsx` — 生长图表：line/bar/area 三型；折线/面积用 `@remotion/paths` 的 `evolvePath` 描画生长（数据点随笔画到达逐个 pop）、柱子从基线 spring 拔起（带 overshoot）、nice-step 网格线/坐标轴 stagger 描画、每条 series 的关键点（max/min/last）自动高亮（脉冲环 + 数值 callout）、旁白节拍扫过类目（line/area 竖向 guide，bar 点亮当前组）、多 series 图例。Spec：`{ type, series, xLabels, title?, highlight?, accent? }`。

下面 3 处共享文件改动需集成 Agent 执行（组件本身零依赖它们即可被 wrapper 引用，但 registry/barrel 不同步会挂测试）。

## 1. `remotion/library/index.ts`（barrel 导出）

在现有组件导出块后追加（value 无扩展名、type 带 `.js`，与现有行保持同序同风格）：

```ts
export { NumberTicker } from "./components/NumberTicker";
export { ChartGrow } from "./components/ChartGrow";
```

```ts
export type { NumberTickerSpec, NumberTickerProps } from "./components/NumberTicker.js";
export type { ChartGrowSpec, ChartGrowSeries, ChartGrowProps } from "./components/ChartGrow.js";
```

## 2. `src/ai/visual-registry.ts`（zod schema + registry 条目）

Schema 区追加（紧随 `dataBarsSchema` 之后）：

```ts
/** remotion/library/components/NumberTicker.tsx — NumberTickerSpec */
const numberTickerSchema = z.object({
  value: z.number(),
  label: z.string().min(1),
  unit: z.string().optional(),
  decimals: z.number().int().min(0).max(3).optional(),
  sparkline: z.array(z.number()).min(2).max(24).optional(),
  accent: accentField,
});

/** remotion/library/components/ChartGrow.tsx — ChartGrowSpec */
const chartGrowSchema = z.object({
  type: z.enum(["line", "bar", "area"]),
  series: z
    .array(
      z.object({
        name: z.string().optional(),
        data: z.array(z.number()).min(2).max(12),
        color: z.string().optional(),
      })
    )
    .min(1)
    .max(3),
  xLabels: z.array(z.string().min(1)).min(2).max(12),
  title: z.string().optional(),
  highlight: z.enum(["max", "min", "last"]).optional(),
  accent: accentField,
});
```

`VISUAL_REGISTRY` 数组追加两条（与 barrel 同名，`tests/ai/visual-registry.test.ts` 会断言两边集合相等，**必须与第 1 项同批落地**）：

```ts
  {
    name: "NumberTicker",
    componentFile: "remotion/library/components/NumberTicker.tsx",
    description:
      "Big-number impact beat: odometer drums roll up to the target value and bounce onto it digit by digit, with an optional sparkline drawing itself under the caption.",
    whenToUse:
      "The narration lands on one headline statistic (用户量、性能提升、价格、百分比) and the block should hit that single number hard. Not for multi-value comparisons (use DataBars) or trends over categories (use ChartGrow).",
    propsSchema: numberTickerSchema,
    fields: [
      { name: "value", type: "number", required: true, description: "Target value the counter lands on, e.g. 128000 or 99.2. Keep the integer part ≤ 6 digits so the row fits the frame." },
      { name: "label", type: "string", required: true, description: "Caption under the number, e.g. \"本月活跃用户\"." },
      { name: "unit", type: "string", required: false, description: "Small suffix right of the digits, e.g. \"%\" or \"ms\"." },
      { name: "decimals", type: "number (int, 0–3)", required: false, description: "Decimal places; defaults to 0 for integers, 1 otherwise." },
      { name: "sparkline", type: "number[]", required: false, description: "Optional trend under the caption (2–24 points, oldest → newest)." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      value: 128000,
      label: "本月活跃用户",
      unit: "人",
      sparkline: [12, 18, 15, 26, 34, 31, 48],
    },
  },
  {
    name: "ChartGrow",
    componentFile: "remotion/library/components/ChartGrow.tsx",
    description:
      "Growing chart for trend narratives: axes and gridlines wipe in, then the series grows — line/area strokes draw themselves on, bars spring up from the baseline — and each series' key point (max/min/last) gets a pulsing ring and value callout.",
    whenToUse:
      "The description shows a trend or comparison across ordered categories (月度、版本、实验组) with 2–12 points per series and up to 3 series. For 2–6 plain value comparisons without an x axis, DataBars is simpler.",
    propsSchema: chartGrowSchema,
    fields: [
      { name: "type", type: "\"line\" | \"bar\" | \"area\"", required: true, description: "line/area strokes draw themselves on; bars rise from the baseline." },
      { name: "series", type: "{ name?: string; data: number[]; color?: string }[]", required: true, description: "1–3 series; data length should match xLabels (shorter arrays repeat their last value). name feeds the legend when more than one series is plotted." },
      { name: "xLabels", type: "string[]", required: true, description: "2–12 short category labels (≤ 4 chars each, e.g. \"1月\"), matched by index to each series' data." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"逐月吞吐量\"." },
      { name: "highlight", type: "\"max\" | \"min\" | \"last\"", required: false, description: "Which key point of each series gets the callout. Default \"max\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      type: "line",
      title: "逐月吞吐量",
      series: [
        { name: "基线", data: [12, 20, 16, 30, 42] },
        { name: "优化后", data: [18, 28, 40, 55, 80] },
      ],
      xLabels: ["1月", "2月", "3月", "4月", "5月"],
      highlight: "max",
    },
  },
```

## 3. 其他共享文件

- `schemas/script.schema.json`、`src/config/`、`autovideo.config*.json`：**无需改动**（spec 走组件级 JSON，无新配置项）。
- `README.md` / `docs/AGENTS.md`：现有文档没有逐组件表格（README 不含 DataBars 等组件清单），**无需加行**；若集成 Agent 统一补组件清单，把上面两条 description 抄进去即可。

## 验证参考

- `npx tsc -p tsconfig.remotion.json` 通过（本次提交时 exit 0）。
- 运行时 smoke（react-dom/server 多帧渲染 + odometer 落定精度）：`npx tsx temp/verify-dataviz.mts`、`npx tsx temp/verify-dataviz-drums.mts`（均为 temp/ 下的一次性脚手架，可随集成删除）。
