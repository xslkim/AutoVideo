# AutoVideo Web UI — 产品需求文档

**版本**: 2.4
**日期**: 2026-05-03
**状态**: 待开发（目标：可由 AI agent 自主按文档实现）

**v2.4 更新**:
- 修正 §8 帧预览：去掉不存在的 `timing.startFrame/endFrame`，改用 Block composition + blockId
- 解决 §14.1 tsconfig 矛盾：根 tsconfig 不 include server/
- 快照流程必须复制 voice/ 目录（§4.5），否则 voiceRef 找不到文件
- 加 `currentSlug` 任务运行期锁定规则（§3.3），meta.md slug 变更与未结束任务冲突返回 409
- 明确 web 模式不读 `~/.claude/settings.json`，仅给一次性导入提示（§13.4）
- Remotion bundle 必须显式传 `publicDir`（§7 / §8 / §A.5.4）
- 单块清缓存同时清 cache/* + build/{slug}/ 实际产物 + 回写 script.json 字段（§5.1）
- Phase 1 / Phase 6 验收脚本修正：先 build:server；`/api/projects/:name/output` 用 Content-Type 校验
- 修正 server 编译入口路径：`tsconfig.server.json` 使用 `rootDir: "."` 时启动入口为 `dist/server/server/index.js`
- 文档示例项目名统一为当前仓库实际目录 `microgpt`
- 所有会改写 `meta.md` / `script.md` 的接口都必须使用 ETag/If-Match，避免跨 Tab 覆盖
- 取消 running 任务时 worker 不释放队列，直到实际运行 promise settle；超时只标记 `cancelling` 并暂停后续任务

---

## 1. 背景与目标

AutoVideo 目前是纯 CLI 工具，使用流程繁琐，需要记忆命令、手动编辑 Markdown 文件、通过终端触发各阶段任务。本次升级目标：

- 提供 Web UI，在浏览器中完成项目管理、脚本编辑、任务触发、产物预览全流程
- 所有耗时任务（TTS、生成视觉组件、渲染）在后台队列中单线程运行，用户可随时查看进度
- 单用户访问，无需登录/权限控制

### 1.1 非目标（v1 不做）

- 多用户协同 / 权限隔离
- Windows 平台支持（仅 Linux/macOS）
- 移动端适配（最小窗口宽度 ≥ 1280px）
- 多浏览器 tab 同时编辑同一项目的实时协同（仅靠 ETag 防覆盖）
- 在 UI 内编辑 Component.tsx（**只读**，如需修改请用外部 IDE 改 `build/{slug}/src/blocks/...`）
- 拖拽排序块（用户在 visuals.md 中手动调整顺序）
- 在外部编辑器打开（不集成 `code --goto`）
- 任务历史搜索/过滤（保留最近 50 条按时间倒序即可）
- 配置文件加密（v1 直接明文落盘，文档中明确提示风险）

### 1.2 v1.5 计划（占位，本期不实现）

- 音频 lineTimings 时间轴可视化（点击跳转到 narration.md 对应行）

---

## 2. 技术栈

| 层 | 技术 | 版本约束 |
|---|---|---|
| 前端框架 | Vue 3 + Vite + TypeScript | vue `^3.4`, vite `^5.0` |
| 前端 UI 组件库 | Naive UI | `^2.38` |
| 前端状态管理 | Pinia | `^2.1` |
| 前端路由 | Vue Router | `^4.3` |
| 代码编辑器 | CodeMirror 6 | `@codemirror/*` `^6.x` |
| 后端框架 | Node.js + Hono | hono `^4.5`，node `>=20` |
| 后端 HTTP 适配器 | `@hono/node-server` | `^1.12` |
| 静态文件中间件 | `@hono/node-server/serve-static` | 同上 |
| 后端与 CLI 集成 | 直接 import 现有 `src/cli/*.ts` 模块（不走子进程） | — |
| 实时通信 | SSE（Server-Sent Events） | — |
| 视频帧预览 | 服务端调用 Remotion `renderStill` API | `@remotion/renderer ^4.0.380`（与现有一致） |

> 依赖版本一律使用 caret 锁主版本号；执行 `npm install` 之后必须 commit `package-lock.json`。

---

## 3. 项目结构约定

Web 后端扫描 `<repo>/project/` 目录，每个**直接子目录**视为一个项目：

```
project/
└── microgpt/                          ← 项目目录名即项目 ID
    ├── project.json                   ← 项目入口（必须存在）
    ├── meta.md                        ← 项目元信息（YAML frontmatter 风格）
    ├── visuals.md                     ← 视觉元素文件（指令 + 视觉描述，#Bxx 必填）
    ├── narration.md                   ← 语音文件（旁白行，块 ID 与 visuals.md 一一对应）
    ├── assets/                        ← 项目级资源（图片，仅顶层文件）
    ├── voice/                         ← 参考语音目录（首次上传时由后端自动创建）
    │   └── ref.wav
    ├── build/                         ← ⚠️ 必须位于项目目录内（见 §3.3）
    │   └── {slug}/                    ← 每次 compile 产出目录
    │       ├── script.json            ← 编译后 IR
    │       ├── _snapshot/             ← compile/build 启动时复制的源文件快照
    │       │   ├── meta.md
    │       │   ├── visuals.md
    │       │   └── narration.md
    │       ├── public/
    │       │   ├── audio/{id}.wav     ← TTS 输出（block.audio.wavPath）
    │       │   └── images/{id}.png    ← 图片模式产物（block.visual.imagePath）
    │       ├── src/blocks/{id}/
    │       │   └── Component.tsx      ← 两种模式都会生成此文件（block.visual.componentPath）
    │       │                          │  动画模式：Anthropic 生成的真实组件
    │       │                          │  图片模式：自动生成的 wrapper（仅 <Img/>）
    │       └── output/
    │           ├── partials/{id}.mp4  ← 每块 partial（block.render.partialPath）
    │           ├── final.mp4          ← concat 中间产物（不直接交付）
    │           └── final_normalized.mp4  ← ★ loudnorm 后的最终交付文件
    └── （缓存不在项目内；统一存放于配置 cache.dir，默认 ~/.autovideo/cache，CLI 与 Web 共用）
```

Web 服务额外维护一个**仓库级**目录（首次启动自动创建）：

```
.autovideo-web/
├── config.json                   ← UI 设置面板写入（API key、服务地址等，明文）
├── tasks.jsonl                   ← 任务历史（最近 50 条）
├── logs/{taskId}.log             ← 任务完整日志
└── remotion-bundle/              ← Remotion bundle 缓存
```

> ⚠️ `.autovideo-web/config.json` **包含明文 API Key**，必须加入 `.gitignore`；服务首次启动若检测到该文件未在 gitignore 中会打印警告。

### 3.1 project.json 布局约束（v1）

为了避免 UI 编辑的脚本和 CLI 实际编译的脚本不一致，v1 支持两种项目布局：

**新布局（split，默认）**：

```json
{
  "meta": "./meta.md",
  "blocks": [
    { "visual": "./visuals.md", "narration": "./narration.md" }
  ]
}
```

**旧布局（single，兼容旧项目）**：

```json
{
  "meta": "./meta.md",
  "blocks": ["./script.md"]
}
```

后端启动时校验：若 `project.json` 不属于上述两种布局（多 entry / 自定义路径）或 `meta` 不为 `"./meta.md"`，**项目页顶部显示红色横幅**：

> ⚠️ 此项目使用了非标准的 project.json 配置（多脚本/自定义路径）。Web UI v1 仅支持单 entry 的 split 布局（`visuals.md` + `narration.md`）或旧版单 `script.md` 布局。请在文件系统中调整后刷新；编辑/构建按钮在此期间禁用。

横幅状态下：
- meta.md / 脚本编辑器只读
- 任务触发按钮全部置灰
- 仅允许浏览历史 build 产物
- 提供「查看 project.json」链接（只读）

`/api/projects` 仍列出非标准项目，但带 `nonStandard: true` 字段，UI 在卡片上加角标。

### 3.2 历史文件兼容

- 项目目录中可能存在 `project2.json` / `script2.md` 等历史副本。后端不读取它们，UI 不展示。
- 资源管理 Tab 隐藏 `project*.json`、`script*.md`、`visuals*.md`、`narration*.md`、`meta.md`、`build/`、`cache/`、`voice/`，只展示 `assets/` 顶层文件。

### 3.3 build 目录硬约束

- `build/` **必须**位于 `project/{name}/` 内；`cache/` 不再按项目隔离——web 与 CLI 统一使用配置 `cache.dir`（默认 `~/.autovideo/cache`），全系统只有一份缓存
- taskRunner 调用任何 CLI stage 前都必须显式传 `outDir = path.join(projectDir, "build", currentSlug)`，**禁止依赖 `process.cwd()` 的相对解析**
- compile 模块即使保留默认行为（`resolve("build", slug)`），web 路径也由调用方覆盖
- 服务启动时若发现 `<repo>/build/` 目录存在（孤儿产物），日志 warn 一次，不删除

**currentSlug 一致性规则**：

- `currentSlug` 由 live `meta.md` 解析得出（不取目录 mtime 最大者）
- 任务**入队**时（`POST /api/tasks` 收到请求那刻）即根据 live meta.md 计算并写入 `task.outputSlug`，持久化到 `tasks.jsonl`
- 任务**运行**全程使用 `task.outputSlug`，期间用户即使改了 meta.md 的 slug 也不影响该任务输出位置
- 当用户 `PUT /api/projects/:name/meta` 提交新内容且 slug 字段变更时，后端检查任务队列：
  - 若有 `pending`/`running`/`cancelling` 任务的 `outputSlug` 与新 slug 不一致 → 返回 `409 Conflict { code: "ERR_SLUG_LOCKED", runningTaskId, currentSlug, newSlug }`
  - UI 弹框：「有任务正在使用 slug `xxx`，请等待任务结束或取消任务后再修改」
- 块状态判定（§4.2.1）使用 live `currentSlug`；新 slug 下没有 build 目录时，所有块状态都显示为「未生成」

### 3.4 项目名约束

- 创建项目时校验：`^[a-zA-Z0-9_-]{1,40}$`（拒绝中文/空格/点等）。
- 后端读写任何项目相关路径前都用 `path.resolve` 后校验 `startsWith(projectsRoot)`，防路径穿越。

---

## 4. 功能模块

### 4.1 项目列表页（Home）

**路由**: `/`

**功能**:
- 扫描 `project/` 目录，列出所有含 `project.json` 的子目录
- 每张卡片显示：项目名称、`title`（meta.md 读取，缺失显示项目名）、块数量、最新 build 时间、是否有 `final_normalized.mp4`、若 project.json 非标准则角标提示
- 卡片操作菜单：进入项目、删除项目（弹二次确认，整个目录删除，无保留选项）、清空缓存（删 `build/`；项目级 `cache/` 已废弃，缓存为全局共享）
- 空状态：无项目时显示「创建第一个项目」+「试用 Demo 项目」两个按钮
  - **首次启动 Demo**：点击后端从 `templates/starter/` 复制到 `project/demo/`，自动跳转 `/project/demo`；如果 `project/demo` 已存在则直接进入
- 错误状态：扫描失败时显示错误信息 + 「重试」按钮

**新建项目交互**:
- 模态框：项目名（实时校验）+ 可选 `title` + 可选 `slug`
- 后端 `cp -r templates/starter/* project/{name}/`，并把 `meta.md` 中的 `title` / `slug` 替换为输入值（缺省值保留模板原值）
- 创建成功后跳转 `/project/{name}`

---

### 4.2 项目页

**路由**: `/project/:name`

**布局**（三栏）:

```
┌─────────────────────────────────────────────────────────────────┐
│  顶部栏：项目名 / 面包屑 / 全局操作按钮 / 健康指示灯               │
├──────────┬──────────────────────────────────┬───────────────────┤
│          │                                  │                   │
│  侧边栏  │         主编辑区                  │   块详情面板       │
│  块列表  │ (meta.md / 脚本编辑器，见 §4.2.2)  │   (可折叠)        │
│          │                                  │                   │
├──────────┴──────────────────────────────────┴───────────────────┤
│  任务栏（底部，可展开/折叠）                                        │
└─────────────────────────────────────────────────────────────────┘
```

**顶部栏**包含：
- 项目名 + 面包屑（首页 / 项目名）
- 全局按钮：编译 / 全量构建 / 合并视频 / 预览成片（有 final_normalized.mp4 时启用，回退到 final.mp4）/ 下载成片
- 健康指示灯（hover tooltip 显示）：VoxCPM 服务状态、Anthropic key 是否配置、文生图服务是否配置、FFmpeg 是否可用，红色时点击展开诊断面板（调用 `src/cli/doctor.ts` 并合并 web 配置状态）
- ⚙ 设置按钮：打开全局设置面板（见 §13）

**全局通用交互**:
- 任意编辑器存在未保存改动时，切换 Tab / 切换块 / 关闭页面 (`beforeunload`) 弹出确认
- 所有 API 错误统一 toast；保存成功简短 toast（1.5s）
- 主题：跟随系统 light/dark；CodeMirror 主题随之切换
- 全局快捷键：`Ctrl+S` 保存当前编辑器、`Ctrl+1/2/3` 切换主编辑区 Tab、`Esc` 关闭块详情面板

#### 4.2.1 侧边栏 — 块列表

- 解析当前 `visuals.md`（块结构以 visuals.md 为准），列出所有块
- 每行显示：块 ID、标题、视觉模式标记（🎬 动画 / 🖼 图片）、状态图标三色徽标
- 点击块 → 在右侧块详情面板中打开（再次点击同一块或按 `Esc` 收起）
- 每行左侧有**多选框**，配合顶部「批量操作」按钮（见 §4.4 批量操作）
- 顶部「+ 新建块」按钮：在 visuals.md 末尾追加块模板，同时在 narration.md 末尾追加同 ID 的空旁白块（自动生成下一个 `B{NN}` ID，默认 `@visual: animation`）
- 解析失败 / 警告（重复 ID、缺失 ID）显示在侧边栏顶部，列表条目右侧带警告图标

**块状态判定**（**字段名严格对应 `src/types/script.ts` 中现有 IR**）:

| 图标 | 含义 | 判定规则（基于 `build/{currentSlug}/script.json`） |
|---|---|---|
| 🎙 audio | 音频就绪 | `block.audio?.wavPath` 存在 且 `path.join(buildDir, wavPath)` 文件存在 |
| 🎨 visual（动画模式） | 视觉就绪 | `block.visual?.componentPath` 存在 且 `path.join(buildDir, componentPath)` 文件存在 |
| 🖼 visual（图片模式） | 视觉就绪 | `block.visual?.imagePath`（**v1 新增字段**，见附录 A.5） 存在 且对应 PNG 存在；图片模式同时会写出 wrapper Component.tsx，因此 componentPath 也存在但状态以 imagePath 为准 |
| 🎬 rendered | 已渲染 | `block.render?.partialPath` 存在 且对应 MP4 存在；script.json 没记录时降级到磁盘探测 `output/partials/{id}.mp4` |

`{currentSlug}` 定义：始终用**当前 meta.md 解析后的 slug**（不取目录里 mtime 最大者；旧 slug 残留的 build 视为孤儿目录，不影响状态判定）。

#### 4.2.2 主编辑区 — Tabs

**Tab 1: meta.md 编辑器**

- CodeMirror 6，YAML 语法高亮
- 已知字段：`title` / `aspect` / `theme` / `fps` / `slug` / `voiceRef`
- `Ctrl+S` 或保存按钮触发保存（PUT 接口 + ETag 协议见 §5.1）
- `voiceRef` 字段旁显示「上传语音」按钮：上传 `.wav` 时带当前 meta.md 的 `If-Match` → 后端写入 `project/{name}/voice/{原文件名}` → 自动改写 meta.md 的 `voiceRef` 为 `./voice/{原文件名}` → 编辑器内容刷新（保留光标位置）；若 ETag 冲突返回 409，UI 走同一套「覆盖 / 取消 / 查看 diff」交互
- 兼容：读取时 `voiceRef` 若是 `../../xxx.wav` 等绝对/越界路径不报错，照常显示；用户可自行改写

**Tab 2: 脚本编辑器**

split 布局（`visuals.md` + `narration.md`）下为**双子 Tab**：「视觉 visuals.md」/「语音 narration.md」；一次保存（`Ctrl+S`）同时 PUT 两文件（`{ visuals, narration }` + 联合 ETag，见 §5.1）。旧 single 布局（`script.md`）下为单个合并编辑器，PUT `{ content }`。

- CodeMirror 6 + 自定义 StreamLanguage（见附录 B 完整 token 表）
- 主要识别：
  - 块头 `^>>>\s+(.+?)\s+#(B\d+)\s*$` → 蓝色加粗
  - 指令 `^@(enter|exit|duration|visual):.*$` → 橙色（仅 visuals.md）
  - 分隔符 `^---\s+(visual|narration)\s+---$` → 绿色（仅旧 single 布局）
  - 加粗 `\*\*[^*]+\*\*`（narration.md 字幕高亮）
  - 资源路径 `\.\/assets\/[^\s)]+` → 下划线、悬停预览缩略图、点击复制（仅 visuals.md）
- `Ctrl+S` 保存（PUT 接口 + ETag）
- 编辑器内容变更时，侧边栏块列表实时更新（防抖 500ms 重新解析）
- 「+ 拖入资源」: 把资源管理面板里的图片拖入编辑器自动插入 `./assets/xxx.png`
- 解析错误（重复 ID、缺失 ID、两文件 ID 集合不一致）以 lint 风格在对应行显示，不阻止保存

**Tab 3: 资源管理（Assets）**

- 列出 `project/{name}/assets/` 下**仅顶层**文件（不递归子目录；如需子目录用户在文件系统手动管理）
- 文件名白名单：`^[a-zA-Z0-9_.-]+\.(png|jpe?g|gif|webp|svg)$`
- 图片以缩略图网格展示
- 上传：拖拽 / 点击；多文件并发；超过 10MB 单文件拒绝
- 删除：弹确认框（提示「正在被脚本引用」如果检测到 `./assets/xxx` 出现在 visuals.md）
- 单击 → 复制相对路径 `./assets/xxx.png` 到剪贴板（toast 反馈）；双击 → 大图预览模态框

---

### 4.3 块详情面板

点击侧边栏块条目后，右侧面板展开。**面板顶部有一个视觉模式切换器**：

- Radio：动画 (`animation`) / 图片 (`image`)
- 切换时：
  1. 调用 `PUT /api/projects/:name/blocks/:id/visual-mode { mode }`，请求头带当前脚本接口的 `If-Match`（split 布局为两文件联合 ETag）
  2. 后端在 visuals.md 该块块头下方插入或更新 `@visual: <mode>` 指令（缺省视为 `animation`；旧 single 布局则写回 script.md）
  3. 切换后该块的旧产物（Component.tsx / image.png / partial.mp4）状态可能与新模式不一致；UI 提示「模式已切换，建议重新生成视觉」

下方分为两个子 Tab：

#### Tab A: 脚本编辑

- 提取该块内容显示为**含 section 标记的合并块文本**（`--- visual ---` / `--- narration ---`，CodeMirror 6，同主编辑器语法高亮）；保存时提交合并文本（`PUT /blocks/:id { content }`），服务端拆写回 visuals.md 与 narration.md 两个文件（旧 single 布局直接回写 script.md）
- 提取/回写算法（**严格按此实现**，见附录 B 伪代码）：
  - 块区间定义：从匹配块头的那一行开始，直到下一个块头出现的前一行（含中间所有空行）；最后一个块到文件末尾
  - 保存时**禁止用户修改块头行的 ID**：若提交内容首行不再匹配同一 `#Bxx`，返回 422 错误，UI 提示「请勿在子编辑器中修改块 ID，请回到主脚本编辑器」
  - 块头标题可自由改；指令（含 `@visual:`）、visual/narration 区段可自由改
- 显示该块引用的图片资源（visual 段中 `./assets/` 路径），可点击预览
- **图片模式提示**：visual 段的文本会作为文生图的 prompt，narration 仍是 TTS 文本

#### Tab B: 产物预览

分为四个区域，**视觉区域根据模式分流**：

**① 音频（WAV）**
- 来源：`build/{currentSlug}/public/audio/{id}.wav`
- 展示：HTML5 `<audio>` 播放器，显示时长（来自 `script.json` 中 `block.audio.durationSec`）
- 不存在：灰色占位 + 「未生成」+ 直达「生成音频」按钮

**② 视觉（按模式分流）**

*动画模式*（`@visual: animation`，默认）:
- 来源：`build/{currentSlug}/src/blocks/{id}/Component.tsx`
- 上下分栏：
  - 上：CodeMirror 只读模式，TSX 高亮，右上角「复制全文」「显示路径」
  - 下：帧预览
    - 滑块上限与后端一致：优先 `block.timing.frames - 1`；无 timing 时用 `Math.round((block.audio?.durationSec ?? 5) * meta.fps) - 1` 兜底
    - 无音频时仍允许预览，UI 提示「未生成音频，时长按默认值估算」
    - 拖动滑块时仅显示帧号；松开（`mouseup`/`touchend`）后才发请求（300ms 防抖）
    - 渲染中显示 spinner，旧图保持不替换（防闪烁）；新图返回后切换
    - 同一块同时只允许一个 renderStill 进行中；新请求到来 abort 前一个未完成的请求
- 不存在：灰色占位 + 「生成视觉」按钮
- 任务运行时重试 UI 实时显示「第 2/3 轮重试，错误：xxx」

*图片模式*（`@visual: image`）:
- 来源：`build/{currentSlug}/public/images/{id}.png`（即 `block.visual.imagePath`，置于 Remotion `publicDir` 内以便 `staticFile()` 直接引用）
- 展示：直接显示该 PNG（contain 适应，点击查看原图模态框）
- 顶部信息：分辨率、文件大小、生成时间
- 操作：「在新标签页打开」「下载」「显示路径」
- 不存在：灰色占位 + 「生成图片」按钮
- 生成中：spinner + 进度文字
- 生成失败：错误信息 + 「重试」按钮

> 图片模式下渲染 partial 仍走 Remotion：`visuals` 模块在生成图片同时写出一个固定 wrapper `Component.tsx`，并把 PNG 放到 `public/images/{id}.png`，wrapper 通过 `staticFile("images/{id}.png")` 引用——对 `render` / `render-blocks.ts` / `VideoComposition` 完全透明，复用既有动态 import + 渲染链路。

**③ 分段视频（partial MP4）**
- 来源：`build/{currentSlug}/output/partials/{id}.mp4`（即 `block.render.partialPath`）
- HTML5 `<video controls preload="metadata">`，支持 Range（见 §10）
- 不存在：灰色占位 + 「渲染分段」按钮
- 注：partial 是未做 loudnorm 的中间产物，仅供单块预览；最终交付一律用 `final_normalized.mp4`

**④ 单块操作按钮**（见 §4.4，按视觉模式动态切换文案）

任务完成 SSE `done` 事件到达时，自动刷新对应区域（不需要用户手动刷新）。

---

### 4.4 任务触发

#### 单块操作（块详情面板内）

四个独立按钮，每个按钮带「⋯」展开菜单提供：
- 强制重跑（忽略缓存）：等价于 CLI 的 `--force`
- 清空该块的对应缓存：等价于 `POST /api/projects/:name/blocks/:id/cache/clear { kind }`，仅清掉这一类（audio / visual / partial）

| 按钮 | 视觉模式行为 | 对应 stage | 说明 |
|---|---|---|---|
| 生成音频 | 同 | `tts --block {id}` | 为该块生成 WAV |
| 生成视觉 | 动画→生成 Component.tsx；图片→生成 PNG（按钮文案随之切换为「生成图片」） | `visuals --block {id}` | 模块内部按 `block.visualMode` 分流 |
| 渲染分段 | 同 | `render --block {id}` | 渲染该块 partial MP4 |
| 重新编译 | 同 | `compile` | 整脚本，块面板/主编辑区各放一份 |

#### 批量块操作

侧边栏多选 ≥ 1 个块后，顶部出现批量操作工具条：

| 按钮 | 行为 |
|---|---|
| 批量生成音频 | `POST /api/tasks { stage: "tts", blockIds: [...] }` |
| 批量生成视觉 | 同上 stage `visuals`（模块按各块自身 visualMode 分流） |
| 批量渲染分段 | 同上 stage `render` |
| 批量清缓存 | 弹模态选 audio/visual/partial 的并集，调单块 cache 清理 API |
| 强制（开关） | 与上述按钮组合，置位时 `force: true` |
| 取消选择 | 清空多选 |

与单块按钮一样进入同一 FIFO 队列，不并发执行。

#### 全局操作（顶部栏）

| 按钮 | 行为 |
|---|---|
| 编译 | 等价 `compile` |
| 全量构建 | 等价 `build`：compile → tts → visuals → render（render 内部含 concat + loudnorm + qa） |
| 合并视频 | 等价 `render --concat-only`（**新增 stage**，见附录 A）：仅做 concat + loudnorm + qa，不重新渲染 partials |
| 预览成片 | 在模态框中播放 `final_normalized.mp4`（无 loudnorm 时回退 `final.mp4`） |
| 下载成片 | 触发浏览器下载（`Content-Disposition: attachment`） |

每个按钮在任务进行中时会显示在底部任务栏。同一项目同一 stage 已经在排队/运行时，按钮置灰防重复提交。

#### 任务取消

每个任务条目右侧有「取消」按钮：
- pending：直接从队列移除
- running：通过 `AbortController.abort()` 通知 CLI；CLI 收到后清理临时文件、抛 `AbortError`，taskRunner 在底层 promise settle 后把状态标 `cancelled`
- running 取消过程中 worker 仍被该任务占用，**不得启动下一个队列任务**，直到当前 `runningPromise` 实际 settle；若超过 5s 仍未 settle，任务状态标为 `cancelling`，UI 显示「正在强制停止」，队列暂停并保留后续 pending 任务，避免旧 Remotion/ffmpeg 进程与新任务并发写同一 build 目录
- 已完成的不显示取消

---

### 4.5 任务队列与进度

#### 设计原则

- 全局**单线程** FIFO 队列，同一时刻只运行一个任务
- 任务状态：`pending` → `running` → `completed` / `failed` / `cancelled`；取消超时但底层进程尚未退出时为 `cancelling`（队列暂停，不启动后续任务）
- 任务记录持久化到 `<repo>/.autovideo-web/tasks.jsonl`（每行一条 JSON），启动时加载最近 50 条

**源文件快照策略**（按 stage 区分，**不要全部快照**）：

| stage | 是否快照 source | 输入 |
|---|---|---|
| `compile` / `build` | ✅ 见下方流程 | 从快照 compile，用户编辑期写不到此次 build |
| `tts` / `visuals` / `render` / `merge` | ❌ 不快照 | 直接读 `build/{slug}/script.json`（已编译 IR）；用户必须先点「编译」才能让新内容生效 |

**compile/build 快照流程**（taskRunner 在调用 compile 之前执行）:

1. 解析 live `meta.md` 计算 `slug`，得到 `outDir = projectDir/build/{slug}`
2. 创建 `outDir/_snapshot/`，复制：
   - `project.json` → `_snapshot/project.json`
   - `meta.md` → `_snapshot/meta.md`
   - `visuals.md` / `narration.md` → `_snapshot/`（旧 single 布局为 `script.md`）
   - `assets/` 整目录 → `_snapshot/assets/`（如存在）
   - `voice/` 整目录 → `_snapshot/voice/`（如存在）。**必须复制**：`src/parser/meta.ts` 把 `voiceRef` 解析为相对 meta.md 目录的绝对路径，从快照编译时若 voice 目录缺失会报 `voiceRef file not found`
   - 任何 meta.md / visuals.md 中以 `./` 开头的相对路径引用的目录（v1 仅 `assets/` 和 `voice/`）都要纳入快照
3. 调用 compile：
   ```ts
   await compile({
     projectPath: path.join(outDir, "_snapshot/project.json"),  // ★ 从快照入口
     outDir,                                                     // 仍写到 outDir/
     onProgress, signal, ...config,
   });
   ```
4. compile 内部解析 `_snapshot/project.json` → `_snapshot/meta.md` / `_snapshot/visuals.md` / `_snapshot/narration.md` / `_snapshot/assets/` / `_snapshot/voice/`，输出 `outDir/script.json`（`voiceRef` 字段为快照内绝对路径，下游 tts 直接用即可）

> 用户编辑 visuals.md / narration.md 后，必须重新 `compile`（或 `build`），下游 stage 才看到新内容。这是有意为之的契约（§12-2 的延伸）：避免跑了一半的 IR 与 live source 漂移。tts/visuals/render 直接读 `outDir/script.json`，不需要也不要再拷贝 source。

#### 底部任务栏

- 常驻底部，可折叠
- 折叠态：显示当前运行任务摘要 + 进度条 + ETA（或「空闲」）
- 展开态：显示历史 + 当前任务，最多 20 条；「查看全部」打开模态框显示 50 条

**每条任务显示**:
- 任务类型（如「生成音频 B03」）
- 状态图标（pending / running / cancelling / completed / failed / cancelled）
- 进度条（百分比 + 当前步骤文字，如「正在渲染第 3/5 块」）
- ETA：基于已用时间和当前 percent 线性外推；percent < 5% 时显示「估算中…」
- 耗时（运行中实时计时 / 完成后显示总时长）
- 失败时：错误摘要 + 「查看完整日志」按钮（打开模态框，调用 `/api/tasks/:id/log`）

#### 实时推送

- 后端 SSE：`GET /api/tasks/:id/events` 推送进度事件
- 前端订阅当前页面相关项目的所有任务事件；切换项目时关闭旧 SSE
- SSE 断线自动重连（指数退避）：**重连前先 `GET /api/tasks/:id` 拉一次最新状态**（同步进度条和状态徽标），再重新订阅事件流接收新增事件；后端不需要为每个 task 维护 ring buffer
- 页面刷新后通过 `GET /api/tasks` 恢复列表，对运行中任务重新建立 SSE

#### 进度百分比计算

各 stage 内部 percent 计算：
- `compile`: 0 → 100 单步（解析完成即 100）
- `tts`: `已完成块数 / 目标块数 * 100`
- `visuals`: `已完成块数 / 目标块数 * 100`（重试中的块按 0.5 计）
- `render`: `已完成 partial 数 / 目标块数 * 90`，concat 完成 +5，loudnorm 完成 +3，qa 完成 +2
- `build` 聚合权重：compile 5% / tts 25% / visuals 35% / render 30% / 收尾 5%
- `merge`（concat-only）: concat 60 / loudnorm 30 / qa 10

---

## 5. API 设计

### 5.1 项目 API

```
GET    /api/projects                    → 项目列表 [{ name, title, blockCount, latestBuildAt, hasFinal }]
GET    /api/projects/:name              → 项目详情（含最新 build 状态、currentSlug、健康检查结果）
POST   /api/projects                    → 新建项目 { name, title?, slug? }；脚手架产出 meta.md + visuals.md + narration.md
DELETE /api/projects/:name              → 删除项目（rm -rf 整个目录，无保留选项）
POST   /api/projects/:name/cache/clear  → 清空 build/（全局共享缓存不按项目清除）

GET    /api/projects/:name/meta         → 读取 meta.md 内容；响应头 ETag: sha256:xxx
PUT    /api/projects/:name/meta         → 保存 meta.md { content }；请求头 If-Match
GET    /api/projects/:name/script       → 读取脚本；响应头 ETag（split 布局为 visuals.md + narration.md 两文件联合 hash）
                                           旧 single 布局返回 { mode: "single", content }
                                           新 split 布局返回 { mode: "split", visuals, narration }
PUT    /api/projects/:name/script       → 保存脚本；请求头 If-Match
                                           旧 single 布局 body { content }；新 split 布局 body { visuals, narration }
PUT    /api/projects/:name/blocks/:id   → 保存单块（来自块详情面板 Tab A）{ content }；请求头 If-Match（脚本接口 ETag）
                                           body 仍是含 `--- visual ---` / `--- narration ---` 标记的合并块文本；
                                           split 布局下服务端拆写 visuals.md / narration.md 两文件，single 布局回写 script.md，整体 ETag 仍校验
GET    /api/projects/:name/blocks       → 解析 visuals.md 返回 [{ id, title, line, visualMode, status, warnings }]
PUT    /api/projects/:name/blocks/:id/visual-mode  → 切换块视觉模式 { mode: "animation" | "image" }
                                                     请求头 If-Match（脚本接口 ETag）
                                                     后端在该块块头下方插入/更新 `@visual: <mode>` 指令并写回 visuals.md（single 布局写回 script.md）
POST   /api/projects/:name/blocks/:id/cache/clear  → 清空该块某类缓存 + 同时删除 build/{slug}/ 下对应实际产物
                                                     body: { kind: "audio" | "visual" | "partial" | "all" }
                                                     audio   → 删 cache/audio/{hash}.* + build/{slug}/public/audio/{id}.wav + script.json 中 block.audio
                                                     visual  → 删 cache/components/{hash}.* + cache/images/{hash}.* +
                                                               build/{slug}/src/blocks/{id}/Component.tsx + build/{slug}/public/images/{id}.png +
                                                               script.json 中 block.visual.componentPath / imagePath
                                                     partial → 删 cache/partials/{hash}.* + build/{slug}/output/partials/{id}.mp4 + script.json 中 block.render
                                                     all     → 上述全部 + script.json 中 block.timing
                                                     操作完成后块状态立即回退到「未生成」
```

**ETag/冲突协议**:
- `GET` 响应头始终包含 `ETag: sha256:<hex>`（基于文件原始字节；split 布局的脚本接口为两文件联合 hash）
- `PUT` 请求头必须带 `If-Match: sha256:<hex>`；不匹配返回 `409 Conflict`，body：旧 single 布局为 `{ currentContent, currentEtag }`，新 split 布局为 `{ currentVisuals, currentNarration, currentEtag }`
- 任何会改写 `meta.md` / `visuals.md` / `narration.md` 的非 PUT 接口也必须带对应文件的 `If-Match`（如上传语音会改 meta.md），冲突协议同上
- UI 收到 409 弹三选一：覆盖 / 取消 / 查看 diff

### 5.2 资源 API

```
GET    /api/projects/:name/assets       → 顶层资源文件列表 [{ name, size, mime }]
POST   /api/projects/:name/assets       → 上传图片（multipart/form-data, 字段名 file，可重复）
DELETE /api/projects/:name/assets/:file → 删除文件（:file 仅文件名，禁止 / 或 ..）
GET    /api/projects/:name/assets/:file → 文件内容（带 Content-Type）

POST   /api/projects/:name/voice        → 上传参考语音（multipart/form-data, 字段名 file；请求头 If-Match 为 meta.md ETag）
                                          后端写入 project/{name}/voice/，
                                          并同步更新 meta.md 的 voiceRef 字段；
                                          响应：{ voiceRef, metaContent, metaEtag }
```

### 5.3 产物 API

```
GET    /api/projects/:name/blocks/:id/audio     → WAV 文件流（支持 Range）
GET    /api/projects/:name/blocks/:id/component → Component.tsx 文本（动画模式产物，text/plain）
GET    /api/projects/:name/blocks/:id/image     → PNG（图片模式产物）
                                                  ?download=1 触发下载
GET    /api/projects/:name/blocks/:id/preview   → 渲染帧 PNG
                                                  ?frame=N（默认 0）
                                                  动画模式走 renderStill；图片模式直接返回 image.png
GET    /api/projects/:name/blocks/:id/video     → partial MP4 文件流（支持 Range）
GET    /api/projects/:name/output               → ★ final_normalized.mp4 文件流（支持 Range）
                                                  ?download=1 时返回 Content-Disposition: attachment
                                                  loudnorm 未运行时降级返回 final.mp4，并带响应头 X-Source: final.mp4
```

> 接口路径保持 `output` 不变；服务端按"final_normalized.mp4 优先 → final.mp4 兜底 → 404"顺序选择文件，对前端透明。

### 5.4 任务 API

```
GET    /api/tasks                       → 任务列表（最近 50 条）?project=xxx 过滤
GET    /api/tasks/:id                   → 任务详情
POST   /api/tasks                       → 创建任务（见下方 body 说明）
DELETE /api/tasks/:id                   → 取消任务（pending: 删除；running: abort；cancelling: 返回当前状态）
GET    /api/tasks/:id/events            → SSE 进度流；不支持 Last-Event-ID（重连前先 GET /api/tasks/:id 同步状态）
GET    /api/tasks/:id/log               → 完整日志文本（text/plain）
```

**POST /api/tasks body**:
```json
{
  "project": "microgpt",
  "stage": "compile" | "tts" | "visuals" | "render" | "build" | "merge",
  "blockIds": ["B03"],
  "force": false
}
```
- `blockIds` 仅 `tts/visuals/render` 接受；其余 stage 必须省略或返回 400
- `force` 透传到 CLI 的 `--force` 行为

**SSE 事件格式**（不带 `id:`，不支持 Last-Event-ID）:
```
event: progress
data: {"percent":60,"step":"渲染 B03 (3/5)","stage":"render","blockId":"B03"}

event: done
data: {"status":"completed","durationMs":12340}

event: error
data: {"message":"Component B03 编译失败：...","code":"ERR_VISUALS_VALIDATE","stage":"visuals"}

event: cancelled
data: {"durationMs":3210}
```

### 5.5 系统 API

```
GET    /api/health                      → { ok: true, version, projectsRoot }
GET    /api/doctor                      → 调用 src/cli/doctor.ts + 检查 web 配置
                                          {
                                            voxcpm: { status, message? },
                                            anthropic: { status, message? },
                                            imageGen: { status, message? },
                                            ffmpeg: { status, version? },
                                            remotion: { status, version }
                                          }
```

### 5.6 配置 API（设置面板）

```
GET    /api/config                      → 返回当前配置（API key 字段脱敏：仅返回 last4 + 是否已设置）
PUT    /api/config                      → 全量替换或部分更新 { anthropic?: {...}, imageGen?: {...}, voxcpm?: {...} }
                                          后端写入 .autovideo-web/config.json（明文）
                                          api key 字段为 null 表示清除；为 "" 表示未变更（前端不传 key 时使用）
POST   /api/config/test                 → 连通性测试 { service: "anthropic" | "imageGen" | "voxcpm" }
                                          后端用当前 / 临时配置发起一次最小请求，返回 { ok, latencyMs, message? }
```

配置写入即时生效；运行中任务读取的是任务启动时刻的配置快照（避免任务运行中配置被改导致状态混乱）。

---

## 6. 前端页面结构

```
web/                                  # 前端代码与现有 src/ 隔离
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router/
│   │   └── index.ts                  # / 和 /project/:name 两条路由
│   ├── stores/
│   │   ├── projectStore.ts           # 当前项目、块列表
│   │   └── taskStore.ts              # 任务队列状态、SSE 订阅
│   ├── pages/
│   │   ├── HomePage.vue              # 项目列表
│   │   └── ProjectPage.vue           # 项目主页（含三栏布局）
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TopBar.vue
│   │   │   ├── BlockSidebar.vue
│   │   │   └── TaskBar.vue
│   │   ├── editors/
│   │   │   ├── MetaEditor.vue        # CodeMirror，YAML 高亮
│   │   │   └── ScriptEditor.vue      # CodeMirror，自定义脚本语法高亮
│   │   ├── assets/
│   │   │   └── AssetManager.vue
│   │   ├── block/
│   │   │   ├── BlockPanel.vue
│   │   │   ├── BlockScriptEditor.vue
│   │   │   └── BlockOutputs.vue
│   │   └── task/
│   │       ├── TaskItem.vue
│   │       └── TaskProgress.vue
│   └── utils/
│       ├── scriptParser.ts           # 客户端解析 visuals.md（旧布局 script.md）块结构
│       ├── api.ts                    # fetch 封装（含 ETag 处理）
│       └── sse.ts                    # SSE 重连与事件订阅
├── index.html
├── vite.config.ts
└── package.json
```

构建产物输出到 `web/dist/`，由后端静态文件中间件服务。

---

## 7. 后端服务结构

```
server/
├── index.ts                          # Hono app 入口；启动 HTTP；挂静态；启动任务队列
├── routes/
│   ├── projects.ts
│   ├── assets.ts
│   ├── blocks.ts
│   ├── tasks.ts
│   └── system.ts                     # /api/health, /api/doctor
├── services/
│   ├── projectService.ts             # 文件系统读写、ETag 计算
│   ├── scriptEditor.ts               # 单块提取/回写算法（附录 B）
│   ├── taskQueue.ts                  # 单线程 FIFO 队列、持久化 tasks.jsonl
│   ├── taskRunner.ts                 # 调用 compile/tts/visuals/render 模块；管理 AbortController；快照源文件
│   ├── frameRenderer.ts              # Remotion bundle 缓存 + renderStill
│   └── scriptParser.ts               # 解析 visuals.md → 块列表（服务端版；旧布局解析 script.md）
├── middleware/
│   ├── pathGuard.ts                  # 项目名/文件名白名单 & 路径穿越校验
│   └── range.ts                      # MP4/WAV Range 支持
└── types/
    └── api.ts                        # 请求/响应类型定义（与前端共享）
```

**Remotion bundle 缓存**:
- 服务启动时预先调用 `@remotion/bundler` 一次，产物缓存到 `<repo>/.autovideo-web/remotion-bundle/`
- 当 `build/{slug}/src/` 内容变化时（按目录 mtime 或 manifest hash）lazy 重 bundle
- 否则 `frameRenderer` 复用同一 bundle 实例
- bundle 调用**必须显式**传 `publicDir: path.join(buildDir, "public")`，与现有 `src/render/render-blocks.ts` 一致；否则 `staticFile("script.json")` / `staticFile("audio/...")` / `staticFile("images/...")` 解析不到

**路径守卫**:
- 任何接受 `:name`、`:file` 的路由先经过 `pathGuard` 中间件：白名单正则 + `path.resolve` + `startsWith` 校验，越界直接 400

**taskRunner 调用约束**（**硬约束**，对应 §3.3）:

```ts
// 任何 stage 调用都按此装配
const projectDir = path.join(projectsRoot, project);
const slug = await readCurrentSlug(projectDir);     // 解析 live meta.md（任务入队时确定）
const outDir = path.join(projectDir, "build", slug); // 永远显式传

// compile/build：先快照 → 再 compile（详见 §4.5 快照流程）
await snapshotSourceFiles(projectDir, outDir);   // 写入 outDir/_snapshot/
await compile({
  projectPath: path.join(outDir, "_snapshot/project.json"),  // 从快照入口
  outDir,
  onProgress, signal, ...config,
});

// tts/visuals/render/merge：直接读已编译 IR，不快照
await tts({
  scriptPath: path.join(outDir, "script.json"),
  onProgress, signal, ...config,
});
```

绝不允许 `cd` 到项目目录然后用相对路径，cwd 全程保持 `projectsRoot` 的父目录（仓库根）。

---

## 8. 帧预览实现细节

接口：`GET /api/projects/:name/blocks/:id/preview?frame=N`

后端流程：
1. 读取 `build/{currentSlug}/script.json` 获取 `block.visual.componentPath`、`block.timing`、`block.audio?.durationSec`、`meta.fps`、`meta.aspect`、`meta.width`、`meta.height`
2. 校验：componentPath 文件存在；frame 在 `[0, durationInFrames - 1]` 内（越界返回 422）
   - `durationInFrames` 优先取 `block.timing.frames`（render 阶段已计算）；若无 timing 则用 `Math.round((block.audio?.durationSec ?? 5) * meta.fps)` 兜底
3. 取 / 重建 Remotion bundle（见 §7），bundle 必须传 `publicDir: path.join(buildDir, "public")`，否则 `staticFile()` 解析不到 `script.json` / `audio/*` / `images/*`
4. 用 `selectComposition` 拿到 `Block` 组合（Root.tsx 已注册，参数 `blockId`），再调用 `renderStill`：
   ```ts
   const composition = await selectComposition({
     serveUrl: bundleLocation,
     id: 'Block',
     inputProps: { blockId: id },  // calculateMetadata 会按 script.json 推 durationInFrames
   });
   await renderStill({
     composition,                     // 已含 width/height/fps/durationInFrames
     serveUrl: bundleLocation,
     output: tmpFile,
     frame: N,                        // ★ 单块内偏移，不需要全局 startFrame
     inputProps: { blockId: id },
     imageFormat: 'png',
     scale: 1,
     timeoutInMilliseconds: 30000,
     cancelSignal: abortController.signal,
   });
   ```
5. 返回 PNG 文件流，`Cache-Control: no-store`

**前端触发时机**：滑块 `mouseup`/`touchend` 后才发请求；拖动过程仅更新本地帧号显示。

**加载态**：发起请求后图片区域显示 spinner，旧图保持显示直到新图返回（防闪烁）。

**并发控制**：每个块维护一个 `AbortController`，新请求到来时 `abort()` 上一次未完成的请求。前端用 `AbortSignal` 取消 fetch；后端检测到客户端断开时尽力中止 renderStill（需要 wrap 在 Promise.race + signal）。

**超时**：30 秒返回 504。

**前置条件不满足**：
- componentPath 不存在 → 404 `{ reason: "no_component" }`
- audio 不存在 → 仍可渲染（按 §8 步骤 2 兜底用 5 秒），UI 提示「未生成音频，时长按默认值估算」
- `script.json` 必须先 copy 到 `build/{slug}/public/script.json`（compile / preview 模块已经在做，taskRunner 调用 compile 时已写入；frameRenderer 不要重复写）

---

## 9. 数据流说明

### 编辑并重新生成单块的完整流程

```
用户编辑 visuals.md / narration.md 中 B03 的内容
    ↓ 保存（PUT /api/projects/:name/script，带 If-Match）
    ↓ 后端写回文件，返回新 ETag
用户手动点击「编译」按钮
    ↓ POST /api/tasks { project, stage: "compile" }
    ↓ 任务入队，SSE 推进度 → 完成
用户点击「生成音频 B03」按钮
    ↓ POST /api/tasks { project, stage: "tts", blockIds: ["B03"] }
    ↓ taskRunner 直接调 tts({ scriptPath: build/{slug}/script.json, blockIds, onProgress, signal })
    ↓ （注意：tts 不快照源文件；script.json 来自最近一次 compile）
    ↓ SSE 推送 progress → 前端进度条
    ↓ SSE 推送 done
前端块详情面板自动刷新音频区域
    ↓ GET /api/projects/:name/blocks/B03/audio → 播放新 WAV
```

### 更换参考语音的完整流程

```
用户在 meta.md 编辑器点击「上传语音」
    ↓ 选择本地 WAV
    ↓ POST /api/projects/:name/voice（multipart，带当前 meta.md If-Match）
    ↓ 后端写到 project/{name}/voice/{filename}.wav
    ↓ 后端读取 meta.md，把 voiceRef 改写为 ./voice/{filename}.wav，写回
    ↓ 响应 { voiceRef, metaContent, metaEtag }
前端 MetaEditor 用响应内容刷新（保留光标行/列）
```

---

## 10. 非功能性要求

| 项目 | 要求 |
|---|---|
| 运行平台 | Linux / macOS（Windows 不在 v1 范围） |
| 部署方式 | 前端 `npm run build` 产出 `web/dist/`，由后端 Hono 通过 `serveStatic` 同时服务（单进程） |
| 监听地址 | 默认 `127.0.0.1:3030`；可通过环境变量 `HOST`、`PORT` 配置；不绑定 0.0.0.0 |
| 项目根路径 | 默认 `<repo>/project/`，可通过环境变量 `PROJECTS_ROOT` 配置 |
| SPA fallback | 任何不以 `/api/` 开头且未命中静态文件的 GET 请求返回 `index.html` |
| CORS | 仅允许 `http://localhost:*` / `http://127.0.0.1:*`；本工具不应暴露公网 |
| 错误处理 | 任务失败保留完整错误栈；SSE `error` 事件 + `/api/tasks/:id/log` 暴露 |
| 大文件传输 | MP4 / WAV 通过 Range Request 流式响应 |
| 终稿文件 | 默认预览/下载 = `final_normalized.mp4`（loudnorm 后）；`final.mp4` 仅作为 concat 中间产物 |
| build 路径 | 所有 stage 的产出必须落在 `project/{name}/build/{slug}/`，taskRunner 负责传 outDir，不依赖 cwd |
| 编辑器保存 | ETag/If-Match 协议，冲突 409 |
| 日志 | 任务日志写入 `<repo>/.autovideo-web/logs/{taskId}.log`；任务 50 条之外的日志保留 7 天后清理 |
| 进程稳定性 | 任务运行抛出未捕获异常时只标记该任务 failed，不退出进程；SIGINT/SIGTERM 时拒收新任务、abort 当前任务、flush tasks.jsonl 后退出 |

---

## 11. 开发阶段划分

每个 Phase 列出**可验证的验收点**，agent 必须自检通过后才进入下一阶段。

### Phase 1 — 基础骨架
- 后端：Hono 服务，`/api/health`、`/api/projects`、`/api/projects/:name`、meta.md / 脚本（visuals.md + narration.md，兼容旧 script.md）的 GET/PUT（含 ETag）
- 前端：Vue 路由、HomePage 渲染项目卡片、ProjectPage 三栏布局、MetaEditor（YAML 高亮 + 保存）

**验收**:
1. `curl http://127.0.0.1:3030/api/health` 返回 `{ ok: true }`
2. `curl /api/projects` 返回 `[{ name: "microgpt", ... }]`
3. 浏览器访问 `/project/microgpt`，meta.md 内容显示，修改并保存后磁盘文件更新
4. 两个浏览器 tab 同时编辑 meta，后保存的一方收到 409

### Phase 2 — 脚本编辑与资源管理
- ScriptEditor 自定义高亮 + 保存
- BlockSidebar 实时解析 + 状态图标（基于 Phase 1 现有的 build/{slug}/script.json）
- BlockPanel Tab A：单块脚本提取/回写
- AssetManager：上传 / 列出 / 删除 / 复制路径

**验收**:
1. 修改 visuals.md / narration.md 后保存，文件按预期更新；侧边栏 500ms 内反映新块
2. 在 Tab A 修改 B03，保存后仅 B03 对应的视觉/旁白内容被替换（服务端拆写两文件）
3. 在 Tab A 篡改 B03 块头 ID 保存，返回 422
4. 上传 PNG 后在 assets 目录可见；删除有引用的资源时弹警告

### Phase 3 — 任务队列与进度
- 改造 CLI（按附录 A）：增加 `onProgress` / `signal` / `force`
- 后端 taskQueue / taskRunner / SSE / 任务持久化
- 单块 tts / visuals / render / compile 触发；底部任务栏

**验收**:
1. 提交 `tts B03` 任务，SSE 至少收到一个 `progress` 和一个 `done`
2. 任务运行中提交第二个任务，处于 pending 直到第一个完成
3. 取消 running 任务，CLI 实际中止，临时文件清理
4. 杀掉 server 重启，`/api/tasks` 仍能返回历史任务

### Phase 4 — 产物预览
- WAV / partial MP4 播放器（含 Range）
- Component.tsx 只读查看
- 帧预览（renderStill + bundle 缓存）
- final_normalized.mp4 预览模态框（兜底 final.mp4）

**验收**:
1. 播放 partial MP4 时 seek 正常（Range 正常工作）
2. 帧预览滑块拖动→松开后 5 秒内出图
3. 同一块连续切换帧，前一次未完成的请求被 abort
4. 缺音频/组件时显示明确占位

### Phase 5 — 视觉模式 / 文生图 / 设置面板
- `compile.ts` 解析 `@visual:` 指令并写入 `script.json`
- `src/ai/image-gen.ts` 新模块；`visuals.ts` 按模式分流
- 块详情面板视觉模式切换器；图片产物展示
- 设置面板（Anthropic / 文生图 / VoxCPM）；`config.json` 落盘 + 脱敏返回 + 测试连通性
- 单块缓存清理；批量块操作

**验收**:
1. 在块详情切换某块为图片模式，visuals.md 中出现 `@visual: image`
2. 配置文生图 baseURL/key 后点击「生成图片」，产物 PNG 出现在 `build/{slug}/public/images/Bxx.png`，同时 `build/{slug}/src/blocks/Bxx/Component.tsx` 是 staticFile 引用该 PNG 的 wrapper
3. 该块「渲染分段」走 Remotion 后 partial MP4 全程显示该图片
4. `GET /api/config` 返回的 apiKey 字段为 `{ set: true, last4: "..." }`，不外露明文
5. 选中 3 个块批量「生成音频」，任务依次串行执行不并发
6. 单块清缓存后该块状态回退到「未生成」

### Phase 6 — 全量构建与部署收尾
- 全量构建按钮（build）/ 合并视频按钮（merge / concat-only）
- 新建项目 / 删除项目 / 清空缓存 / Demo 项目一键创建
- 健康指示灯（doctor 集成 + 配置状态）
- 错误展示 / 日志查看模态框
- 部署：`npm run build:web && npm run start:web`；提供 systemd / launchd 单元

**验收**:
1. 全量构建一个全新项目（含动画块和图片块各至少 1 个），最终产出 `final_normalized.mp4`
2. doctor 故意把 ANTHROPIC_API_KEY 清空且 UI 配置也清空，UI 顶部红灯并显示「未配置 Anthropic Key」
3. 任务失败后能从日志模态框看到完整错误堆栈
4. `npm run build:web && npm run start:web` 后 `127.0.0.1:3030` 可访问
5. 删除项目后 `project/{name}` 目录消失；任务历史中相关条目保留但状态视为孤儿（不影响列表加载）

---

## 12. 已决策记录

| # | 问题 | 决策 |
|---|---|---|
| 1 | 帧预览触发时机 | 松开滑块（`mouseup`）才触发 renderStill |
| 2 | compile 时机 | 手动：必须先保存 script.md，再点「编译」按钮，才能触发 tts/visuals/render |
| 3 | 多 script 文件 | 仅支持单 `script.md`；其他 `script*.md` / `project*.json` 视为普通文件不做特殊处理 |
| 4 | voiceRef 更换 | 上传 → 复制到 `project/{name}/voice/` → 同步改写 meta.md `voiceRef` 字段 |
| 5 | CLI 改造 | 必须去除 `compile` 中的 `process.chdir`；所有 stage 增加 `onProgress` / `signal` / `force`（附录 A） |
| 6 | merge 阶段 | 新增 `render --concat-only` 模式：仅 concat + loudnorm + qa，不重渲染 partials |
| 7 | 块 ID 修改 | 块详情 Tab A 禁止修改块头 `#Bxx`；修改请回主脚本编辑器 |
| 8 | 任务取消 | `DELETE /api/tasks/:id`；CLI 收 `AbortSignal` 中止；正常退出后状态 `cancelled`；取消超时但底层仍未退出时状态 `cancelling` 且队列暂停 |
| 9 | 文件冲突 | ETag/If-Match 协议；冲突 409 + 当前内容；UI 三选一弹框 |
| 10 | 项目名字符集 | `^[a-zA-Z0-9_-]{1,40}$` |
| 11 | 平台支持 | 仅 Linux/macOS；Windows v1 不支持 |
| 12 | Component.tsx 编辑 | UI 内只读；如需修改请用外部 IDE 改 `build/{slug}/src/blocks/...` |
| 13 | 拖拽排序块 | 不支持；用户在 script.md 中手动调整 |
| 14 | currentSlug | 始终用当前 meta.md 解析后的 slug，不取 mtime 最新；任务入队时锁定 `task.outputSlug`，运行期固定；slug 变更与未结束任务冲突返回 409 ERR_SLUG_LOCKED |
| 15 | 任务运行中编辑 | 允许编辑；**仅 compile/build** 启动时快照 source 到 `build/{slug}/_snapshot/` 并从快照 compile；tts/visuals/render/merge 不快照，直接读 `build/{slug}/script.json` |
| 16 | Remotion bundle | 启动预 bundle，缓存到 `.autovideo-web/remotion-bundle/`，按 src 内容变化 lazy 重建 |
| 17 | 块视觉模式 | 块可选 `animation` / `image`；通过 `@visual:` 指令存于 script.md；`visuals` 模块按模式分流 |
| 18 | 文生图调用方 | 远端 OpenAI 兼容接口（base URL + key + model + size），通过 UI 设置面板配置 |
| 19 | 配置存储 | UI 设置面板写入 `.autovideo-web/config.json`，明文（v1 不加密，但写入 .gitignore 警告） |
| 20 | 任务运行配置快照 | 任务启动时读取当时配置快照，运行中改配置不影响进行中任务 |
| 21 | 批量块操作 | 侧边栏多选 + 批量按钮，复用 `tts/visuals/render` stage 的 blockIds 形参，不并发 |
| 22 | 单块缓存清理 | `POST /api/projects/:name/blocks/:id/cache/clear { kind }`，独立于项目级清缓存 |
| 23 | 首次启动 Demo | 空项目时提供「试用 Demo」按钮，从 `templates/starter/` 复制为 `project/demo/` |
| 24 | 外部编辑器集成 | 不做（用户自行用 IDE 打开 `build/{slug}/src/blocks/...`） |
| 25 | 任务历史搜索/过滤 | 不做（仅按时间倒序展示最近 50 条） |
| 26 | lineTimings 可视化 | v1.5 范围，v1 不做 |
| 27 | 部署脚本 | 提供 `npm run build:web` / `start:web` / `dev:web`；附 systemd 与 launchd 单元样例 |
| 28 | project.json 形态 | v1 强制 `{ "meta":"./meta.md", "blocks":["./script.md"] }`；不符合时项目页只读 + 红色横幅 |
| 29 | 终稿文件名 | `final_normalized.mp4`（loudnorm 输出）为默认预览/下载；`final.mp4` 仅是中间产物 |
| 30 | IR 字段 | 严格沿用现有 `block.audio.wavPath` / `block.visual.componentPath` / `block.render.partialPath`，不另起字段名 |
| 31 | build 路径 | 必须 `project/{name}/build/{slug}/`，taskRunner 显式传 outDir，禁止依赖 cwd |
| 32 | 任务快照 | 仅 compile/build 快照源文件；tts/visuals/render 直读 script.json，编辑后必须先 compile |
| 33 | SSE 续传 | 不实现 Last-Event-ID；重连前先 GET /api/tasks/:id 拉状态再订阅新事件 |
| 34 | merge 术语 | UI 显示「合并视频」；Web stage = `merge`；CLI flag = `render --concat-only`；模块函数 = `concatPartials + applyLoudnorm + runQA` |
| 35 | 包结构 | 不引入 npm workspaces；root + web/ 双 package + 各自 lockfile；`tsconfig.server.json` 编译 server/ + src 依赖到 `dist/server/`，启动入口为 `dist/server/server/index.js` |
| 36 | 取消信号 | 必须传到 fetch/SDK/Remotion `cancelSignal`/ffmpeg `child.kill`；taskRunner 5s 后进入 `cancelling` 并暂停队列，直到实际 settle 才释放 worker |
| 37 | Anthropic 配置来源 | web 模式不读 `~/.claude/settings.json`，统一走 UI 设置 + env；首次启动若检测到 ~/.claude/settings.json 有 key 而 web/env 都没有，UI 弹一次性导入提示 |
| 38 | 单块清缓存范围 | 同时清 cache/* 和 build/{slug}/ 下对应实际产物 + 回写 script.json 字段，确保块状态立即回退到「未生成」 |
| 39 | 快照范围 | compile/build 快照必须包含 voice/ 目录（voiceRef 解析依赖），未来若引入新的 meta-relative 资源也需纳入 |

> 注：输入格式已重构为 `visuals.md` + `narration.md` 双文件（按 `#Bxx` ID 一一对应），上表 #2 / #3 / #13 / #17 / #28 中的「单 `script.md`」为当时的历史决策记录；现行布局约束与 API 契约以 §3.1 / §5.1 为准，旧单文件格式继续兼容，详见 ../guidelines/AUTHORING.md。

---

## 13. 设置与配置面板

顶部栏 ⚙ 按钮打开模态对话框，顶端 Tab 切换三个分组。

### 13.1 Anthropic（visuals 动画模式）

| 字段 | 默认 | 说明 |
|---|---|---|
| API Key | 空 | 必填，提交后端后存 `config.json` 明文 |
| Base URL | `https://api.anthropic.com` | 自部署/代理可改 |
| Model | `claude-sonnet-4-6`（与 `src/config/defaults.ts` 一致） | 用户可改成 `claude-opus-4-7` 等 |
| Concurrency | 4 | p-limit 上限 |

「测试连通性」按钮：调 `POST /api/config/test { service: "anthropic" }`；后端发一个 1-token 的 ping 请求并返回结果。

### 13.2 文生图（visuals 图片模式）

支持 OpenAI 兼容协议（任何 `POST {baseURL}/v1/images/generations` 的服务都可用）。

| 字段 | 默认 | 说明 |
|---|---|---|
| Base URL | 空 | 例 `https://api.openai.com` 或自部署 |
| API Key | 空 | 明文落盘 |
| Model | `gpt-image-1` | 透传 model 参数 |
| Size | `1920x1080` | 与 `meta.aspect` 对应（16:9 用 1920x1080，9:16 用 1080x1920） |
| Timeout | `120000` | 毫秒 |
| Concurrency | `2` | p-limit 上限 |

「测试连通性」: 用极小 prompt 触发一次生成（也可降级为 GET `{baseURL}/v1/models`，看用户配置的服务支持哪种）。

### 13.3 VoxCPM（TTS）

| 字段 | 默认 | 说明 |
|---|---|---|
| Endpoint | `http://127.0.0.1:8000` | 与 `src/config/defaults.ts` 一致 |
| Auto Start | true | 服务未启动时是否尝试拉起 |
| Concurrency | 2 | p-limit 上限 |

### 13.4 配置加载与优先级

服务启动时读取 `.autovideo-web/config.json`；任意字段缺失则回退到环境变量（兼容 CLI 旧用法）：

| 字段 | 环境变量回退 |
|---|---|
| anthropic.apiKey | `ANTHROPIC_API_KEY` |
| anthropic.baseURL | `ANTHROPIC_BASE_URL` |
| imageGen.apiKey | `IMAGE_GEN_API_KEY` |
| imageGen.baseURL | `IMAGE_GEN_BASE_URL` |
| voxcpm.endpoint | `VOXCPM_ENDPOINT` |

UI 设置面板优先级最高：UI 写入后立即覆盖；UI 显式置 null 才读环境变量。

**与 CLI `~/.claude/settings.json` 的关系**：

- 现有 `src/ai/component-gen.ts` 在 CLI 模式下会自动读 `~/.claude/settings.json` 的 `apiKey` / `baseURL`
- web 模式**不读** `~/.claude/settings.json`，仅按上表的"UI > env"优先级取配置；理由是 web 把配置统一收口到设置面板，避免两套来源相互覆盖
- 因此 Web 调用链必须把已解析的 `apiKey` / `baseURL` / `model` 显式传入 `visuals` → `generateComponent`；`generateComponent` 需要支持“显式凭据模式”，该模式下不得调用 `resolveClaudeCredentials()` 或读取 `~/.claude/settings.json`
- 服务首次启动时若同时满足：①`.autovideo-web/config.json` 中 `anthropic.apiKey` 为空 ②环境变量 `ANTHROPIC_API_KEY` 为空 ③`~/.claude/settings.json` 存在且包含可用 apiKey —— 则在日志和 UI 顶部 banner 显示「检测到 ~/.claude/settings.json 配置，是否一键导入到 Web 设置？」，用户点确认后由后端读该文件 → 写入 `config.json`
- 该提示一次性，用户点忽略后下次启动不再弹

### 13.5 配置文件结构

```json
{
  "version": 1,
  "anthropic": {
    "apiKey": "sk-ant-...",
    "baseURL": "https://api.anthropic.com",
    "model": "claude-sonnet-4-6",
    "concurrency": 4
  },
  "imageGen": {
    "baseURL": "https://api.openai.com",
    "apiKey": "sk-...",
    "model": "gpt-image-1",
    "size": "1920x1080",
    "timeoutMs": 120000,
    "concurrency": 2
  },
  "voxcpm": {
    "endpoint": "http://127.0.0.1:8000",
    "autoStart": true,
    "concurrency": 2
  }
}
```

`GET /api/config` 返回时所有 `apiKey` 字段替换为 `{ set: true, last4: "abcd" }` 或 `{ set: false }`，不外露明文。

---

## 14. 部署脚本（v1 必交付）

### 14.1 包结构与 tsconfig

仓库采用**双 package** 结构（不引入 npm workspaces，保持简单）：

```
<repo>/
├── package.json                 ← 既有，再加 server 相关 deps + scripts
├── package-lock.json
├── tsconfig.json                ← 既有，保持不动（不 include server/，避免 npm run build 误编译 server）
├── tsconfig.server.json         ← ★ 新增，专编 server + src 依赖 → dist/server/
├── server/                      ← 后端源码
├── web/
│   ├── package.json             ← 独立 package（前端依赖）
│   ├── package-lock.json        ← 独立 lockfile
│   ├── vite.config.ts
│   └── src/
└── dist/
    └── server/                  ← tsc 输出；入口为 server/index.js
        ├── server/index.js
        └── src/...
```

`tsconfig.server.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/server",
    "rootDir": "."
  },
  "include": ["server/**/*.ts", "src/**/*.ts", "schemas/**/*.json"],
  "exclude": ["node_modules", "dist", "web", "remotion"]
}
```

`package.json`（根）新增 scripts：
```json
{
  "scripts": {
    "build:server": "tsc -p tsconfig.server.json",
    "build:client": "cd web && npm ci && npm run build",
    "build:web": "npm run build:server && npm run build:client",
    "start:web": "node dist/server/server/index.js",
    "dev:web": "concurrently -k \"tsx server/index.ts\" \"cd web && vite\""
  }
}
```

- `dev:web`：server 通过 tsx 直跑（监听 `:3030`），前端走 vite dev server（`:5173`），server 在 `NODE_ENV=development` 时把非 `/api/*` 请求反代到 `:5173`
- `build:web`：先编译 server 到 `dist/server/`，再 `cd web && npm ci && npm run build` 输出到 `web/dist/`
- `start:web`：生产启动入口是 `dist/server/server/index.js`（因为 `rootDir: "."` 会保留 `server/` 目录层级），server 通过 serveStatic 托管 `web/dist/`，SPA fallback 到 `web/dist/index.html`

### 14.2 systemd 单元（Linux 部署样例）

放仓库 `deploy/autovideo-web.service`：

```ini
[Unit]
Description=AutoVideo Web UI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/AutoVideo
EnvironmentFile=-/opt/AutoVideo/.env
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3030
ExecStart=/usr/bin/node dist/server/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

文档 `deploy/README.md` 简要说明：

1. `npm ci && npm run build:web`
2. `cp deploy/autovideo-web.service ~/.config/systemd/user/`
3. `systemctl --user enable --now autovideo-web`
4. 反向代理（如需远程访问）通过 nginx/Caddy，并自行加 Basic Auth + TLS

### 14.3 macOS 部署

文档 `deploy/README.md` 给出 launchd plist 样例（`deploy/com.autovideo.web.plist`），路径与上述一致。Linux 用户优先 systemd，macOS 用户优先 launchd。

---

## 附录 A — CLI 模块改造清单（必须先完成）

所有 stage 模块在 web 化前必须完成以下改造：

### A.1 通用：增加形参

每个 `*Options` 类型新增：
```ts
onProgress?: (event: ProgressEvent) => void;
signal?: AbortSignal;
// force 已存在的保留
```

`ProgressEvent` 定义见附录 B。

模块内部在以下时机调用 `onProgress`：
- 阶段开始（percent: 0, step: '开始 xxx'）
- 每个块开始/结束（percent: blockIndex/total*100, step: '处理 Bxx (i/n)', blockId）
- 子阶段切换（render 内部 concat/loudnorm/qa）
- 阶段结束（percent: 100）

模块内部所有 `await` 处必须周期性检查 `signal.aborted`，抛出 `AbortError` 终止流程并清理临时文件。

### A.2 `compile.ts`：去 chdir

定位 `process.chdir(...)` 调用，改为通过返回值或参数传递 `outDir`，由调用方自行决定是否切换 cwd。Web 模式下永远不切换 cwd。

下游（tts/visuals/render）已通过 `scriptPath` 形参定位，去 chdir 后下游不受影响——验证现有测试用例仍通过。

### A.3 新增 `render --concat-only` 模式

`RenderOptions` 增加 `concatOnly?: boolean`。当 true 时跳过 `renderBlocks`，直接执行：
1. 校验所有 partial 文件存在
2. `concatPartials` → final.mp4
3. `applyLoudnorm` → final_normalized.mp4
4. `runQA`

任一 partial 缺失：抛 `RenderError("缺少 partial: Bxx")`。

### A.4 错误信息

CLI 抛错时附带稳定的 `code` 字段（如 `ERR_VOXCPM_OFFLINE` / `ERR_ANTHROPIC_KEY_MISSING` / `ERR_IMAGE_GEN_KEY_MISSING` / `ERR_FFMPEG_NOT_FOUND`），便于前端做提示映射。

### A.4.1 取消（abort）契约

仅靠"周期性检查 `signal.aborted`"不足以让 Remotion / ffmpeg / HTTP 请求立即停止。每个 stage 必须按以下方式正确传播取消信号：

| 子操作 | 实现要求 |
|---|---|
| `fetch` / Anthropic SDK 调用 | 必须传 `signal`；底层 fetch 收到 abort 会立即 reject |
| VoxCPM HTTP 调用 | 同上；`VoxcpmClient` 需要在 `speak()` 接受 `signal` 参数 |
| Remotion `renderStill` / `renderMedia` | 传 `cancelSignal`（Remotion 4.x 原生支持），并设 `timeoutInMilliseconds` 兜底 |
| ffmpeg 子进程 | `spawn` 后保存 `child` 引用；signal abort 时 `child.kill('SIGTERM')`，2s 后未退则 `SIGKILL` |
| voxcpm-server 自启动子进程 | 任务取消不杀 server 进程（共享资源）；只 abort 当前请求 |
| 临时文件 | abort 时 try/finally 清理 `_tmp_*` 中间文件，不留垃圾 |

`taskRunner` 取消流程：
1. 用户 `DELETE /api/tasks/:id`
2. taskRunner 调 `controller.abort()`
3. 等待 `runningPromise` settle；settle 前 worker 不释放，队列不得启动下一个任务
4. 若 5s 后仍未 settle：状态改为 `cancelling`，emit SSE `progress`（step: "正在强制停止..."），队列暂停并持续等待
5. `runningPromise` 最终 settle 后：标记任务 `cancelled`，emit SSE `cancelled` 事件，释放 worker 并恢复队列

### A.4.2 SSE 退出顺序

每个任务结束时，taskRunner 必须按 `progress(100) → done|error|cancelled → close` 顺序发事件并关闭 SSE 连接。前端收到终态事件后即视为完成，不再依赖连接关闭。

### A.5 图片模式：完整改动清单

为支持图片模式，**以下文件都需要同步改**，不能只改 `visuals.ts`：

#### A.5.1 `src/types/script.ts`

```ts
export type VisualMode = 'animation' | 'image';

export interface Block {
  id: string;
  // ...既有字段
  visualMode: VisualMode;            // 新增，缺省 'animation'
  visual: {
    description: string;
    componentPath?: string;          // 动画模式生成
    imagePath?: string;              // ★ 新增，图片模式生成（POSIX 相对 build dir）
  };
  audio?: { wavPath: string; durationSec: number; lineTimings: ... };
  render?: { partialPath: string; ... };
}
```

类型守卫调整：
- `assertVisualsReady`: 动画块要 `visual.componentPath`；图片块要 `visual.imagePath`
- `assertRenderInputReady`: 同上
- `assertCompiledScript`: 不再做 visualMode 检查，只确认 `description` 与 `id`

#### A.5.2 `schemas/script.schema.json`

补 `visualMode` enum、`visual.imagePath` 可选字段。

#### A.5.3 `src/cli/compile.ts`

解析 `@visual: animation|image` 指令写入 `block.visualMode`。值非法时报警告并降级为 `animation`，不阻塞编译。

#### A.5.4 `src/ai/image-gen.ts`（新增）

**输入**:
- `prompt`：来自该块的视觉描述文本（visuals.md 块体）
- `size`：按 `meta.aspect` 映射（16:9→1920×1080；9:16→1080×1920；1:1→1024×1024；其他→取最接近的标准尺寸并 warn）
- 配置：`{ baseURL, apiKey, model, timeoutMs }` + `signal`

**协议**: OpenAI 兼容 `POST {baseURL}/v1/images/generations`，请求体：
```json
{ "model": "...", "prompt": "...", "size": "1920x1080", "n": 1, "response_format": "b64_json" }
```
响应预期 `data[0].b64_json` 或 `data[0].url`（两种都要支持，url 时再 fetch 一次）。

**产物落盘**:
1. PNG 写到 `build/{slug}/public/images/{id}.png`（位于 Remotion `publicDir` 内）
2. wrapper Component.tsx 写到 `build/{slug}/src/blocks/{id}/Component.tsx`，模板：
   ```tsx
   import React from "react";
   import { AbsoluteFill, Img, staticFile } from "remotion";

   interface AnimationProps {
     frame: number; durationInFrames: number; width: number; height: number;
     subtitleSafeBottom: number; theme: any; fps: number;
   }

   const Component: React.FC<AnimationProps> = () => (
     <AbsoluteFill style={{ backgroundColor: "#000" }}>
       <Img
         src={staticFile("images/{id}.png")}
         style={{ width: "100%", height: "100%", objectFit: "contain" }}
       />
     </AbsoluteFill>
   );

   export default Component;
   ```
   - 签名 `React.FC<AnimationProps>` + `export default Component` 与现有 Anthropic 生成的组件保持一致，确保 `VideoComposition` 中现有 `dynamic import + default` 加载路径完全复用
   - 模板里的 `{id}` 在写入时替换为实际块 ID（如 `B03`）
3. IR 写入：`block.visual.imagePath = "public/images/{id}.png"`、`block.visual.componentPath = "src/blocks/{id}/Component.tsx"`（与动画模式同字段）

**bundle/render 影响**: 由于 PNG 在 `publicDir` 内，且 `src/render/render-blocks.ts` 已经显式传 `publicDir: path.join(buildDir, "public")`，`staticFile("images/{id}.png")` 解析正确；`render-blocks.ts` 与 `root-render.ts` 完全无需修改。Web 的 `frameRenderer` 也必须按相同方式传 publicDir（已在 §7 / §8 强调）。

**缓存**: `cacheKey = sha256(prompt + model + size + baseURL)`，命中则跳过 HTTP 调用直接复制旧 PNG 与 wrapper；`force` 模式忽略缓存。

**失败**: 抛 `ImageGenError(code, message, signal?)`，code 包括 `ERR_IMAGE_GEN_KEY_MISSING` / `ERR_IMAGE_GEN_TIMEOUT` / `ERR_IMAGE_GEN_HTTP_<status>` / `ERR_IMAGE_GEN_BAD_RESPONSE`。

**取消**: `fetch(..., { signal })` 透传；下载 url 形式的图片同样透传。

#### A.5.5 `src/cli/visuals.ts`

按 `block.visualMode` 分流：
```ts
for (const block of targetBlocks) {
  if (block.visualMode === 'image') {
    await generateImage(block, { config: imageGenConfig, signal, onProgress });
  } else {
    await generateAnimation(block, { config: anthropicConfig, signal, onProgress });
  }
}
```

#### A.5.6 `src/cache/store.ts`

新增 cache 类别 `images`，key schema 同 A.5.4。

#### A.5.7 `src/render/qa.ts`

QA 不需要变化（仍校验 `final_normalized.mp4`），但务必确认对纯图片 + 音频 partial 也能通过（应该可以，因为是标准 mp4）。

### A.6 `compile.ts` 解析 `@visual:` 指令

现有指令解析处增加 `@visual: animation|image`，缺省 `animation`，写入 `block.visualMode`。值非法时报警告但不阻塞编译。

### A.7 配置注入

CLI 模块不再直接读 `process.env`；改为通过 options 接收已解析好的配置：

```ts
ttsOptions.voxcpm = { endpoint, autoStart, concurrency };
visualsOptions.anthropic = { apiKey, baseURL, model, concurrency };
visualsOptions.imageGen = { baseURL, apiKey, model, size, timeoutMs, concurrency };
```

Web 服务在 taskRunner 启动任务前读 `.autovideo-web/config.json`（或环境变量回退），把配置注入 options。CLI 命令行启动时（保留兼容）由 `bin/autovideo.ts` 自行从环境变量装配。

**Anthropic 凭据注入硬约束**：Web 模式传入 `visualsOptions.anthropic.apiKey` 后，`src/ai/component-gen.ts` 必须优先使用该显式 key；若 key 缺失则直接抛 `ERR_ANTHROPIC_KEY_MISSING`，不得 fallback 到 `resolveClaudeCredentials()` / `~/.claude/settings.json`。CLI 模式可继续使用原有 fallback。

---

## 附录 B — 核心类型定义

```ts
// 共享类型，建议放 server/types/api.ts，前端通过 path alias 引用

export type Stage = 'compile' | 'tts' | 'visuals' | 'render' | 'build' | 'merge';

export type TaskStatus = 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface ProgressEvent {
  percent: number;          // 0-100
  step: string;             // 用户可见的中文步骤说明
  stage: Stage;             // 当前 stage（build 模式下子 stage）
  blockId?: string;         // 当前正在处理的块（如有）
}

export interface TaskRecord {
  id: string;               // ULID
  project: string;
  stage: Stage;
  blockIds?: string[];
  force: boolean;
  outputSlug: string;       // 入队时由 live meta.md 计算，运行全程固定（§3.3）
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  lastProgress?: ProgressEvent;
  errorMessage?: string;
  errorCode?: string;
  errorStack?: string;
}

export type VisualMode = 'animation' | 'image';

export interface BlockStatus {
  id: string;               // 'B01'
  title: string;            // 块头标题（不含 #Bxx）
  line: number;             // 块头在 visuals.md 中的行号（1-based）
  visualMode: VisualMode;   // 默认 'animation'
  audio: boolean;           // 来自 block.audio?.wavPath + 文件存在
  visual: boolean;          // animation: block.visual.componentPath；image: block.visual.imagePath
  rendered: boolean;        // 来自 block.render?.partialPath + 文件存在
}

export interface BlocksResponse {
  blocks: BlockStatus[];
  warnings: { line: number; message: string }[];   // 重复 ID、缺失 ID 等
  currentSlug: string;
}

export interface AppConfig {
  version: 1;
  anthropic?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    concurrency?: number;
  };
  imageGen?: {
    baseURL?: string;
    apiKey?: string;
    model?: string;
    size?: string;          // '1920x1080' | '1080x1920' | ...
    timeoutMs?: number;
    concurrency?: number;
  };
  voxcpm?: {
    endpoint?: string;
    autoStart?: boolean;
    concurrency?: number;
  };
}

// GET /api/config 响应（API key 脱敏）
export interface AppConfigPublic {
  version: 1;
  anthropic: {
    apiKey: { set: boolean; last4?: string };
    baseURL?: string;
    model?: string;
    concurrency?: number;
  };
  imageGen: {
    baseURL?: string;
    apiKey: { set: boolean; last4?: string };
    model?: string;
    size?: string;
    timeoutMs?: number;
    concurrency?: number;
  };
  voxcpm: {
    endpoint?: string;
    autoStart?: boolean;
    concurrency?: number;
  };
}

export interface ApiError {
  error: {
    code: string;           // ERR_*
    message: string;
    details?: unknown;
  };
}

export interface DoctorReport {
  voxcpm: { status: 'ok' | 'fail'; message?: string };
  anthropic: { status: 'ok' | 'missing'; message?: string };
  imageGen: { status: 'ok' | 'missing' | 'fail'; message?: string };  // ★ 新增
  ffmpeg: { status: 'ok' | 'missing'; version?: string };
  remotion: { status: 'ok'; version: string };
}
```

### B.1 块解析正则（服务端 + 客户端共用）

```ts
const BLOCK_HEADER = /^>>>\s+(?<title>.+?)\s+#(?<id>B\d+)\s*$/;
const DIRECTIVE = /^@(?<key>enter|exit|duration|visual):\s*(?<value>.*)$/;
const SECTION = /^---\s+(?<name>visual|narration)\s+---$/;
const ASSET_PATH = /\.\/assets\/[^\s)\]]+/g;
const BOLD = /\*\*([^*]+)\*\*/g;
```

`@visual:` 指令的合法值：`animation` / `image`（默认 `animation`）。其他值视为非法但不阻塞解析（在 BlocksResponse.warnings 里报警）。

### B.2 单块提取/回写算法（伪代码）

```ts
// 提取
function extractBlock(scriptMd: string, id: string): { content: string; range: [number, number] } {
  const lines = scriptMd.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = BLOCK_HEADER.exec(lines[i]);
    if (m && m.groups!.id === id) { start = i; break; }
  }
  if (start < 0) throw new NotFoundError(`block ${id} not found`);
  let end = lines.length;            // 默认到文件末尾
  for (let i = start + 1; i < lines.length; i++) {
    if (BLOCK_HEADER.test(lines[i])) { end = i; break; }
  }
  return { content: lines.slice(start, end).join('\n'), range: [start, end] };
}

// 回写
function replaceBlock(scriptMd: string, id: string, newContent: string): string {
  const { range } = extractBlock(scriptMd, id);
  const newLines = newContent.split('\n');
  // 校验首行仍是 #id 块头
  const head = BLOCK_HEADER.exec(newLines[0]);
  if (!head || head.groups!.id !== id) {
    throw new ValidationError('block header id mismatch');
  }
  const lines = scriptMd.split('\n');
  return [...lines.slice(0, range[0]), ...newLines, ...lines.slice(range[1])].join('\n');
}
```

---

## 附录 C — Phase 验收脚本

每个 Phase 完成后运行下列命令（在项目根目录），全部通过即视为完成。

### Phase 1
```bash
# 先编译 server（首次执行 dist/server/server/index.js 不存在）
npm ci
npm run build:server

# 启动服务（后台）
PORT=3030 npm run start:web &
sleep 2  # 等 Hono 监听

# 健康
curl -fsS http://127.0.0.1:3030/api/health | jq -e '.ok == true'

# 项目列表（含 nonStandard 标记）
curl -fsS http://127.0.0.1:3030/api/projects \
  | jq -e '.[] | select(.name == "microgpt") | has("nonStandard")'

# ETag
ETAG=$(curl -fsS -D - http://127.0.0.1:3030/api/projects/microgpt/meta -o /tmp/meta.md \
  | awk '/^ETag/{print $2}' | tr -d '\r')
curl -fsS -X PUT -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d "{\"content\":\"$(cat /tmp/meta.md | sed 's/"/\\"/g')\"}" \
  http://127.0.0.1:3030/api/projects/microgpt/meta | jq -e '.ok == true'

# 冲突
curl -sS -o /dev/null -w "%{http_code}" -X PUT \
  -H "Content-Type: application/json" -H "If-Match: sha256:00" \
  -d '{"content":"x"}' \
  http://127.0.0.1:3030/api/projects/microgpt/meta | grep -q 409
```

### Phase 2
```bash
# 块解析
curl -fsS http://127.0.0.1:3030/api/projects/microgpt/blocks \
  | jq -e '.blocks | length > 0 and all(.id | test("^B[0-9]+$"))'

# 单块提取
curl -fsS http://127.0.0.1:3030/api/projects/microgpt/blocks \
  | jq -e '.blocks[0] | has("title") and has("audio") and has("visual") and has("rendered")'

# 资源列表
curl -fsS http://127.0.0.1:3030/api/projects/microgpt/assets | jq -e 'type == "array"'
```

### Phase 3
```bash
# 提交任务
TASK=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"project":"microgpt","stage":"compile"}' \
  http://127.0.0.1:3030/api/tasks | jq -r '.id')

# SSE（前 5 秒应至少收到 progress 或 done）
timeout 30 curl -N -fsS http://127.0.0.1:3030/api/tasks/$TASK/events | grep -m1 -E '^event: (progress|done)'

# 取消
TASK2=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"project":"microgpt","stage":"build"}' \
  http://127.0.0.1:3030/api/tasks | jq -r '.id')
sleep 2
curl -fsS -X DELETE http://127.0.0.1:3030/api/tasks/$TASK2 | jq -e '.status == "cancelled" or .status == "cancelling"'
timeout 60 bash -c "until [ \"\$(curl -fsS http://127.0.0.1:3030/api/tasks/$TASK2 | jq -r '.status')\" = cancelled ]; do sleep 1; done"
```

### Phase 4
```bash
# Range 请求
curl -fsS -H "Range: bytes=0-1023" -o /dev/null -w "%{http_code}\n" \
  http://127.0.0.1:3030/api/projects/microgpt/output | grep -q 206

# 帧预览
curl -fsS "http://127.0.0.1:3030/api/projects/microgpt/blocks/B01/preview?frame=0" \
  -o /tmp/frame.png
file /tmp/frame.png | grep -q 'PNG image'
```

### Phase 5
```bash
# 切换块为图片模式
SCRIPT_ETAG=$(curl -fsS -D - http://127.0.0.1:3030/api/projects/microgpt/script -o /tmp/script.md \
  | awk '/^ETag/{print $2}' | tr -d '\r')
curl -fsS -X PUT -H "Content-Type: application/json" -H "If-Match: $SCRIPT_ETAG" \
  -d '{"mode":"image"}' \
  http://127.0.0.1:3030/api/projects/microgpt/blocks/B01/visual-mode \
  | jq -e '.ok == true'
grep -q '@visual: image' project/microgpt/visuals.md

# 配置脱敏
curl -fsS http://127.0.0.1:3030/api/config \
  | jq -e '.anthropic.apiKey | has("set")'

# 写入文生图配置
curl -fsS -X PUT -H "Content-Type: application/json" \
  -d '{"imageGen":{"baseURL":"http://localhost:9999","apiKey":"sk-fake","model":"gpt-image-1","size":"1920x1080"}}' \
  http://127.0.0.1:3030/api/config \
  | jq -e '.ok == true'

# 单块清缓存
curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"kind":"visual"}' \
  http://127.0.0.1:3030/api/projects/microgpt/blocks/B01/cache/clear \
  | jq -e '.ok == true'

# 批量任务
curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"project":"microgpt","stage":"tts","blockIds":["B01","B02"]}' \
  http://127.0.0.1:3030/api/tasks | jq -e '.id'
```

### Phase 6
```bash
# doctor
curl -fsS http://127.0.0.1:3030/api/doctor \
  | jq -e '.voxcpm and .anthropic and .imageGen and .ffmpeg and .remotion'

# 验收前确保至少有一个图片模式块（验收点 1 要求"动画块和图片块各至少 1 个"）
SCRIPT_ETAG=$(curl -fsS -D - http://127.0.0.1:3030/api/projects/microgpt/script -o /tmp/script.md \
  | awk '/^ETag/{print $2}' | tr -d '\r')
curl -fsS -X PUT -H "Content-Type: application/json" -H "If-Match: $SCRIPT_ETAG" \
  -d '{"mode":"image"}' \
  http://127.0.0.1:3030/api/projects/microgpt/blocks/B01/visual-mode

# 全量构建（耗时较长）
TASK=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"project":"microgpt","stage":"build"}' \
  http://127.0.0.1:3030/api/tasks | jq -r '.id')
while :; do
  S=$(curl -fsS http://127.0.0.1:3030/api/tasks/$TASK | jq -r '.status')
  [ "$S" = "completed" ] && break
  [ "$S" = "failed" ] && exit 1
  sleep 5
done
# 终稿是 final_normalized.mp4，路径必须在项目目录内
test -f project/microgpt/build/*/output/final_normalized.mp4
# 仓库根不应出现孤儿 build/
test ! -d build || ! ls build/*/output/final_normalized.mp4 2>/dev/null

# /api/projects/:name/output 优先返回 final_normalized.mp4（Content-Type 必须是 video/mp4，且能下载到非空 mp4）
curl -fsS -I http://127.0.0.1:3030/api/projects/microgpt/output \
  | grep -qi '^content-type:[[:space:]]*video/mp4'
curl -fsS -o /tmp/out.mp4 http://127.0.0.1:3030/api/projects/microgpt/output
test -s /tmp/out.mp4
file /tmp/out.mp4 | grep -qE 'ISO Media|MP4'

# Range 请求返回 206 + 正确长度
curl -fsS -D - -H "Range: bytes=0-1023" -o /tmp/range.bin \
  http://127.0.0.1:3030/api/projects/microgpt/output \
  | grep -qi '^HTTP/.* 206'

# Demo 项目创建（复用 POST /api/projects）
rm -rf project/demo
curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"name":"demo"}' http://127.0.0.1:3030/api/projects \
  | jq -e '.name == "demo"'
test -d project/demo && test -f project/demo/visuals.md && test -f project/demo/narration.md
```
