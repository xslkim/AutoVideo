# AutoVideo 开发任务清单

> 按依赖顺序拆分。每个任务都给出：**输入 / 输出 / 验收 / 引用 PRD 章节**。AI agent 应**严格按顺序**执行；每完成一个任务就跑该任务的"验收"才能进入下一个。
>
> 所有任务都假定 cwd = repo 根（`/home/ubuntu/AutoVideo/`）。`@PRD.md` = `./PRD.md`。

---

## 阶段 0：项目初始化

### T0.1 仓库骨架
**输入**：空目录  
**输出**：`package.json` / `tsconfig.json` / `remotion.config.ts` / `.gitignore` / `bin/autovideo.ts` 占位入口  
**做什么**：
- `package.json` 字段按 `@PRD.md` §13.1 完整拷贝（含 `@remotion/google-fonts`、`ms`、`p-limit` 等）；`type: "module"`；`bin: { autovideo: "dist/bin/autovideo.js" }`
- `tsconfig.json`：`target: ES2022`、`module: NodeNext`、`moduleResolution: NodeNext`、`strict: true`、`esModuleInterop: true`、`outDir: dist`、`rootDir: .`
- `remotion.config.ts`：`Config.setKeyframeInterval(1)`（保证 §6.4 step 6 GOP 起点对齐 IDR）+ `Config.setVideoImageFormat('jpeg')`
- `bin/autovideo.ts`：commander.js 注册 8 个子命令的 stub（`build` / `compile` / `tts` / `visuals` / `render` / `preview` / `cache` / `doctor` / `init`），全部抛 "not implemented"
- `.gitignore`：`node_modules/`、`dist/`、`build/`、`.cache/`、`*.log`

**验收**：
- `npm install` 成功
- `npx tsx bin/autovideo.ts --help` 显示所有子命令
- `npx tsx bin/autovideo.ts compile foo.json` 退出码 1 + "not implemented"

---

### T0.2 类型定义 + Schema
**输入**：T0.1 完成  
**输出**：`src/types/script.ts` + `schemas/script.schema.json`  
**做什么**：
- `src/types/script.ts` 按 `@PRD.md` §4 全文实现：`Script` / `Block` / `NarrationLine` / `AnimationProps` / `BlockFrameProps` / `SubtitleOverlayProps` / `Theme` / `AnimationPreset`（联合字面量类型）
- 同时定义 5 种 readiness type：`CompiledScript` / `AudioReadyScript` / `VisualReadyScript` / `RenderInputScript` / `RenderedScript`（用 TypeScript `Omit` / `Required` / 交叉类型）
- `schemas/script.schema.json` 用 zod 推 schema 后 `zod-to-json-schema` 导出（或手写）；JSON Schema 字段宽松，readiness 收紧靠 TS 层

**验收**：
- `tsc --noEmit` 零错误
- 写一个最小 fixture script.json，能被 schema 校验通过
- TS 层 `assertCompiledScript({})` 报错（缺字段）

---

### T0.3 配置 loader
**输入**：T0.2 完成  
**输出**：`src/config/load.ts` + `src/config/defaults.ts`  
**做什么**：
- `defaults.ts`：导出按 `@PRD.md` §9 完整配置默认值的常量
- `load.ts`：合并 `defaults` + 读取 `autovideo.config.json`（项目根，可选）+ 解析 CLI `--config FILE` + 解析 `--cache-dir` + 解析 `--meta key=value`（**只允许顶层 meta 字段**，见 §7 `--meta` 段）
- 优先级（高 → 低）：CLI flag > `--config` 指定文件 > 项目根 `autovideo.config.json` > defaults
- 路径展开：`~` → `os.homedir()`；相对路径相对 cwd

**验收**：
- 单测：覆盖 `--meta dotted.key=val` 报错、`--meta title=foo` 类型推断、配置合并优先级

---

## 阶段 1：compile（无外部依赖，最先做）

### T1.1 项目文件 + meta 解析
**输入**：T0.3 完成  
**输出**：`src/parser/project.ts` + `src/parser/meta.ts`  
**做什么**：
- `project.ts`：读 `project.json`，解析 `meta` / `blocks` 字段，把所有相对路径解析为绝对路径，校验文件存在
- `meta.ts`：读 meta.md，解析 `--- meta ---` YAML-like 段（`key: value` 行），按 `@PRD.md` §3.4 校验字段；`voiceRef` 默认 `./B00.wav` 相对 meta.md 同目录；解析为绝对路径并校验文件存在；CLI override 在此应用
- `aspect` → `width × height`：`16:9` → 1920×1080，`9:16` → 1080×1920，`1:1` → 1080×1080

**验收**：
- 单测覆盖：缺字段报错、`voiceRef` 默认值、CLI override 生效、aspect 解析

---

### T1.2 块解析 + directive
**输入**：T1.1 完成  
**输出**：`src/parser/blocks.ts` + `src/parser/directives.ts`  
**做什么**：
- `blocks.ts`：按 `project.blocks` 顺序读取每个内容 .md，按 `>>>` 切块；标题行可选 `#B01` ID；`--- visual ---` 与 `--- narration ---` 两段都必须存在，缺失报错（含文件名 + 行号）
- `directives.ts`：解析 `@enter` / `@exit` / `@duration`；`@duration` 仅接受 `<数字>s` 格式（按 `@PRD.md` §3.5），其他报错
- 块 ID 全局唯一校验；省略 ID 按合并顺序自动编号 `B01` / `B02`...

**验收**：
- 单测覆盖：单文件多块、多文件合并顺序、ID 冲突、ID 自动编号、`@duration: 8` 报错（缺 s 后缀）、`@duration: 1m20s` 报错

---

### T1.3 旁白预处理
**输入**：T1.2 完成  
**输出**：`src/parser/narration.ts`  
**做什么**：
- 拆行（忽略空行）→ 每行生成 `NarrationLine`
- 解析 `**word**` 高亮：先把 `\*\*` 占位替换 → 提取 `**...**` 范围记入 `highlights[]` → 还原占位为字面 `**`
- `text` = 原文（含 `**`）；`ttsText` = 去 `**` + 还原 `\*\*` 后的纯文；`highlights[].start/end` **基于 ttsText 字符 offset**（按 §4 注释）

**验收**：
- 单测：`hello **world**` → highlights = `[{start:6, end:11}]`、ttsText = `hello world`
- `\*\*ptr` → ttsText = `**ptr`、无 highlights
- 多个高亮、嵌套（按"非贪婪 + 不嵌套"处理）

---

### T1.4 资产 hash 复制
**输入**：T1.3 完成  
**输出**：`src/parser/assets.ts`  
**做什么**：
- 扫描每块 `--- visual ---` 描述中的本地路径（正则：`(?:^|[\s])(\.\.?/[^\s]+\.[a-zA-Z0-9]+)`），按所在 .md 文件目录解析为绝对路径
- 计算文件 MD5 前 8 位 → 复制到 `<build out>/public/assets/{hash}.{ext}`
- 描述中路径替换为 `assets/{hash}.{ext}`（不带前导 `/`）
- 维护 `script.json.assets`：key = **相对 project.json 所在目录的 POSIX 路径**（按 §3.6 + §4 修订），value = `assets/{hash}.{ext}`
- 源代码片段（`.py` / `.ts` / `.js` 等）：除 hash 复制外，按描述中"第 X-Y 行"显式范围 + 上下文 ±5 行**内联**到 `visual.description`（包裹在 ``` ``` 代码块），其余行不内联（按 §3.6 写作规范修订项）

**验收**：
- 单测：同名不同目录 → 不同 hash key；同文件被多块引用 → assets 去重；缺失"第 X-Y 行"标注的代码引用 → 不内联，仅 hash 复制

---

### T1.5 compile 命令组装
**输入**：T1.1–T1.4 完成  
**输出**：`src/cli/compile.ts`  
**做什么**：
- 调用 T1.1 → T1.4 串成完整 pipeline：project → meta → blocks → narration → assets
- 计算 `subtitleSafeBottom = floor(height * 0.15)`
- JSON Schema 验证（用 T0.2 的 zod schema）
- 写出 `<build out>/script.json`、`<build out>/public/script.json`（同内容）
- `artifacts.compiledAt = new Date().toISOString()`
- **slugify**：默认 `--out = ./build/{slug(title)}/`；`slug` 规则按 `@PRD.md` §7（CJK 转拼音 + 安全字符）；可被 meta.md `slug:` 字段覆盖

**验收**：
- 快照测试：fixture project（2 块 + 1 张图）→ `script.json` 输出稳定
- E2E：用 `script-microgpt-part1-1.md` 兼容版做 fixture，能跑出有效 script.json

---

## 阶段 2：缓存基础设施（tts / visuals / render 都依赖）

### T2.1 缓存 store
**输入**：T0.3 完成  
**输出**：`src/cache/store.ts`  
**做什么**：
- 实现 `CacheStore` 类：`get(type, key) → file path | null`、`put(type, key, file, keyMetadata)`、`stats()`、`clean(opts)`、`evictIfOverLimit()`
- 三种 type：`audio` / `component` / `partial`，目录结构按 `@PRD.md` §11.1
- `manifest.json` 结构按 §11.3；用 `proper-lockfile` 锁 manifest 读写
- LRU evict：按 `@PRD.md` §11.4；`evictTrigger: "stage-start"` 仅对 tts / visuals / render 触发（compile 不触发）
- `--older-than` 用 `ms` 库解析；`--stale` 用传入的 stale predicate（promptVersion / remotionVersion 已变）

**验收**：
- 单测：put → get 命中、不同 key → miss、并发 put 不冲突（spawn 多 worker）
- 单测：超 maxSizeGB 时按 partial → component → audio 顺序 evict
- 单测：`--older-than 30d` 与 `--stale` 行为

---

### T2.2 cache CLI
**输入**：T2.1 完成  
**输出**：`src/cli/cache.ts`  
**做什么**：
- 实现 `autovideo cache stats | clean [--type ...] [--older-than ...] [--stale]`，按 `@PRD.md` §11.5
- `stats` 输出 JSON（机器可读）+ 表格（人读）双 mode

**验收**：
- 手动测试：`autovideo cache stats` 显示 0 条目；put 几条后再 stats 显示正确

---

## 阶段 3：tts stage（需要 VoxCPM 服务）

### T3.1 VoxCPM FastAPI wrapper
**输入**：无 TS 依赖  
**输出**：`tts-server/server.py` + `tts-server/requirements.txt`  
**做什么**：
- FastAPI 应用，按 `@PRD.md` §6.2.1 + §6.2.3 实现两个端点：
  - `POST /v1/voices` body `{wav_base64}` → 解码到临时文件、内存中保留 path、返回 `{voice_id}`（uuid4）
  - `POST /v1/speech` body `{text, voice_id, cfg_value, inference_timesteps, denoise, retry_badcase}` → 用 voice_id 找到参考音频、调 `VoxCPM.generate(reference_wav_path=..., ...)` → 返回 WAV 二进制（48kHz, `media_type="audio/wav"`）
  - `GET /health` → `{status: "ok", model_version: "..."}`（model_version = modelDir 下 config.json hash）
- 启动时 `VoxCPM.from_pretrained(local_path=os.environ["VOXCPM_MODEL_DIR"])` lazy load（首次 /v1/speech 触发）
- voice_id 用内存 dict 存（进程重启即失效，符合 §6.2.2）

**验收**：
- 手动：`uvicorn server:app` 启动；curl POST /v1/voices + /v1/speech 拿到 wav
- requirements.txt 装齐后 `python server.py` 可启动

---

### T3.2 voxcpm-client + autoStart
**输入**：T3.1 完成  
**输出**：`src/tts/voxcpm-client.ts` + `src/tts/voxcpm-server.ts`  
**做什么**：
- `voxcpm-client.ts`：HTTP client（用 `fetch`），实现 `registerVoice(wavPath) → voiceId`（每次 stage 启动调一次）、`speak(text, voiceId, params) → Buffer`、`health() → bool`
- `voxcpm-server.ts`：检测端口可达；不可达且 `voxcpm.autoStart = true` 时 spawn `uvicorn server:app`（设 `VOXCPM_MODEL_DIR`），轮询 health 等启动；进程绑定到 stage 生命周期（stage 退出时 SIGTERM）

**验收**：
- 单测（mock fetch）：register → speak 流程
- 集成测试（需要本地 VoxCPM）：autoStart 拉起服务并 ping 通

---

### T3.3 ffmpeg helpers
**输入**：T0.1 完成  
**输出**：`src/tts/audio.ts`  
**做什么**：
- `appendSilence(wavBuffer, ms) → Buffer`：用 `child_process.spawnSync('ffmpeg', ...)` pipe in/out 拼 200ms 静音
- `concatWavs(buffers[]) → Buffer`：拼多个 wav 段
- `wavDurationSec(wavPath) → number`：`ffprobe -v error -show_entries format=duration -of csv=p=0`

**验收**：
- 单测：拼 1s + 200ms 静音的 wav，ffprobe 时长 = 1.2s ± 1ms

---

### T3.4 lineTimings 计算
**输入**：T3.3 完成  
**输出**：`src/tts/timings.ts`  
**做什么**：
- 输入：每行 wav 的时长数组（从 ffprobe）  
- 输出：`lineTimings: {lineIndex, startMs, endMs}[]`
- 公式按 `@PRD.md` §6.2.3 step 4：`startMs[i] = Σ(行[0..i-1]时长 + 200ms)`，`endMs[i] = startMs[i] + 行[i]时长`

**验收**：
- 单测：3 行 [1.0s, 0.5s, 2.0s] → timings = [{0,1000},{1200,1700},{1900,3900}]

---

### T3.5 tts 命令组装
**输入**：T2.1 / T3.2 / T3.3 / T3.4 完成  
**输出**：`src/cli/tts.ts`  
**做什么**：
- 入口校验：script.json 是 `CompiledScript` readiness
- 启动 VoxCPM 服务（autoStart 兜底）
- 注册 `voiceRef` 拿 voiceId
- 计算 `voiceRefHash` / `voxcpmModelVersion`
- 用 `p-limit(voxcpm.concurrency)` 并发处理"块×行"二维任务（注意：块间并发 4，块内行串行更简单；或全部 line 拉平用一个 limit；按 PRD §6.2.4 默认"行级并发 4"）
- 每行：cache lookup → miss 则 `client.speak()` → put cache（按 §11.2 audio key）
- 块拼接：concat 所有行 wav + 每行尾追 200ms 静音 → 写到 `public/audio/B**.wav`
- 计算 lineTimings 写回 `script.json.blocks[].audio`
- 失败处理：单行 3 retry（间隔 5s）；仍失败 → `AbortController.abort()` 取消其他 in-flight、退出 stage、输出恢复命令（§10）

**验收**：
- E2E（mock voxcpm-api）：2 块 5 行脚本跑完、script.json 含完整 audio 字段、`public/audio/B01.wav` 存在
- cache 命中测试：跑两次第二次 0 API 调用

---

## 阶段 4：visuals stage（需要 Claude API）

### T4.1 prompt + 组件骨架
**输入**：T0.2 完成  
**输出**：`src/ai/prompts/component.md` + `docs/ARCHITECTURE.md` 的 "Visuals prompt" 节  
**做什么**：
- 写 system prompt：包含 `AnimationProps` 接口、`Theme` 接口、组件骨架示例（fade in 标题块）、可用 import 白名单（`remotion` / `react` / 项目 alias）、禁止事项（`fs` / `child_process` / `eval` 等）、字幕 safe area 约束
- 输出格式约定：tool call 返回 `{tsx: string}`
- 在 `docs/ARCHITECTURE.md` 单独写一节描述 prompt 设计与样例

**验收**：
- prompt 文件存在；md hash 计算稳定（用作 promptVersion）

---

### T4.2 Claude SDK 调用 + prompt cache
**输入**：T4.1 完成  
**输出**：`src/ai/component-gen.ts`  
**做什么**：
- 用 `@anthropic-ai/sdk`：构造 messages，system prompt 标 `cache_control: {type: "ephemeral"}`
- 工具定义：`{name: "render_component", input_schema: {tsx: string}}`，强制 `tool_choice: {type: "tool", name: "render_component"}`
- model 从 config 取（默认 `claude-sonnet-4-6`）；`max_retries` 走 SDK 内置（指数退避）
- API key：从 `process.env[anthropic.apiKeyEnv]` 取，缺失立即报错
- 返回 `{tsx, usage, cacheHit: boolean}`（按 response 中 `cache_read_input_tokens > 0` 判断）

**验收**：
- 单测（mock SDK）：构造的 request body 含 cache_control + tool definition
- 集成（可选，需 ANTHROPIC_API_KEY）：跑 1 次拿到 tsx 字符串

---

### T4.3 子进程隔离工具
**输入**：T0.1 完成  
**输出**：`src/ai/sandbox.ts`  
**做什么**：
- `runIsolated(cmd, args, opts) → {stdout, stderr, exitCode}`
- 实现：`child_process.spawn(cmd, args, { env: WHITELIST_ENV, cwd, timeout: 30_000 })`
- env 白名单：`PATH` / `HOME` / `LANG` / `TMPDIR` / `DISPLAY` / `NODE_OPTIONS`（按 `@PRD.md` §6.3）
- 包裹层：`prlimit --as=<mem> --cpu=<sec>`；可选 `unshare -n`（参数控制）
- 超时杀进程（SIGTERM → 5s → SIGKILL）

**验收**：
- 单测：env 中带 `ANTHROPIC_API_KEY` → 子进程内 `printenv ANTHROPIC_API_KEY` 为空
- 单测：超时进程被杀
- 单测：`unshare -n` 模式下子进程 `curl` 失败

---

### T4.4 验证（tsc + render smoke）
**输入**：T4.3 完成  
**输出**：`src/ai/validate.ts` + `<build out>/tsconfig.visuals.json` 模板  
**做什么**：
- 写出 `tsconfig.visuals.json`：`compilerOptions: { types: ["react", "remotion"], lib: ["ES2022", "DOM"], jsx: "react-jsx", strict: true, noEmit: true, allowJs: false, skipLibCheck: true }`、`include: [组件文件 + shim 路径]`
- shim 文件：暴露 `AnimationProps` / `Theme` 类型别名（避免 LLM 写 import path）
- `validateStatic(tsxPath)`：runIsolated `tsc -p tsconfig.visuals.json`（无网络）；解析 stderr 前 50 行返回
- AST 静态扫描：用 `@babel/parser` 拿到 import 列表，禁止 `fs/path/child_process/http/https`、禁止 `require()`/`eval`/`new Function`
- `validateRenderSmoke(tsxPath, tempDurationSec, fps)`：调 Remotion `renderStill`（用临时 Composition）拿单帧 PNG，判定非纯黑/纯白

**验收**：
- 单测：故意写禁止 import → 静态扫描拦截
- 单测：静态错误 tsx → tsc 拦截 + stderr 截取
- 集成：合法 tsx → renderStill 出非纯色 PNG

---

### T4.5 visuals 命令组装
**输入**：T2.1 / T4.1–T4.4 完成  
**输出**：`src/cli/visuals.ts`  
**做什么**：
- 入口校验：script.json 是 `CompiledScript` 即可（不要求 audio）
- 计算 `promptVersion` / `assetHashesJson` / `claudeModel`
- 用 `p-limit(anthropic.concurrency)` 并发处理块
- 每块：cache lookup → miss 则 generate → validate (静态 + smoke) → 失败回喂重试 3 轮（按 `@PRD.md` §6.3 step 5 回喂格式）→ put cache → 写到 `<build out>/src/blocks/B**/Component.tsx`
- 失败：3 轮仍失败 → AbortController 取消其他 in-flight → 退出 + 恢复命令

**验收**：
- E2E（mock Claude API，模拟首轮 tsc 错误 → 第二轮通过）：组件文件落盘 + script.json 含 componentPath
- 单测：3 轮都失败 → stage 退出码非 0、其他块未启动

---

## 阶段 5：Remotion 渲染层

### T5.1 theme + 字体加载
**输入**：T0.2 完成  
**输出**：`remotion/engine/theme.ts`  
**做什么**：
- 实现一个 `dark-code` 主题（按 §4 `Theme` 接口完整实现），值为常量
- 顶部 `import { loadFont } from '@remotion/google-fonts/NotoSansSC';` + `loadFont()` 调用，emoji 同样加载 Noto Color Emoji
- 导出 `getTheme(name): Theme`，未来扩展更多主题

**验收**：
- `tsc --noEmit` 零错误
- `getTheme('dark-code').subtitle.fontFamily` 含 "Noto Sans SC"

---

### T5.2 SubtitleOverlay
**输入**：T5.1 完成  
**输出**：`remotion/components/SubtitleOverlay.tsx`  
**做什么**：
- 接收 `SubtitleOverlayProps`（按 §4 修订接口）
- 内部计算：`audioFrame = frame - audioStartFrame`；`audioMs = audioFrame / fps * 1000`；从 `lineTimings` 找当前显示行
- 高亮渲染：按 `line.highlights[]` 把 ttsText 切片，高亮段加 `<span style={{color: theme.colors.accent}}>`
- 样式：`position: absolute`、`bottom: 0`、`width: maxWidthPct%`、`backgroundColor` + `padding`、`fontSize: height * fontSizePct`
- `audioFrame < 0` 时不渲染（入场期间）

**验收**：
- 在 Remotion Studio 单独跑一个测试 Composition，能看到字幕按时序切换 + 高亮

---

### T5.3 BlockFrame + animations
**输入**：T5.1 完成  
**输出**：`remotion/engine/animations.ts` + `remotion/engine/block-frame.tsx`  
**做什么**：
- `animations.ts`：实现 8 个预设（fade / fade-up / fade-down / slide-left / slide-right / zoom-in / zoom-out / none）→ 每个返回 `(progress: number) => CSSProperties`，progress ∈ [0,1]
- `block-frame.tsx`：接收 `BlockFrameProps`（§4 修订接口）；内部用 `useCurrentFrame()` 算 progress：
  - `frame < enterFrames`：enter 动画，progress = frame / enterFrames
  - `enterFrames ≤ frame < durationInFrames - exitFrames`：hold（无动画）
  - 末段：exit 动画
- children 包在 `<AbsoluteFill>` 内并叠加 enter/exit 计算出的 transform/opacity

**验收**：
- Remotion Studio 测试：fade-up 块进入时从下方滑入 + 渐显

---

### T5.4 BlockComposition（render 用）
**输入**：T5.2 / T5.3 完成  
**输出**：`remotion/VideoComposition.tsx`  
**做什么**：
- 实现 `BlockComposition: React.FC<{blockId: string}>`，按 `@PRD.md` §6.4 step 3 渲染结构：
  - lazy import 组件：`const DynamicComponent = lazy(() => import(`../src/blocks/${blockId}/Component`))`（render stage 在 build out dir 跑，路径相对此）
  - 包 `<Suspense>` + `<BlockFrame>`
  - `<SubtitleOverlay audioStartFrame={enterFrames} ...>`
  - `<Sequence from={enterFrames}><Audio src={staticFile(`audio/${blockId}.wav`)}/></Sequence>`
- script.json 通过 `staticFile('script.json')` + `useEffect` 或 `useState` + `fetch` 在组件内加载（也可由 Root.tsx 通过 inputProps 传入避免运行时 fetch）

**验收**：
- Studio 测试一块：能看到组件 + 字幕 + 音频按 enter 延迟播放

---

## 阶段 6：render stage

### T6.1 Root.tsx 生成器（render 模式）
**输入**：T5.4 + T2.1 完成  
**输出**：`src/render/root-render.ts`（生成 Root.tsx 字符串）  
**做什么**：
- 输入：解析后的 script.json
- 输出：写到 `<build out>/remotion-root.tsx` 的字符串：
  ```tsx
  import { registerRoot, Composition } from 'remotion';
  import { BlockComposition } from '../../remotion/VideoComposition';
  import script from './public/script.json';
  
  export const Root = () => (
    <Composition
      id="Block"
      component={BlockComposition}
      durationInFrames={1}
      fps={script.meta.fps}
      width={script.meta.width}
      height={script.meta.height}
      defaultProps={{ blockId: script.blocks[0].id }}
      calculateMetadata={({ inputProps }) => {
        const block = script.blocks.find(b => b.id === inputProps.blockId);
        return { durationInFrames: block.timing.frames };
      }}
    />
  );
  registerRoot(Root);
  ```

**验收**：
- 单测：snapshot 生成的 Root.tsx 字符串

---

### T6.2 timing 计算
**输入**：T0.2 完成  
**输出**：`src/render/timing.ts`  
**做什么**：
- 对每块算 `enterSec` / `holdSec` / `exitSec` / `totalSec` / `frames` / `enterFrames`，按 `@PRD.md` §6.4 step 1 修订公式
- `enter/exitSec` 由预设决定：`none` → 0，其他 → `render.defaultEnterSec/defaultExitSec`
- 写回 `block.timing`

**验收**：
- 单测：enter=fade-up 0.5s + hold=audio 3s + exit=fade 0.3s @ 30fps → frames = 114

---

### T6.3 partial 渲染（程序化 bundle + renderMedia）
**输入**：T6.1 / T6.2 / T2.1 完成  
**输出**：`src/render/render-blocks.ts`  
**做什么**：
- 调 `bundle({ entryPoint: '<build>/remotion-root.tsx' })` 一次拿 `serveUrl`（按 §6.4 step 4 修订）
- 计算每块 partial cache key（§11.2 partial 行）→ lookup
- 命中：`cp <cache>/partials/{hash}.mp4 → output/partials/{id}.mp4`，`render.cacheHit = true`
- 未命中：用 `selectComposition({serveUrl, id: 'Block', inputProps: {blockId}})` + `renderMedia({...})`，concurrency = `framesConcurrencyPerBlock`
- 块级并发用 `p-limit(blockConcurrency)`
- 失败：1 retry → 仍失败 abort 其他 in-flight，输出恢复命令
- 写回 `block.render = { partialPath, cacheHit }`

**验收**：
- 集成：2 块脚本跑一次 → output/partials/B01.mp4 + B02.mp4 各自 IDR 起始（用 ffprobe 校验首帧 `key_frame=1`）
- 第二次跑：两块都 cache hit、不调 renderMedia

---

### T6.4 ffmpeg concat
**输入**：T6.3 完成  
**输出**：`src/render/concat.ts`  
**做什么**：
- 实现 `validatePartials(partialPaths[])`：用 ffprobe 抽样校验 codec/分辨率/fps/像素格式/SAR 一致；不一致按 §10 报错
- 写 `concat.txt`（在 build out/output/ 下，按 §6.4 step 6 修订）
- 跑 `ffmpeg -fflags +genpts -f concat -safe 0 -i concat.txt -c copy -avoid_negative_ts make_zero final.mp4`（cwd = output/）

**验收**：
- 集成：2 块 partial concat 出 final.mp4，能播且无 PTS 警告

---

### T6.5 loudnorm two-pass
**输入**：T6.4 完成  
**输出**：`src/render/loudnorm.ts`  
**做什么**：
- 第 1 遍：`ffmpeg -i final.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -`，从 stderr 解析末尾 JSON
- 第 2 遍：`ffmpeg -i final.mp4 -c:v copy -c:a aac -b:a {audioBitrate} -af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=...:measured_TP=...:measured_LRA=...:measured_thresh=...:offset=... final_normalized.mp4`（按 §6.4 step 7 修订，`-b:a` 必带）

**验收**：
- 集成：final_normalized.mp4 用 ffmpeg loudnorm 二次测量 integrated loudness 应在 -16 ± 0.5 LUFS

---

### T6.6 质量校验
**输入**：T6.5 完成  
**输出**：`src/render/qa.ts`  
**做什么**：
- 校验 final_normalized.mp4：分辨率匹配 meta.width × meta.height、总时长 = Σ partial 时长 ± 1 帧、5 个等距抽样帧非纯黑

**验收**：
- 单测：构造黑帧 mp4 → QA 失败

---

### T6.7 render 命令组装
**输入**：T6.1–T6.6 完成  
**输出**：`src/cli/render.ts`  
**做什么**：
- 入口校验：`RenderInputScript`（含 audio + componentPath）
- 调 T6.2 算 timing 写回
- 写 `public/script.json`（main process 一次写完，按 §6.4 step 2）
- 调 T6.1 写 Root.tsx
- 调 T6.3 渲染所有/指定块的 partial
- 调 T6.4 concat
- 调 T6.5 loudnorm
- 调 T6.6 QA
- `--block` 语义按 §7 修订：默认走 cache，`--force` 强制 miss
- artifacts.renderedAt 写入

**验收**：
- E2E：mock 数据全跑通 → output/final_normalized.mp4 可播
- E2E：`--block B01 --force` 仅重渲 B01 + concat，B02 partial 文件 mtime 不变

---

## 阶段 7：preview stage

### T7.1 Root.tsx 生成器（preview 模式）
**输入**：T5.4 完成  
**输出**：`src/preview/root-preview.ts`  
**做什么**：
- 为每块注册一个独立 `<Composition id="B01" ...>` `<Composition id="B02" ...>`...
- 复用 `BlockComposition`（与 render 共用）
- 缺 audio 的块：把 BlockComposition 的 `<Audio>` 跳过（按 §6.5 修订）；可在 BlockComposition 内部读 `script.blocks[].audio` 是否存在判断

**验收**：
- 单测：snapshot Root.tsx 字符串

---

### T7.2 preview 命令
**输入**：T7.1 完成  
**输出**：`src/cli/preview.ts`  
**做什么**：
- 写 Root.tsx 到 `<build out>/remotion-root.tsx`（**注意**：preview 与 render 写到同一文件名，不能同时跑；建议用不同文件名 `remotion-root-preview.tsx`，并改 `remotion.config.ts` 默认入口为 env var 控制）
- spawn `npx remotion studio remotion-root-preview.tsx --port=...`（cwd = build out dir）
- `--block B03` 通过 query string 或 entry composition 默认值定位

**验收**：
- 手动：`autovideo preview script.json` 浏览器打开 Studio 显示所有块；`--block B03` 直接定位 B03

---

## 阶段 8：build / doctor / init

### T8.1 build orchestrator
**输入**：T1.5 / T3.5 / T4.5 / T6.7 完成  
**输出**：`src/cli/build.ts`  
**做什么**：
- 校验 `--block` 不存在（按 §7 修订；存在则报错并提示用分步命令）
- 顺序调 compile → tts → visuals → render
- 任一阶段 exit code 非 0 立即退出，stderr 透传
- 进程 cwd 在 compile 出 script.json 后切到 build out dir（按 §10 cwd 约定）

**验收**：
- E2E：模板项目 `autovideo build` 一次跑完

---

### T8.2 doctor
**输入**：T0.3 完成  
**输出**：`src/cli/doctor.ts`  
**做什么**：
- 实现 §7 doctor 检查项表全部 11 项
- 输出表格 + 每项 PASS/WARN/FAIL + 修复指引
- 按 §7 退出码规则返回 0 / 1 / 2

**验收**：
- 手动：在干净环境跑 doctor 列出所有 FAIL；安装齐后全 PASS

---

### T8.3 init + templates
**输入**：T0.1 完成  
**输出**：`src/cli/init.ts` + `templates/starter/{project.json, meta.md, script.md, autovideo.config.json, README.md}`  
**做什么**：
- `init <dir>`：复制 templates/starter 到 `<dir>`
- README.md 模板内容明确说明：1) 把 B00.wav 放到 meta.md 同目录；2) 设 ANTHROPIC_API_KEY；3) 跑 doctor；4) 跑 build
- script.md 模板：1 个 textcard 块 + 1 个引用 ./hero.png 的块（hero.png 也复制进去）

**验收**：
- 手动：`autovideo init demo` → demo/ 目录结构齐全；`cd demo && autovideo build` 能跑通（需准备 B00.wav）

---

## 阶段 9：测试 / 文档 / 安装脚本

### T9.1 单测补全
**输入**：所有 stage 完成  
**输出**：补齐 `tests/parser.test.ts` / `narration.test.ts` / `cache.test.ts` / `tts-timings.test.ts` 等  
**做什么**：把各 task 验收里"单测"项汇总到 vitest 工程

**验收**：`npm test` 全绿

---

### T9.2 E2E 测试
**输入**：T8.1 完成  
**输出**：`tests/e2e.test.ts`  
**做什么**：写一个最小项目（2 块、含图片、含代码引用），用 mock VoxCPM + mock Claude 跑完整 build；校验 final_normalized.mp4 存在 + 时长 + 分辨率

**验收**：`npm run test:e2e` 全绿

---

### T9.3 install.sh
**输入**：所有 deps 确定  
**输出**：`install.sh`  
**做什么**：按 `@PRD.md` §13.3 全 6 步实现；支持 `--skip-model` flag

**验收**：在 Ubuntu 22.04 fresh container 跑 → doctor 全 PASS

---

### T9.4 文档
**输入**：所有功能完成  
**输出**：`docs/INPUT_SPEC.md` + `docs/ARCHITECTURE.md` + 更新 `README.md`  
**做什么**：
- INPUT_SPEC：用户视角讲 project.json + meta.md + 块语法
- ARCHITECTURE：开发者视角讲 stage / cache / 隔离 / Theme 扩展
- README：5 分钟快速开始

**验收**：人读一遍清晰；ARCHITECTURE 中 visuals prompt 节落地完整 system prompt

---

## 任务依赖图（总览）

```
T0.1 → T0.2 → T0.3
                ├─→ T1.1 → T1.2 → T1.3 → T1.4 → T1.5  ─┐
                ├─→ T2.1 → T2.2  ────────────────────────┤
                ├─→ T3.1 → T3.2 ─┐                       │
                │       T3.3 ─┐  │                       │
                │       T3.4 ─┤  ├─→ T3.5  ──────────────┤
                │             └──┘                       │
                ├─→ T4.1 → T4.2 ─┐                       │
                │       T4.3 ─┐  │                       │
                │       T4.4 ─┤  ├─→ T4.5  ──────────────┤
                │             └──┘                       │
                ├─→ T5.1 → T5.2                          │
                │       T5.1 → T5.3                      │
                │           T5.2 + T5.3 → T5.4 ─┐        │
                │                               │        │
                │                       T5.4 → T6.1 ─┐   │
                │                               T6.2 ─┤   │
                │                       T6.1+T6.2 → T6.3 → T6.4 → T6.5 → T6.6 → T6.7
                │                                                                 │
                │                       T5.4 → T7.1 → T7.2                        │
                │                                                                 │
                │                                       T1.5+T3.5+T4.5+T6.7 → T8.1 ─┐
                │                                                            T8.2 ─┤
                │                                                            T8.3 ─┤
                │                                                                  ├─→ T9.1 → T9.2 → T9.3 → T9.4
```

---

## 给 AI agent 的执行规则

### 0. 启动协议（每次会话开始 / 中断恢复）

1. 读 `@PRD.md` 全文（视为合同）
2. 读本文件 `@TASKS.md` 全文
3. 读 `@PROGRESS.md` —— 这是**唯一的状态真相**
4. `git status` 确认工作树干净（如有未提交改动，决定丢弃 / 续上 / 询问人类）
5. `git log -1 --oneline` 与 `PROGRESS.md` 中最近 `done` 行的 commit hash 比对，确认未被人类手动改动
6. 找到 `PROGRESS.md` 任务表中第一个 `in_progress` 行——若有，说明上次中断在此任务中途，从该任务的"做什么"步骤里**未完成的子项**继续；否则找第一个 `pending` 行，正式开始

### 1. 任务执行协议（每个 Tx.y）

按以下顺序，**不允许跳步**：

1. **开始前**：把 `PROGRESS.md` 的对应行 status 改为 `in_progress`，填 `开始` 时间戳；把顶部 `当前状态` 节的 `active_task` / `last_updated` / `next_action` 同步更新；提交 `chore(Tx.y): start` commit
2. **实现**：按 TASKS.md 中"做什么"逐项落地；遇到 PRD 模糊点优先按以下规则处理：
   - 有合理 default 且影响小 → 自行决定 + 在 `PROGRESS.md` 的"决策日志"追加一条，**不阻塞**
   - 没有合理 default / 乱猜代价高 → 在"阻塞 / 待决策"追加条目，把 status 改 `blocked`，**停下等人**
   - 发现 PRD 描述本身有错（API 不存在、矛盾） → 在"已知差异"追加条目，**同时**用 StrReplace 修订 PRD 对应章节，提交 `docs(Tx.y): align PRD with reality`
3. **验收**：按 TASKS.md 中"验收"逐项跑过；任一项失败 → 修，**不允许**带 ✗ 进入下一任务
4. **完成**：`git add -A && git commit -m "feat(Tx.y): <描述>"`（或 `test(Tx.y)` / `docs(Tx.y)`）；把 `PROGRESS.md` 对应行 status 改 `done`，填 `完成` 时间戳和 commit hash；在"验收记录"追加一段；把顶部 `当前状态` 节的 `completed` 计数 +1、`active_task` 改下一个任务 ID；提交 `chore(Tx.y): done` commit

### 2. 强制约束

- 严格按 TASKS.md 编号顺序；并行只允许在依赖图明确独立的小组内（如 T3.3 / T3.4，T5.1 / T5.2 / T5.3）
- **每个 Tx.y 至少 1 个 commit**（实现）+ 2 个 chore commit（start / done）；start 与 done 在 PROGRESS 状态字段切换
- **永远不要**:
  - 跳过验收
  - silently 改 PRD（必须走"已知差异"流程）
  - 直接动 PROGRESS.md 任务表里其他任务的状态（只能动 active 任务行）
  - 在 stage 失败后自己降级 / 改默认值掩盖问题
- mock 优先：测试用 mock VoxCPM / mock Claude；E2E 之外不消耗真实 API 配额

### 3. 中断恢复行为示例

> 假设 agent 上次跑到 T1.3 写了一半被 ctrl-c。

恢复时：
1. 读 PROGRESS.md → `active_task: T1.3`，status 行 `in_progress`，备注列 `正在写 escape \\*\\* 测试`
2. `git log` 看到最后一个 commit 是 `chore(T1.3): start`，T1.2 的 done commit 在它之前
3. `git diff HEAD` 看是否有未提交的中间产物 → 决定保留续写 / 丢弃重来
4. 继续 T1.3 实现到验收通过，正常走"完成"协议
