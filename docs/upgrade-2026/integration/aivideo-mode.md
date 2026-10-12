# 集成笔记：aivideo-mode（AI 生成视频模式）

任务产出文件（已在本分支完成）：

- `src/ai/video-gen.ts`（新建）— 双轨文生视频 client + LLM prompt 规划 + clips 缓存 + 块转换
- `src/cli/visuals.ts`（小改）— visuals 阶段新增 `aivideo` 分支（含失败回退）

以下共享文件改动需要集成 Agent 统一落地，均可直接照抄。

---

## 1. `schemas/script.schema.json` — visualMode 枚举

`properties.blocks.items.properties.visualMode`：

```json
"visualMode": {
  "type": "string",
  "enum": ["animation", "image", "video", "html", "aivideo"],
  "default": "animation",
  "description": "Visual generation mode: animation (Claude-generated Component.tsx), image (AI-generated PNG), video (local mp4 file), html (user-authored HTML/CSS/JS rendered via headless Chrome), or aivideo (AI text-to-video clip, generated at the visuals stage and converted to video mode)"
}
```

## 2. `src/types/script.ts` — VisualMode union

```ts
export type VisualMode = 'animation' | 'image' | 'video' | 'html' | 'aivideo';
```

注意：各 readiness 守卫（`isVisualReady` / `assertVisualsReady` / `isRenderInputReady` / `assertRenderInputReady`）**不需要**为 `aivideo` 加分支——visuals 阶段成功后块已被改写为 `video`（带 `videoPath` + `componentPath`），守卫走 video 分支即可。未过 visuals 阶段的 `aivideo` 块会在守卫处落入 animation 分支报「missing componentPath」，语义正确（就是没就绪）。

## 3. `src/parser/directives.ts` — @visual 指令

```ts
const VALID_VISUAL_MODES: readonly string[] = ["animation", "image", "video", "html", "aivideo"];
```

（`aivideo` 无 `(...)` 本地文件变体；`--- visual ---` 正文是描述，由 LLM 转成英文视频 prompt。）

## 4. `src/cli/visuals.ts` — 集成后的一处简化

VisualMode union 扩展后，把 aivideo 分支的字符串比较简化（当前为绕过类型用的 `as string`）：

```ts
// 现在：if ((block.visualMode as string) === 'aivideo') {
// 改为：if (block.visualMode === 'aivideo') {
```

## 5. `src/config/defaults.ts` — 可选 videoGen 段（建议）

为避免循环 import（`ai/video-gen.ts` → `agent/` → `config/claude-settings.ts`），建议把类型定义放进 defaults.ts，`video-gen.ts` 改为从这里 import（与 `ImageGenProvider`/`ImageGenConfig` 同一模式）：

```ts
export type VideoGenProvider = "seedance" | "wanx" | "comfyui";
export type VideoGenFallback = "image" | "animation";
export interface VideoGenConfig {
  provider?: VideoGenProvider;
  baseURL?: string;      // API 轨 base URL
  apiKey?: string;       // API 轨 key
  model?: string;
  timeoutMs?: number;    // 单条 clip 总预算，默认 900000
  pollIntervalMs?: number; // 默认 5000
  size?: string;         // "1280x720" / "1280*720"，缺省按 aspect → 720p 档
  durationSec?: number;  // LLM 未给时的缺省片长，默认 5
  negativePrompt?: string;
  seed?: number;         // 缺省从 prompt 哈希派生（保证缓存稳定）
  fps?: number;          // ComfyUI clip 帧率，默认 24
  numSteps?: number;     // ComfyUI KSampler steps，默认 20
  cfgScale?: number;     // ComfyUI CFG，默认 5
  comfyuiURL?: string;   // 默认 http://127.0.0.1:8188
  comfyuiWorkflowPath?: string; // 自定义 workflow JSON 模板
  comfyuiUnet?: string;  // 默认 wan2.2_ti2v_5B_fp16.safetensors
  comfyuiClip?: string;  // 默认 umt5_xxl_fp8_e4m3fn_scaled.safetensors
  comfyuiVae?: string;   // 默认 wan2.2_vae.safetensors
  fallback?: VideoGenFallback; // 生成失败回退，缺省 = 直接失败
}
```

`AutoVideoConfig` 加 `videoGen?: VideoGenConfig;`（可选，不破坏现有配置与 web 端）。同时把 `visuals.ts` 中的 `videoGenConfigFromEnv()` 改为 `videoGenConfigFromEnv(config.videoGen ?? {})`（base 优先、env 补缺的语义已在 `videoGenConfigFromEnv` 里实现）。

## 6. `docs/guidelines/AUTHORING.md` — 给写作 LLM 的规范文本

`@visual` 模式值表（§2 附近）加一行：

```markdown
| `@visual: aivideo` | **LLM 先把描述转成英文视频 prompt**，再调用文生视频（火山 Seedance / 阿里 Wan2.5 / 本地 ComfyUI Wan2.2），产物内部转为 video 模式渲染 | `assets/clips/{id}.mp4` + `public/videos/{id}.mp4` |
```

§3 加一小节（与 `src/ai/video-gen.ts` 的 `AIVIDEO_USAGE_BOUNDARIES` 保持一致，两处是同一文本）：

```markdown
#### AI 视频模式 (`@visual: aivideo`)

**只用于**：片头片尾、转场 B-roll、抽象氛围画面（光场/粒子/流体渐变/缓慢运镜的空镜）。
**禁止**：任何需要可读文字的画面——图表、代码、公式、表格、要点列表一律用 `animation`（视频模型会把文字画花）。
块时长长于 clip 时长时画面自动循环（wrapper 带 `loop`）。需要配置：API 轨设 `VIDEO_GEN_API_KEY`（可选 `VIDEO_GEN_BASE_URL`/`VIDEO_GEN_MODEL`/`VIDEO_GEN_PROVIDER=seedance|wanx`），本地轨设 `VIDEO_GEN_PROVIDER=comfyui`（可选 `VIDEO_GEN_COMFYUI_URL`）。生成失败可用 `VIDEO_GEN_FALLBACK=image|animation` 配置降级，缺省直接失败。
```

## 7. `README.md` / `docs/AGENTS.md` 表格行（共享文档，由集成统一改）

- visuals 阶段说明行追加：「`aivideo` 块：LLM 产出英文视频 prompt → 文生视频 clip → 转 video 模式渲染」。
- 环境变量表新增：

```markdown
| `VIDEO_GEN_PROVIDER` | 文生视频后端：`seedance`（火山 Ark，默认）/ `wanx`（阿里 DashScope Wan2.5）/ `comfyui`（本地 Wan2.2 TI2V-5B） |
| `VIDEO_GEN_API_KEY` / `VIDEO_GEN_BASE_URL` / `VIDEO_GEN_MODEL` | API 轨凭证与端点 |
| `VIDEO_GEN_COMFYUI_URL` / `VIDEO_GEN_COMFYUI_WORKFLOW` | 本地轨 ComfyUI 地址（默认 http://127.0.0.1:8188）与自定义 workflow JSON 模板 |
| `VIDEO_GEN_TIMEOUT_MS` / `VIDEO_GEN_POLL_INTERVAL_MS` | 单条 clip 预算（默认 900s）/ 轮询间隔（默认 5s） |
| `VIDEO_GEN_SIZE` / `VIDEO_GEN_DURATION_SEC` / `VIDEO_GEN_SEED` | 尺寸 / 缺省片长 / 固定种子覆盖 |
| `VIDEO_GEN_FALLBACK` | 生成失败降级：`image` 或 `animation`，缺省失败即中止 |
```

## 8. `src/cli/doctor.ts`（可选接入）

`video-gen.ts` 已导出 `videoGenHealthURL(config)`（comfyui → `{url}/system_stats`；API 轨返回 null）与 `isVideoGenConfigured(config)`，可仿照 imageGen 的健康检查接入 doctor。

## 9. server / web 的 VisualMode 字面量（编译后、visuals 前可能见到 `aivideo`）

- `server/services/scriptParser.ts`（@visual 解析 + union）
- `server/types/api.ts:41`
- `web/src/utils/scriptParser.ts:16`、`web/src/components/block/BlockOutputs.vue:169`、`web/src/components/layout/BlockSidebar.vue:83-84`（badge 图标，可给 `aivideo` 一个 🎥）

visuals 跑完后块已是 `video`，web 端主要见到的是 video；上述只是为了 compile→visuals 之间的中间态不出错。

## 10. 去重建议（与其他 Agent 协调）

1. **ComfyUI client**：image-gen.ts 的 comfyui provider 由另一 Agent 实现。`video-gen.ts` 里的 `submitComfyUIPrompt` / `pollComfyUIHistory` / `/view` 下载是通用 ComfyUI HTTP 逻辑——建议抽出 `src/ai/comfyui-client.ts` 共享，`video-gen.ts` 只留 `buildWan22Ti2vWorkflow`（Wan2.2 TI2V-5B 图定义）与参数映射。
2. **HTTP helpers**：`createFetchController` / `wrapFetchError` / `readHttpError` / `parseSize` 是从 `image-gen.ts` 复制的本地版本，建议抽 `src/ai/http-utils.ts` 供 image-gen / video-gen 共用。
3. **缓存**：video-gen 目前用自建 sidecar 缓存（`assets/clips/{id}.json`，按描述哈希命中可跳过 LLM 规划）。如需跨项目去重，可在 `cache/store.ts` 加 `"videos"` CacheType + `VideoKey`（prompt/model/width/height/durationSec/fps/seed/provider），`generateAIVideo` 改为先查全局缓存再落 clips。
4. **wrapper 组件**：`compile.ts` Step 7.6 的内联 `VIDEO_WRAPPER_TSX` 与 `video-gen.ts` 的 `buildVideoWrapperComponent()` 同形（后者多一行 `// clip-hash:` 注释用于击穿 render partial 缓存）。建议统一由一个导出（如 compile 改为 import `buildVideoWrapperComponent`）。

## 11. 测试建议（本任务未新建测试文件，属边界外）

建议新增 `tests/ai/video-gen.test.ts`，蓝图已在我的一次性 smoke 里验证过：`videoGenConfigFromEnv`/`resolveVideoGenProvider` 启发式、`parseVideoPromptPlan`（裸 JSON / fence / 垃圾输入）、`buildWan22Ti2vWorkflow` 节点连线与参数、loopback HTTP server 打通的 seedance 轨全链路（submit→poll→download→落盘→块转 video）、缓存命中零网络、ComfyUI 轨 `/prompt`→`/history`→`/view` 全链路、`node_errors` 400 透传、`ERR_VIDEO_GEN_NOT_CONFIGURED`。visuals 分支级：happy path 转 video、重跑跳过、`VIDEO_GEN_FALLBACK=image` 降级、无回退时块失败（`ERR_VISUALS_BLOCK_FAILED`）。

## 12. 行为说明（集成后用户可见）

- 生成成功后 `script.json` 里该块被**改写为 `visualMode: "video"`**（`videoPath` + `componentPath` 齐备），渲染、预览、类型守卫全部走现有本地视频路径；重跑 `visuals` 会命中 video 分支直接跳过，`--force` 才重新生成。
- wrapper `<Video loop>`：块时长 ≠ clip 时长时自动循环/截断。
- clip 原始产物留在 `assets/clips/{id}.mp4`（+ `.json` sidecar），渲染用的是 `public/videos/{id}.mp4` 副本。
