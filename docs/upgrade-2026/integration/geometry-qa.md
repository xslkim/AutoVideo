# geometry-qa — 集成事项

> 来源任务：`geometry-qa`（确定性视觉几何 QA，SGA 思路）。
> 新增文件：`src/ai/visual-geometry.ts`（自包含，已 `npm run build` 通过）、`tests/ai/visual-geometry.test.ts`（31 测试全过，含 2 个真实浏览器 e2e）。
> 未改动任何现有文件：`src/ai/visual-metrics.ts` 原样保留，两者并列、纯增量。

## 1. 功能与导出

`src/ai/visual-geometry.ts` 导出（与 `assessVisualMetrics` 并列的确定性门）：

- `assessVisualGeometry(options: GeometryScanOptions): Promise<VisualGeometryResult>`
  返回 `{ pass, feedback, issues, framesScanned?, skipped?, error? }`。
  **环境失败（无 Chrome / bundle 超时）返回 `pass: true, skipped: true`**——永不因基础设施问题卡死流水线，与 metrics 门"broken Chrome 不得禁用质量回路"的语义一致。
- `scanComponentGeometry(options)`：底层扫描（返回原始 issues）。
- 纯函数（可单测）：`analyzeGeometrySnapshot`、`mergeFrameIssues`、`geometryIssuesToFeedback`、`parseCssColor`、`compositeOver`、`relativeLuminance`、`contrastRatio`、`DEFAULT_GEOMETRY_THRESHOLDS`。

四类确定性检测（逐帧对真实渲染 DOM 跑 `getBoundingClientRect()` + `getComputedStyle()`）：
`text-overlap`（文字元素重叠）、`canvas-overflow`（文字/媒体溢出画布）、`safe-zone-intrusion`（内容侵入 subtitleSafeBottom 字幕区，全屏背景自动豁免）、`low-contrast`（前景≈背景，WCAG 对比度 < 2.0）。
反馈为中文、含元素标签 + 像素级数值 + 修复方向 + 帧号，已按 `retryContext` 回路风格排版（含"保持技术契约不变"尾行）。

## 2. src/cli/visuals.ts 接入（建议，属 visuals 管线的 Owner Agent）

接入点在 `src/cli/visuals.ts:899-929` 的 `assessVisualMetrics` 门之后、Plan B 多模态评审之前（`try` 块内，`cleanupStill(still.tempDir)` 之前）：

```ts
import { assessVisualGeometry } from "../ai/visual-geometry.js"; // 文件顶部，与 assessVisualMetrics 并列
```

```ts
                // Geometry QA (deterministic DOM scan): reuses the bundle that
                // renderComponentStill just built — no extra bundling cost.
                // skipped=true on environment failure (no Chrome etc.) and
                // must not fail the attempt.
                if (still.ok) {
                  const geometry = await assessVisualGeometry({
                    serveUrl: path.join(still.tempDir, "bundle"),
                    frameFractions: frameTimesSec.map((t) => t / totalSec),
                    safeBottom: script.meta.subtitleSafeBottom,
                    backgroundColor: script.meta.theme?.colors?.bg,
                    browserExecutable: config.render?.browser, // 复用现有 render.browser 配置
                    timeoutMs: 30000,
                  });
                  if (!geometry.pass) {
                    if (verbose) {
                      console.log(
                        `  Block ${blockLabel}: geometry QA found ${geometry.issues.length} issue(s) — regenerating`
                      );
                    }
                    failAttempt(geometry.feedback);
                  }
                } else if (verbose) {
                  // still 失败时几何扫描无从谈起，保持现状仅跑静态指标
                }
```

要点：
- **serveUrl 复用**：`renderComponentStill`（`src/ai/validate.ts:594`）把 bundle 写到 `path.join(still.tempDir, "bundle")`；`cleanupStill` 在 finally 才执行，故此处在其之前复用，零额外 bundle 开销。composition id 无需传——模块自动用 `window.remotion_getCompositionNames()[0]` 发现（smoke root 里是 `"SmokeTest"`）。
- 组装模式（assemble）**同样适用**：几何扫描测的是渲染产物 DOM，不做单文件源码分析，不会像静态指标那样误伤 wrapper；`failAttempt` 已负责把反馈改写成"调整 JSON spec"口径。
- `frameFractions` 与 review 帧保持一致（同一时刻对齐旁白），也可省略带默认值 `[0.5]`。
- 也可用独立自足模式（不依赖 still 的 bundle）：传 `tsxPath + buildOutDir + width/height/fps [+ theme/lineTimings/subtitleSafeBottom/durationSec]`，模块自行 bundle。集成时优先 serveUrl 模式。

## 3. 可选配置（src/config/ 归其他 Agent —— 仅提案，可选字段不破坏类型）

`DEFAULT_VISUAL_QUALITY`（`src/config/defaults.ts`）可加可选开关，默认开：

```ts
export interface VisualQualityConfig {
  // …现有字段…
  /** 确定性几何 QA（DOM 重叠/溢出/字幕区/对比度扫描）。默认 true。 */
  geometry?: boolean;
}
// DEFAULT_VISUAL_QUALITY 中：geometry: true,
```

接入处包一层 `if (vq.geometry !== false && still.ok)`。不配此字段也可工作（用户可用环境变量 `PUPPETEER_EXECUTABLE_PATH` 指定浏览器；不指定时按 render.browser → @remotion/renderer ensureBrowser → 系统 chrome 链解析）。

## 4. 行为注意事项

- 浏览器解析链：`browserExecutable 参数 → PUPPETEER_EXECUTABLE_PATH → @remotion/renderer ensureBrowser()（node_modules/.remotion 的 chrome-headless-shell）→ 系统 google-chrome/chromium`，与 `src/render/html-render.ts` 同款。
- 编排协议完全复用 renderStill 的内部协议（`remotion_setBundleMode({type:'evaluation'|'composition'})` → `remotion_calculateComposition` → `remotion_setFrame` → 轮询 `window.remotion_renderReady`），但只用 puppeteer-core 公开 API + 自带的 127.0.0.1 静态服务器，不 import @remotion/renderer 的非导出内部函数。
- 发往页面的代码全部是字符串常量（`COLLECT_DOM_GEOMETRY_SOURCE`），因为 tsx/vitest 的 esbuild keepNames 会给函数体注入 `__name(...)`，函数引用经 puppeteer 序列化后在页面内会 `__name is not defined`。**改动页内代码时务必保持它是无模板字面量的纯 JS 字符串。**
- 成本：serveUrl 复用模式下每次扫描 ≈ 一次 Chrome 页面加载 + 每帧一次 DOM 遍历（实测 <2s/块）；环境不可用时自动跳过，零阻塞。
- 已知边界：不分析伪元素（::before/::after）与 canvas 2d 内部绘制；`low-contrast` 仅当能确定有效背景色时判定（祖先背景 → body/html → theme bg），否则跳过宁缺毋滥。

## 5. 验证

```bash
npm run build                                                        # 通过
HOME=/tmp/fakehome npx vitest run tests/ai/visual-geometry.test.ts   # 31 passed（无 chrome-headless-shell 时 e2e 自动跳过）
```
