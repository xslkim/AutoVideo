# 集成笔记 — karaoke-captions（字幕升级：逐字卡拉OK / 三档风格）

> 负责文件：`remotion/components/KaraokeCaptions.tsx`（新建）、`remotion/components/SubtitleOverlay.tsx`（改造）、`remotion/components/SubtitleOverlay.test.tsx`（更新）
> 日期：2026-10-11

## 已完成（本任务内）

- **新建 `remotion/components/KaraokeCaptions.tsx`** — 帧级字幕组件（与 SubtitleOverlay 同层，**不是** library 预制组件）：
  - 三档风格 `SubtitleStyle = "teach" | "karaoke" | "hype"`（默认 `teach`）：
    - `teach`：整行淡入（0.35s enter + 轻微上浮），`**`关键词保留品牌色，克制默认；
    - `karaoke`：逐字扫光——当前字 `theme.colors.accent` 填充 + 1.1× `SPRINGS.pop` 微弹（读过字 0.15s 内弹回 1），已读字全亮，未读字 0.42 半透明；
    - `hype`：短视频风——1.5× 大字、weight 800、粗描边（theme 无 stroke 时回落 `theme.colors.bg`）、逐字 pop 弹跳入场 + 按字索引奇偶 ±2.2° 交替倾斜（确定性，无随机）、无胶囊底。
  - 双模输入（`KaraokeCaptionsProps`）：`captions: KaraokeCaptionInput[]`（`{ text, startMs, endMs, pageBreakAfter? }`，**结构兼容 @remotion/captions 的 `Caption`**，逐字或逐词均可，多字条目内部再均分）或 `text + startMs + endMs` 行级窗口（行内按字均分）。
  - 分页 `paginateChars`：每页 8–14 个非空白字符，到 8 字后优先在标点/`pageBreakAfter` 处断页，14 字硬断；字号按最长页一次算定（`fitFontSize`），翻页不跳字号。
  - 底部安全区：与 SubtitleOverlay 完全同款几何（`subtitleSafeBottom - bottomMargin` 作为 band，`fitFontSize` 收缩保证不越界）。
  - 全部帧驱动：`springIn`/`enterProgress`/`interpolate`，无墙钟、无随机。
  - 共享字幕 helper 已**移居此文件并导出**（SubtitleOverlay 改为 import，实现逐字未变）：`estimateWidthEm`、`fitFontSize`、`renderHighlightedText`；新增纯函数 `distributeCharTimings`、`charsFromCaptions`、`paginateChars`、`charStateAt`、`activePageIndex`。
- **改造 `remotion/components/SubtitleOverlay.tsx`**：
  - 新增可选 props（本地接口 `SubtitleOverlayStyleProps`，未动 `engine/types.ts`）：`style?: SubtitleStyle`、`charTimings?: (KaraokeCaptionInput[] | undefined)[]`（按 `lineIndex` 对齐，每行一个数组）。
  - 传了 `style` 才委托 KaraokeCaptions；**不传 `style` 时走原整行胶囊路径，行为逐字节不变**（向后兼容）。入场期（`audioFrame < 0`）不渲染的约定对两种路径一致。
  - 再导出类型：`export type { KaraokeCaptionInput, SubtitleStyle } from "./KaraokeCaptions"`。
- **测试 `remotion/components/SubtitleOverlay.test.tsx`**：原 20 条用例全部保留且断言未削弱（`renderHighlightedText` 改为从 KaraokeCaptions 导入**真实实现**替代本地复制，`findCurrentLine`/`audioMs` 用例原样）；新增 29 条覆盖均分、Caption 兼容、分页（含标点断页/最小页长/hint/自定义 min-max）、读态边界、锚定翻页、字宽估计与字号收缩。共 49 条全绿。
- 验证：`npx tsc -p tsconfig.remotion.json` 通过；`HOME=/tmp/fakehome npx vitest run remotion/components/SubtitleOverlay.test.tsx tests/render/sync-runtime.test.ts tests/cli/preview.test.ts` 全通过（49 + 16 条）。

## 需要集成 Agent 做的共享文件改动

### 1. ⚠️ 关键：`src/render/sync-runtime.ts` — `REMOTION_RUNTIME_FILES` 必须登记新文件

SubtitleOverlay 现在 import `./KaraokeCaptions`，不登记会导致 build 目录 bundle 失败（找不到模块）。第 24–30 行改为：

```ts
export const REMOTION_RUNTIME_FILES = [
  'remotion/VideoComposition.tsx',
  'remotion/engine/block-frame.tsx',
  'remotion/engine/theme.ts',
  'remotion/engine/types.ts',
  'remotion/components/SubtitleOverlay.tsx',
  'remotion/components/KaraokeCaptions.tsx',
];
```

（`remotion/library/` 是整目录同步，KaraokeCaptions 对 `../library/tokens`、`../library/motion` 的依赖无需额外处理；`computeRuntimeHash` 会自动覆盖新文件。）

### 2. `tests/render/sync-runtime.test.ts` — 同步 fixture 列表

第 20–26 行 `RUNTIME_FILES` 数组追加 `"remotion/components/KaraokeCaptions.tsx"`；第 40–46 行 `files` fixture 追加：

```ts
"remotion/components/KaraokeCaptions.tsx": "// KaraokeCaptions fixture\n",
```

### 3. `remotion/VideoComposition.tsx` — 接线 style 与 charTimings

`ScriptMeta` / `BlockData` 接口追加可选字段（第 35–49、66–70 行）：

```ts
interface ScriptMeta {
  // ...现有字段
  /** 字幕风格预设：teach（默认克制）/ karaoke（逐字扫光）/ hype（短视频大字） */
  subtitleStyle?: "teach" | "karaoke" | "hype";
}
interface BlockData {
  // ...现有字段
  audio?: {
    wavPath: string;
    durationSec: number;
    lineTimings: LineTiming[];
    /** 块级覆盖 meta.subtitleStyle */
    subtitleStyle?: "teach" | "karaoke" | "hype";
    /** 字级时间轴，按 lineIndex 对齐（tts/对齐阶段产出，可能缺席） */
    charTimings?: ({ text: string; startMs: number; endMs: number; pageBreakAfter?: boolean }[] | undefined)[];
  };
}
```

`<SubtitleOverlay>`（第 279–287 行）追加两个 prop：

```tsx
<SubtitleOverlay
  lines={block.narration.lines}
  lineTimings={block.audio.lineTimings}
  audioStartFrame={enterFrames}
  frame={frame}
  fps={fps}
  theme={theme}
  subtitleSafeBottom={script.meta.subtitleSafeBottom}
  style={block.audio.subtitleStyle ?? script.meta.subtitleStyle}
  charTimings={block.audio.charTimings}
/>
```

不传时维持旧行为，存量 script.json 无需迁移。

### 4. `remotion/engine/types.ts` + `src/types/script.ts`（可选，建议做）

把 `SubtitleOverlayStyleProps` 的两个字段并入两边的 `SubtitleOverlayProps` 镜像定义，并从 `../components/KaraokeCaptions` 复用类型（或直接内联字面量联合）。当前不并入也能编译——字段已在 SubtitleOverlay.tsx 本地声明。

### 5. `schemas/script.schema.json` — 草案（与 charTimings 产出方 Agent 对齐后落盘）

```json
"subtitleStyle": { "type": "string", "enum": ["teach", "karaoke", "hype"], "description": "字幕风格：teach 整行淡入+关键词变色（默认）；karaoke 逐字扫光；hype 弹跳大字粗描边" },
"charTimings": {
  "type": "array",
  "description": "字级时间轴，外层按 narration lineIndex 对齐",
  "items": {
    "type": ["array", "null"],
    "items": {
      "type": "object",
      "required": ["text", "startMs", "endMs"],
      "properties": {
        "text": { "type": "string", "description": "单字（或词），逐字时每条一个字" },
        "startMs": { "type": "number" },
        "endMs": { "type": "number" },
        "pageBreakAfter": { "type": "boolean", "description": "分页提示（达到 8 字下限后生效）" }
      },
      "additionalProperties": true
    }
  }
}
```

挂点建议：`meta.subtitleStyle`、`blocks[].audio.subtitleStyle`、`blocks[].audio.charTimings`（均 optional，不破坏存量校验）。`additionalProperties: true` 是为了让 @remotion/captions 的 `Caption`（带 `timestampMs`/`confidence`）原样通过。

### 6. `autovideo.config.json` / 环境变量（可选）

建议新增可选字段 `subtitle.style: "teach" | "karaoke" | "hype"`（默认 `teach`），compile 阶段写入 `script.json meta.subtitleStyle`；或环境变量 `AUTOVIDEO_SUBTITLE_STYLE`。不配置时行为与现状一致。

### 7. 与 charTimings 产出方 Agent 的对接约定

字级时间轴按 **`script.json blocks[].audio.charTimings`**（外层数组下标 = `lineIndex`，每条 `{ text: 单字, startMs, endMs }`，ms 为该块音频时间轴）落地即可被 KaraokeCaptions 直接消费；缺席/某行缺失时自动退回行内均分，无需联动修改本组件。

## 注意事项

- **不要在 `remotion/library/index.ts` 注册 KaraokeCaptions**：它是帧级字幕层组件（依赖 `audioMs`/`audioStartFrame` 等运行时数据，非 JSON spec 驱动），不走预制组件 registry；`src/ai/visual-registry.ts` 无需新增条目。
- 组件 import 约定：SubtitleOverlay → KaraokeCaptions 是**值导入且不带扩展名**（Remotion webpack 无 extensionAlias），类型导入才用 `../engine/types.js` 带扩展名形式——后续改这些文件时保持。
- karaoke/hype 的字号按「最长页」统一计算，翻页不跳字号；hype 的 1.5× 大字经 `fitFontSize` 钳制，极端长行会缩到 band 内，不会压到字幕安全区之外。
- 未读字透明度 0.42、当前字 1.1×、读过回弹 0.15s、hype 倾斜 ±2.2° 均为组件内常量；如需主题化，请走 `theme.subtitle` 新增可选字段（`engine/types.ts` 与 `src/types/script.ts` 需同步镜像）。
- 存量测试无快照包含字幕 DOM 结构；`tests/render/sync-runtime.test.ts` 仅需按第 2 条补 fixture。
- 建议文档更新（共享文档，未在本任务内改）：`docs/architecture/PRD.md` §4 SubtitleOverlayProps 描述可补一句 style/charTimings 可选字段。
