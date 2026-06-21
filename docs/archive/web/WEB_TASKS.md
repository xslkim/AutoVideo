# AutoVideo Web UI — 开发任务清单

> 按依赖顺序拆分。每个任务给出：**输入 / 输出 / 做什么 / 验收**。
> AI agent 应**严格按顺序**执行；每完成一个任务就跑该任务的"验收"，通过后才能进入下一个。
>
> 所有任务假定 cwd = 仓库根（`/home/xsl/AutoVideo/`）。
> `@WEB_PRD.md` = `./WEB_PRD.md`。
> 进度跟踪见 `WEB_PROGRESS.md`。

---

## 阶段 WP0：Web 项目初始化

### WP0.1 后端目录结构 + tsconfig.server.json

**输入**：已有仓库（CLI 已完成）
**输出**：`server/` 目录骨架 + `tsconfig.server.json` + 根 `package.json` 新增 scripts + 新增依赖
**做什么**：
- 创建 `server/` 目录结构（按 `@WEB_PRD.md` §7）：
  ```
  server/
  ├── index.ts           # Hono app 入口（占位，先只输出 "server starting"）
  ├── routes/            # 路由目录（空文件占位）
  ├── services/          # 服务目录（空文件占位）
  ├── middleware/         # 中间件目录（空文件占位）
  └── types/
      └── api.ts         # 从 @WEB_PRD.md 附录 B 复制完整类型定义
  ```
- 创建 `tsconfig.server.json`（按 `@WEB_PRD.md` §14.1 精确复制）
- 根 `package.json` 添加依赖：`hono`, `@hono/node-server`, `concurrently`, `tsx`（dev）
- 根 `package.json` 添加 scripts（按 `@WEB_PRD.md` §14.1）：`build:server`, `build:client`, `build:web`, `start:web`, `dev:web`
- 确保 `.gitignore` 包含 `.autovideo-web/`、`dist/`、`web/dist/`

**验收**：
- `npx tsc -p tsconfig.server.json --noEmit` 零错误
- `server/types/api.ts` 中 `Stage`、`TaskStatus`、`ProgressEvent`、`TaskRecord`、`BlockStatus`、`AppConfig` 等类型均可被 import

---

### WP0.2 前端项目初始化

**输入**：WP0.1 完成
**输出**：`web/` 目录 + Vue 3 + Vite + TypeScript + Naive UI + Pinia + Vue Router
**做什么**：
- 在 `web/` 下初始化 Vite + Vue 3 + TypeScript 项目：
  ```
  web/
  ├── package.json       # 独立 package（前端依赖）
  ├── vite.config.ts     # proxy /api → localhost:3030
  ├── index.html
  ├── tsconfig.json
  └── src/
      ├── main.ts        # createApp + 挂载 Pinia / Router / Naive UI
      ├── App.vue         # <router-view />
      ├── router/
      │   └── index.ts   # / → HomePage, /project/:name → ProjectPage
      ├── stores/         # 空目录
      ├── pages/
      │   ├── HomePage.vue    # 占位：显示 "项目列表"
      │   └── ProjectPage.vue # 占位：显示 "项目页 - {{ route.params.name }}"
      ├── components/     # 空子目录结构（按 @WEB_PRD.md §6）
      └── utils/          # 空目录
  ```
- `web/package.json` 依赖：`vue ^3.4`, `vue-router ^4.3`, `pinia ^2.1`, `naive-ui ^2.38`, `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-yaml`, `@codemirror/lang-javascript`
- `web/package.json` devDependencies：`vite ^5.0`, `@vitejs/plugin-vue`, `typescript ^5.0`, `vue-tsc`
- `web/vite.config.ts` 配置 dev proxy：`/api` → `http://127.0.0.1:3030`
- 安装依赖：`cd web && npm install`

**验收**：
- `cd web && npx vue-tsc --noEmit` 零错误
- `cd web && npm run dev` 启动后访问 `http://localhost:5173/` 显示 "项目列表"
- 访问 `http://localhost:5173/project/test` 显示 "项目页 - test"

---

### WP0.3 Dev 模式联调

**输入**：WP0.1 + WP0.2 完成
**输出**：`npm run dev:web` 可同时启动前后端
**做什么**：
- `server/index.ts` 实现最小 Hono 应用：
  - 监听 `PORT`（默认 3030）
  - `GET /api/health` → `{ ok: true, version: "0.1.0", projectsRoot }`
  - `NODE_ENV=development` 时，非 `/api/*` 请求反代到 `http://localhost:5173`（使用 `fetch` 转发）
  - 生产模式用 `@hono/node-server` 的 `serveStatic` 托管 `web/dist/`，SPA fallback
- 确保 `npm run dev:web` 可用（`concurrently -k "tsx server/index.ts" "cd web && npx vite"`）

**验收**：
- `npm run dev:web` 启动后，`curl http://127.0.0.1:3030/api/health` 返回 `{ ok: true }`
- 浏览器访问 `http://127.0.0.1:3030/` 显示前端页面（通过反代）
- `npm run build:server` 编译成功，`dist/server/server/index.js` 存在

---

## 阶段 WP1：基础骨架（对应 @WEB_PRD.md Phase 1）

### WP1.1 路径守卫中间件

**输入**：WP0.3 完成
**输出**：`server/middleware/pathGuard.ts`
**做什么**：
- 实现 `pathGuard` 中间件（@WEB_PRD.md §7）：
  - 对 `:name` 参数校验 `^[a-zA-Z0-9_-]{1,40}$`
  - 对 `:file` 参数校验文件名白名单 + 禁止 `/`、`..`
  - `path.resolve()` 后 `startsWith(projectsRoot)` 防路径穿越
  - 越界直接返回 400

**验收**：
- 单元测试：合法项目名通过、含 `../` 的路径拒绝、中文名拒绝

---

### WP1.2 项目服务 + 项目列表 API

**输入**：WP1.1 完成
**输出**：`server/services/projectService.ts` + `server/routes/projects.ts`
**做什么**：
- `projectService.ts`：
  - `listProjects()`：扫描 `project/` 目录，读取每个子目录的 `project.json`、`meta.md`，返回项目卡片数据
  - `getProject(name)`：返回项目详情（含 currentSlug、build 状态、是否非标准）
  - `readFile(projectDir, filename)`：读取文件 + 计算 ETag（`sha256:hex`）
  - `writeFile(projectDir, filename, content, ifMatch)`：ETag 校验 + 写入
  - `isNonStandard(projectJson)`：判断 project.json 是否非标准配置
- `routes/projects.ts`：
  - `GET /api/projects` → 项目列表
  - `GET /api/projects/:name` → 项目详情
- 挂载路由到 `server/index.ts`

**验收**：
- `curl /api/projects` 返回含 `microgpt` 的数组（假设 `project/microgpt/` 存在）
- 每个项目含 `name`, `title`, `blockCount`, `nonStandard` 字段

---

### WP1.3 Meta / Script 读写 API（含 ETag）

**输入**：WP1.2 完成
**输出**：`GET/PUT /api/projects/:name/meta` + `GET/PUT /api/projects/:name/script`
**做什么**：
- 在 `routes/projects.ts` 中添加四个端点
- `GET` 响应头包含 `ETag: sha256:<hex>`
- `PUT` 请求头必须带 `If-Match`；不匹配返回 `409 Conflict { currentContent, currentEtag }`
- `PUT /meta` 保存前检查 slug 变更与任务冲突（§3.3）— 此阶段无任务队列，先预留接口
- 请求体 `{ content: string }`，响应 `{ ok: true, etag: "sha256:..." }`

**验收**：
- `GET /meta` 返回 meta.md 内容 + ETag 响应头
- `PUT /meta` 带正确 If-Match 返回 200
- `PUT /meta` 带错误 If-Match 返回 409 + `{ currentContent, currentEtag }`
- 两次 PUT 同一 ETag → 第二次 409（符合并发冲突语义）

---

### WP1.4 前端：项目列表页

**输入**：WP1.2 完成
**输出**：`web/src/pages/HomePage.vue` + `web/src/stores/projectStore.ts` + `web/src/utils/api.ts`
**做什么**：
- `api.ts`：封装 `fetch`，处理 ETag 头的存取、409 冲突响应、统一错误 toast
- `projectStore.ts`（Pinia）：`projects` 列表、`fetchProjects()` action
- `HomePage.vue`：
  - 调用 `GET /api/projects` 渲染项目卡片网格
  - 每张卡片显示：项目名、title、块数量、最新 build 时间、是否有 final、非标准角标
  - 空状态：「创建第一个项目」+「试用 Demo」按钮（先占位 disabled）
  - 错误状态：错误信息 + 重试按钮
  - 点击卡片 → `router.push('/project/' + name)`

**验收**：
- 浏览器访问 `/` 显示项目卡片
- 卡片点击跳转到 `/project/:name`

---

### WP1.5 前端：项目页三栏布局 + MetaEditor

**输入**：WP1.3 + WP1.4 完成
**输出**：`ProjectPage.vue` 三栏布局 + `TopBar.vue` + `MetaEditor.vue`
**做什么**：
- `ProjectPage.vue`：三栏布局（@WEB_PRD.md §4.2）
  - 左侧边栏：块列表（先占位 "块列表"）
  - 中间主编辑区：Tab 切换（meta.md / script.md / 资源）
  - 右侧块详情面板：可折叠（先占位）
  - 底部任务栏：可折叠（先占位 "空闲"）
- `TopBar.vue`：面包屑（首页 / 项目名）+ 全局按钮占位 + 设置按钮占位
- `MetaEditor.vue`（Tab 1）：
  - CodeMirror 6 + YAML 语法高亮
  - `Ctrl+S` / 保存按钮触发 `PUT /api/projects/:name/meta`（带 ETag）
  - 409 冲突弹框（覆盖 / 取消 / 查看 diff — diff 先用纯文本对比占位）
  - 未保存改动提示（`beforeunload`）
  - 主题跟随系统 light/dark

**验收**：
- 浏览器访问 `/project/microgpt`，meta.md 内容在 CodeMirror 中显示
- 修改内容 → `Ctrl+S` → 磁盘 meta.md 文件更新
- 两个 tab 同时编辑，后保存方收到 409 冲突弹框

---

### WP1.6 Phase 1 验收

**输入**：WP1.1 ~ WP1.5 全部完成
**输出**：通过 @WEB_PRD.md 附录 C Phase 1 全部验收命令
**做什么**：
- 运行 Phase 1 验收脚本（@WEB_PRD.md §C Phase 1）
- 修复发现的问题
- 确保全部命令通过

**验收**：附录 C Phase 1 全部命令成功

---

## 阶段 WP2：脚本编辑与资源管理（对应 @WEB_PRD.md Phase 2）

### WP2.1 服务端脚本解析器

**输入**：WP1.6 完成
**输出**：`server/services/scriptParser.ts` + `server/services/scriptEditor.ts`
**做什么**：
- `scriptParser.ts`：解析 `script.md` → 块列表
  - 使用 @WEB_PRD.md 附录 B.1 正则
  - 返回 `BlockStatus[]` + `warnings[]`（重复 ID、缺失 ID）
  - 块状态判定：读取 `build/{currentSlug}/script.json`，按 §4.2.1 规则判定 audio/visual/rendered
- `scriptEditor.ts`：单块提取/回写
  - `extractBlock(scriptMd, id)` → `{ content, range }`
  - `replaceBlock(scriptMd, id, newContent)` → 新 script.md 内容
  - 严格按附录 B.2 伪代码实现
  - 回写时校验块头 ID 不变，否则抛 ValidationError

**验收**：
- 给定 `project/microgpt/script.md`，`parseScript` 返回正确块数量 + ID 列表
- `extractBlock` + `replaceBlock` 往返一致（内容不变则 script.md 不变）
- 修改块头 ID 后 `replaceBlock` 抛 422

---

### WP2.2 块列表 API + 单块 API

**输入**：WP2.1 完成
**输出**：`server/routes/blocks.ts`
**做什么**：
- `GET /api/projects/:name/blocks` → `{ blocks: BlockStatus[], warnings, currentSlug }`
- `PUT /api/projects/:name/blocks/:id` → 单块回写（带 If-Match for script.md）
  - 校验块头 ID 不变，违规返回 422
- `PUT /api/projects/:name/blocks/:id/visual-mode` → 切换视觉模式
  - 在 script.md 该块下方插入/更新 `@visual: <mode>` 指令
  - 带 If-Match

**验收**：
- `curl /api/projects/microgpt/blocks` 返回 blocks 数组，每个含 `id`, `title`, `visualMode`, `audio`, `visual`, `rendered`
- PUT 单块保存后 script.md 仅对应区段变化
- PUT 篡改 ID 返回 422

---

### WP2.3 前端：ScriptEditor + 自定义语法高亮

**输入**：WP1.5 完成
**输出**：`web/src/components/editors/ScriptEditor.vue` + `web/src/utils/scriptParser.ts`
**做什么**：
- `scriptParser.ts`（客户端）：解析 script.md 块结构（复用附录 B.1 正则），供侧边栏实时更新
- `ScriptEditor.vue`（Tab 2）：
  - CodeMirror 6 + 自定义 StreamLanguage（@WEB_PRD.md §4.2.2 + 附录 B.1）：
    - 块头 `^>>>\s+(.+?)\s+#(B\d+)\s*$` → 蓝色加粗
    - 指令 `^@(enter|exit|duration|visual):.*$` → 橙色
    - 分隔符 `^---\s+(visual|narration)\s+---$` → 绿色
    - 加粗 `\*\*[^*]+\*\*`
    - 资源路径 `\.\/assets\/[^\s)]+` → 下划线
  - `Ctrl+S` 保存（PUT + ETag）
  - 内容变更时 500ms 防抖重新解析 → 通知 BlockSidebar

**验收**：
- script.md 内容显示，语法高亮生效（块头蓝色、指令橙色、分隔符绿色）
- 修改并保存后磁盘更新
- 编辑时侧边栏 500ms 内反映块变化

---

### WP2.4 前端：BlockSidebar 侧边栏

**输入**：WP2.2 + WP2.3 完成
**输出**：`web/src/components/layout/BlockSidebar.vue`
**做什么**：
- 实时显示块列表（由 ScriptEditor 的客户端解析驱动 + 初始加载用 API 数据）
- 每行：块 ID、标题、视觉模式标记（动画/图片）、三色状态徽标
- 点击块 → 打开右侧块详情面板
- 每行多选框 + 顶部批量操作按钮区（按钮先占位 disabled）
- 顶部「+ 新建块」按钮：在 script.md 末尾追加块模板
- 解析警告显示在顶部

**验收**：
- 侧边栏正确列出所有块
- 修改 script.md 后侧边栏实时更新
- 点击块 → 右侧面板展开

---

### WP2.5 前端：BlockPanel 块详情面板 Tab A

**输入**：WP2.4 完成
**输出**：`web/src/components/block/BlockPanel.vue` + `BlockScriptEditor.vue`
**做什么**：
- `BlockPanel.vue`：面板框架，顶部视觉模式切换器（Radio），下方 Tab A / Tab B
- `BlockScriptEditor.vue`（Tab A）：
  - 从 `script.md` 提取该块内容显示（CodeMirror，复用 ScriptEditor 语法高亮）
  - 保存时调用 `PUT /api/projects/:name/blocks/:id`
  - 显示该块引用的图片资源（可点击预览）
- Tab B（产物预览）先占位

**验收**：
- 点击侧边栏 B01 → 右侧面板显示 B01 的内容
- 在 Tab A 修改 B01 保存 → script.md 中仅 B01 区段变化
- 篡改 B01 块头 ID 保存 → 收到 422 错误提示

---

### WP2.6 资源管理 API + 前端

**输入**：WP2.5 完成
**输出**：`server/routes/assets.ts` + `web/src/components/assets/AssetManager.vue`
**做什么**：
- 后端 `routes/assets.ts`（@WEB_PRD.md §5.2）：
  - `GET /api/projects/:name/assets` → 顶层资源列表
  - `POST /api/projects/:name/assets` → 上传（multipart，10MB 限制，文件名白名单）
  - `DELETE /api/projects/:name/assets/:file` → 删除
  - `GET /api/projects/:name/assets/:file` → 文件内容
- 后端 `POST /api/projects/:name/voice` → 上传语音（改写 meta.md voiceRef）
- 前端 `AssetManager.vue`（Tab 3）：
  - 缩略图网格展示
  - 上传（拖拽/点击）、删除（确认框 + 引用检测）
  - 单击复制路径、双击大图预览

**验收**：
- 上传 PNG 后 `assets/` 目录可见
- 删除有引用的资源时弹警告
- `curl /api/projects/:name/assets` 返回文件列表

---

### WP2.7 Phase 2 验收

**输入**：WP2.1 ~ WP2.6 全部完成
**输出**：通过 @WEB_PRD.md 附录 C Phase 2 全部验收命令
**做什么**：运行 Phase 2 验收脚本并修复问题
**验收**：附录 C Phase 2 全部命令成功

---

## 阶段 WP3：任务队列与进度（对应 @WEB_PRD.md Phase 3）

### WP3.1 CLI 模块改造：onProgress / signal / force

**输入**：WP2.7 完成
**输出**：改造 `src/cli/compile.ts`, `tts.ts`, `visuals.ts`, `render.ts`, `build.ts`
**做什么**（@WEB_PRD.md 附录 A）：
- 每个 `*Options` 类型新增 `onProgress?: (event: ProgressEvent) => void` + `signal?: AbortSignal`
- `compile.ts`：去除 `process.chdir()`，改为参数传递 `outDir`
- `render.ts`：新增 `concatOnly?: boolean` 模式（A.3）
- 所有 stage 内部在 await 处检查 `signal.aborted`
- abort 时清理临时文件
- 取消信号正确传播到 fetch/SDK/Remotion/ffmpeg（@WEB_PRD.md A.4.1）
- 错误附带稳定 `code` 字段（A.4）
- 配置通过 options 注入，不直接读 `process.env`（A.7）

**验收**：
- `npx tsc --noEmit` 零错误（现有类型不被破坏）
- `compile` 不再调用 `process.chdir`
- `render({ concatOnly: true })` 在所有 partial 存在时仅做 concat + loudnorm + qa
- 传入 `signal` 后 abort 能中止运行

---

### WP3.2 任务队列服务

**输入**：WP3.1 完成
**输出**：`server/services/taskQueue.ts`
**做什么**：
- 单线程 FIFO 队列（@WEB_PRD.md §4.5）
- 任务状态机：`pending → running → completed/failed/cancelled`；取消超时 → `cancelling`
- 持久化到 `.autovideo-web/tasks.jsonl`（每行一条 JSON）
- 启动时加载最近 50 条
- 同一时刻只运行一个任务
- 取消逻辑：pending 直接移除；running 调 AbortController.abort()；worker 不释放直到 promise settle；5s 超时进入 cancelling
- 日志写入 `.autovideo-web/logs/{taskId}.log`

**验收**：
- 队列添加 3 个任务 → 依次串行执行
- 每条 task 持久化记录包含 `outputSlug` 字段（入队时由 live meta.md 计算）
- 取消 pending 任务 → 从队列移除
- 杀进程重启 → `tasks.jsonl` 恢复历史，`outputSlug` 字段完整

---

### WP3.3 任务运行器

**输入**：WP3.1 + WP3.2 完成
**输出**：`server/services/taskRunner.ts`
**做什么**：
- 调用 CLI 模块（compile/tts/visuals/render/build/merge）
- 管理 AbortController + 取消信号传播
- compile/build 前执行源文件快照（@WEB_PRD.md §4.5 快照流程）：
  - 复制 project.json, meta.md, script.md, assets/, voice/ 到 `build/{slug}/_snapshot/`
  - 从快照路径调用 compile
- 任务启动时读取配置快照（@WEB_PRD.md §13.4）
- 进度事件转发给 SSE
- build 聚合权重：compile 5% / tts 25% / visuals 35% / render 30% / 收尾 5%
- **缓存目录注入**：taskRunner 调用任何 CLI stage 前必须将 `config.cache.dir` 设为 `path.join(projectDir, "cache")`，确保缓存落在项目目录内（CLI 默认用 `~/.autovideo/cache`，web 模式必须覆盖）；否则后续清缓存 API（§5.1）清不到实际缓存

**验收**：
- 提交 compile 任务 → `build/{slug}/script.json` 生成
- 提交 tts 任务（指定 blockIds）→ 对应 WAV 生成
- 快照目录 `_snapshot/` 包含 voice/ 目录
- tts/visuals 产出的缓存文件落在 `project/{name}/cache/` 内（而非 `~/.autovideo/cache`）

---

### WP3.4 任务 API + SSE

**输入**：WP3.2 + WP3.3 完成
**输出**：`server/routes/tasks.ts`
**做什么**（@WEB_PRD.md §5.4）：
- `GET /api/tasks` → 任务列表（最近 50 条，?project= 过滤）
- `GET /api/tasks/:id` → 任务详情
- `POST /api/tasks` → 创建任务（body: project, stage, blockIds?, force?）
  - 入队时计算 `outputSlug`
  - blockIds 仅 tts/visuals/render 接受，其余返回 400
- `DELETE /api/tasks/:id` → 取消任务
- `GET /api/tasks/:id/events` → SSE 进度流（@WEB_PRD.md §5.4 事件格式）
- `GET /api/tasks/:id/log` → 完整日志
- SSE 事件退出顺序：`progress(100) → done|error|cancelled → close`

**验收**：
- POST 创建 compile 任务 → 返回 task id，响应体含 `outputSlug`
- SSE 至少收到一个 progress + done/error
- DELETE 正在 running 的任务 → 状态变为 cancelled（或 cancelling 后 cancelled）
- `GET /api/tasks/:id` 返回的 record 包含 `outputSlug` 字段

---

### WP3.5 前端：任务栏 + 任务触发

**输入**：WP3.4 完成
**输出**：`TaskBar.vue` + `TaskItem.vue` + `TaskProgress.vue` + `taskStore.ts` + `sse.ts`
**做什么**：
- `sse.ts`：SSE 重连封装（指数退避，重连前 GET 最新状态）
- `taskStore.ts`（Pinia）：任务列表、SSE 订阅、页面刷新恢复
- `TaskBar.vue`：底部任务栏
  - 折叠态：当前任务摘要 + 进度条 + ETA
  - 展开态：历史 + 当前任务（最多 20 条）
- `TaskItem.vue`：单条任务（状态图标、进度条、耗时、取消按钮、失败日志按钮）
- 在 `BlockPanel` 的 Tab B 中添加四个单块操作按钮（生成音频 / 生成视觉 / 渲染分段 / 重新编译）
  - 每个带「⋯」菜单：强制重跑 / 清缓存（缓存 API 先占位）
- 在 `TopBar.vue` 中激活全局操作按钮（编译 / 全量构建 / 合并视频）
- 任务进行中按钮置灰防重复提交

**验收**：
- 点击「编译」→ 底部任务栏出现任务条目 → 进度条推进 → 完成
- 两个任务串行（第二个等第一个完成）
- 取消 running 任务 → 状态更新
- 刷新页面后任务列表恢复

---

### WP3.6 Phase 3 验收

**输入**：WP3.1 ~ WP3.5 全部完成
**输出**：通过 @WEB_PRD.md 附录 C Phase 3 全部验收命令
**做什么**：运行 Phase 3 验收脚本并修复问题
**验收**：附录 C Phase 3 全部命令成功

---

## 阶段 WP4：产物预览（对应 @WEB_PRD.md Phase 4）

### WP4.1 Range 中间件

**输入**：WP3.6 完成
**输出**：`server/middleware/range.ts`
**做什么**：
- 实现 HTTP Range Request 中间件
- 支持 `bytes=start-end` 格式
- 正常请求返回 200 + 完整文件
- Range 请求返回 206 + `Content-Range` 头 + 对应字节切片
- 用于 MP4 和 WAV 文件流

**验收**：
- `curl -H "Range: bytes=0-1023" file.mp4` 返回 206 + 正确长度

---

### WP4.2 产物 API

**输入**：WP4.1 完成
**输出**：扩展 `server/routes/blocks.ts` 和新增 output 路由
**做什么**（@WEB_PRD.md §5.3）：
- `GET /api/projects/:name/blocks/:id/audio` → WAV（支持 Range）
- `GET /api/projects/:name/blocks/:id/component` → Component.tsx（text/plain）
- `GET /api/projects/:name/blocks/:id/image` → PNG（图片模式产物）
- `GET /api/projects/:name/blocks/:id/video` → partial MP4（支持 Range）
- `GET /api/projects/:name/output` → final_normalized.mp4 优先，回退 final.mp4，404
  - `?download=1` → Content-Disposition: attachment
  - 降级时带 `X-Source: final.mp4`
  - 支持 Range

**验收**：
- 有 build 产物时各端点返回正确 Content-Type
- 无产物时返回 404
- Range 请求返回 206
- output 端点 ?download=1 触发浏览器下载

---

### WP4.3 帧渲染服务

**输入**：WP4.2 完成
**输出**：`server/services/frameRenderer.ts`
**做什么**（@WEB_PRD.md §8）：
- Remotion bundle 缓存管理（启动预 bundle 到 `.autovideo-web/remotion-bundle/`）
- `renderFrame(project, blockId, frame)` → PNG buffer
  - 读 `build/{slug}/script.json` 获取 block 元信息
  - 计算 durationInFrames（优先 block.timing.frames，兜底 audio.durationSec * fps）
  - 校验 frame 范围
  - `selectComposition` + `renderStill`，传 `publicDir`
  - 30s 超时 → 504
- 并发控制：同一块同时只允许一个 renderStill
- `GET /api/projects/:name/blocks/:id/preview?frame=N` 路由

**验收**：
- `curl .../blocks/B01/preview?frame=0` 返回 PNG
- 帧超出范围返回 422
- componentPath 不存在返回 404

---

### WP4.4 前端：产物预览组件

**输入**：WP4.2 + WP4.3 完成
**输出**：`web/src/components/block/BlockOutputs.vue`
**做什么**：
- BlockOutputs.vue（BlockPanel Tab B）四个区域：
  - ① 音频：HTML5 `<audio>` 播放器 + 时长 + 占位
  - ② 视觉（动画模式）：CodeMirror 只读查看 Component.tsx + 帧预览滑块
    - 滑块 mouseup 后 300ms 防抖发请求
    - spinner 覆盖旧图（不替换直到新图返回）
    - AbortController 取消前一次未完成请求
  - ③ 分段视频：HTML5 `<video controls>` + Range 播放
  - ④ 单块操作按钮（已在 WP3.5 实现）
- 任务完成 SSE 事件到达时自动刷新对应区域
- 最终视频预览模态框（TopBar「预览成片」按钮 → 模态框播放 final_normalized.mp4）

**验收**：
- 帧预览滑块拖动松开后 5s 内出图
- 连续切换帧，前一次被 abort
- 播放 partial MP4 时 seek 正常
- 缺音频/组件时显示占位

---

### WP4.5 Phase 4 验收

**输入**：WP4.1 ~ WP4.4 全部完成
**输出**：通过 @WEB_PRD.md 附录 C Phase 4 全部验收命令
**做什么**：运行 Phase 4 验收脚本并修复问题
**验收**：附录 C Phase 4 全部命令成功

---

## 阶段 WP5：视觉模式 / 文生图 / 设置面板（对应 @WEB_PRD.md Phase 5）

### WP5.1 类型与 Schema 更新

**输入**：WP4.5 完成
**输出**：更新 `src/types/script.ts` + `schemas/script.schema.json`
**做什么**（@WEB_PRD.md A.5.1 + A.5.2）：
- `script.ts`：新增 `VisualMode` 类型、`Block.visualMode` 字段、`Block.visual.imagePath` 字段
- 类型守卫调整：`assertVisualsReady` 按模式分流
- `script.schema.json`：补 `visualMode` enum、`visual.imagePath` 可选字段

**验收**：
- `tsc --noEmit` 零错误
- 现有测试通过

---

### WP5.2 compile.ts 解析 @visual 指令

**输入**：WP5.1 完成
**输出**：更新 `src/cli/compile.ts`
**做什么**（@WEB_PRD.md A.5.3 + A.6）：
- 解析 `@visual: animation|image` 指令写入 `block.visualMode`
- 值非法时报警告降级为 `animation`，不阻塞编译
- 缺省值为 `animation`

**验收**：
- 含 `@visual: image` 的 script.md compile 后 script.json 中对应块 `visualMode === "image"`
- 未指定 @visual 的块 `visualMode === "animation"`

---

### WP5.3 image-gen.ts 文生图模块

**输入**：WP5.2 完成
**输出**：新增 `src/ai/image-gen.ts` + `src/cache/store.ts` 新增 images 类别
**做什么**（@WEB_PRD.md A.5.4 + A.5.6）：
- OpenAI 兼容协议调用（POST `{baseURL}/v1/images/generations`）
- 支持 b64_json 和 url 两种响应格式
- 产物落盘：PNG → `build/{slug}/public/images/{id}.png`，wrapper Component.tsx → `build/{slug}/src/blocks/{id}/Component.tsx`
- IR 写入 `block.visual.imagePath` + `block.visual.componentPath`
- 缓存：`sha256(prompt + model + size + baseURL)` 为 key
- 失败抛 `ImageGenError(code, message)`
- 取消信号透传

**验收**：
- 配置文生图服务后，`generateImage(block, config)` 产出 PNG + wrapper TSX
- wrapper 的 `staticFile("images/{id}.png")` 路径正确
- 缓存命中时跳过 HTTP 调用

---

### WP5.4 visuals.ts 模式分流

**输入**：WP5.3 完成
**输出**：更新 `src/cli/visuals.ts`
**做什么**（@WEB_PRD.md A.5.5）：
- 按 `block.visualMode` 分流：`image` → `generateImage()`，`animation` → `generateAnimation()`
- Anthropic 凭据注入硬约束（A.7）：显式传入时使用，不 fallback 到 `~/.claude/settings.json`

**验收**：
- 图片模式块调用 visuals 后产出 PNG + wrapper
- 动画模式块走原有 Claude 生成路径
- 未配置 key 时抛 `ERR_ANTHROPIC_KEY_MISSING` / `ERR_IMAGE_GEN_KEY_MISSING`

---

### WP5.5 设置面板（后端 + 前端）

**输入**：WP5.4 完成
**输出**：`server/routes/system.ts` 扩展 + 设置面板组件
**做什么**（@WEB_PRD.md §13 + §5.6）：
- 后端：
  - `GET /api/config` → 脱敏返回（apiKey → `{ set, last4 }`）
  - `PUT /api/config` → 写入 `.autovideo-web/config.json`
  - `POST /api/config/test` → 连通性测试
  - 配置加载优先级：UI > env（§13.4）
  - 首次启动 `~/.claude/settings.json` 导入提示
- 前端设置模态框（三个 Tab）：
  - Anthropic：API Key / Base URL / Model / Concurrency
  - 文生图：Base URL / API Key / Model / Size / Timeout / Concurrency
  - VoxCPM：Endpoint / Auto Start / Concurrency
  - 每组有「测试连通性」按钮

**验收**：
- `GET /api/config` 返回 apiKey 为 `{ set: true, last4 }` 格式
- PUT 写入后重启服务配置仍在
- 连通性测试返回 ok/fail

---

### WP5.6 前端：视觉模式切换 + 图片产物展示

**输入**：WP5.5 完成
**输出**：更新 `BlockPanel.vue` + `BlockOutputs.vue`
**做什么**：
- 块详情面板顶部视觉模式切换器（Radio: animation / image）
  - 切换时调 `PUT .../blocks/:id/visual-mode`（带 If-Match）
  - 切换后提示「模式已切换，建议重新生成视觉」
- BlockOutputs 视觉区域按模式分流：
  - 动画模式：CodeMirror 只读 + 帧预览（已实现）
  - 图片模式：显示 PNG（contain 适应）+ 信息栏 + 下载按钮
- 单块操作按钮文案随模式切换（「生成视觉」↔「生成图片」）

**验收**：
- 切换块为图片模式 → script.md 出现 `@visual: image`
- 图片模式下 BlockOutputs 显示 PNG 而非 CodeMirror

---

### WP5.7 单块缓存清理 + 批量操作

**输入**：WP5.6 完成
**输出**：后端清缓存 API + 前端批量操作
**做什么**：
- 后端 `POST /api/projects/:name/blocks/:id/cache/clear`（@WEB_PRD.md §5.1）：
  - body `{ kind: "audio" | "visual" | "partial" | "all" }`
  - 同时清 cache/* + build/{slug}/ 对应产物 + 回写 script.json 字段
- 前端单块菜单：「清缓存」选项
- 前端批量操作（@WEB_PRD.md §4.4）：
  - 侧边栏多选 → 批量生成音频/视觉/渲染 + 批量清缓存 + 强制开关
  - 复用 blockIds 参数

**验收**：
- 单块清缓存后状态回退到「未生成」
- 选中 3 块批量生成音频 → 任务依次串行
- 清 visual 缓存同时删 cache + build 产物 + script.json 字段

---

### WP5.8 Phase 5 验收

**输入**：WP5.1 ~ WP5.7 全部完成
**输出**：通过 @WEB_PRD.md 附录 C Phase 5 全部验收命令
**做什么**：运行 Phase 5 验收脚本并修复问题
**验收**：附录 C Phase 5 全部命令成功

---

## 阶段 WP6：全量构建与部署收尾（对应 @WEB_PRD.md Phase 6）

### WP6.1 全局操作完善

**输入**：WP5.8 完成
**输出**：全量构建 / 合并视频按钮完整工作
**做什么**：
- 全量构建（stage: `build`）：compile → tts → visuals → render（taskRunner 串行调度）
- 合并视频（stage: `merge`）：仅 concat + loudnorm + qa，不重渲染 partials
- 预览成片模态框（final_normalized.mp4 优先，回退 final.mp4）
- 下载成片（Content-Disposition: attachment）

**验收**：
- 全量构建一个项目（含动画块和图片块各至少 1 个）→ 产出 `final_normalized.mp4`
- 合并视频在所有 partial 存在时成功

---

### WP6.2 项目 CRUD

**输入**：WP6.1 完成
**输出**：新建 / 删除 / 清缓存 / Demo 项目
**做什么**：
- `POST /api/projects` → 新建项目（@WEB_PRD.md §4.1）：
  - 校验项目名
  - `cp -r templates/starter/* project/{name}/`
  - 替换 meta.md 中的 title/slug
- `DELETE /api/projects/:name` → 删除项目（rm -rf 整个目录，二次确认在前端）
- `POST /api/projects/:name/cache/clear` → 清空 cache/ + build/
- Demo 项目：空状态下点击 → 从 templates/starter/ 复制为 project/demo/
- 前端 HomePage 中新建项目模态框、删除确认框、清缓存菜单

**验收**：
- 新建项目 `test1` → `project/test1/` 存在 + 含 script.md
- 删除项目 → 目录消失
- Demo 创建 → `project/demo/` 存在

---

### WP6.3 健康指示灯 + Doctor

**输入**：WP6.2 完成
**输出**：`GET /api/doctor` + 前端健康指示灯
**做什么**：
- 后端 `routes/system.ts`：
  - `GET /api/doctor` → 调用 `src/cli/doctor.ts` + 检查 web 配置
  - 返回 `DoctorReport`（voxcpm/anthropic/imageGen/ffmpeg/remotion 各项状态）
- 前端 TopBar 健康指示灯：
  - 绿色 = 全部 ok；红色 = 有 fail/missing
  - hover 显示各项状态 tooltip
  - 点击展开诊断面板

**验收**：
- 清空 ANTHROPIC_API_KEY + UI 配置 → doctor 报 anthropic missing
- UI 红灯显示 + tooltip 正确

---

### WP6.4 错误展示 + 日志查看

**输入**：WP6.3 完成
**输出**：完善错误处理 UI
**做什么**：
- 任务失败时：错误摘要 + 「查看完整日志」按钮
- 日志模态框：调用 `GET /api/tasks/:id/log` 显示完整日志
- API 错误统一 toast（已在 api.ts 中，确认完善）
- 保存成功简短 toast（1.5s）
- project.json 非标准时红色横幅

**验收**：
- 任务失败后能从日志模态框看到完整错误堆栈
- project.json 非标准时横幅显示 + 编辑按钮禁用

---

### WP6.5 部署脚本

**输入**：WP6.4 完成
**输出**：`deploy/` 目录 + systemd/launchd 配置
**做什么**：
- `deploy/autovideo-web.service`（systemd 单元，@WEB_PRD.md §14.2）
- `deploy/com.autovideo.web.plist`（launchd plist，@WEB_PRD.md §14.3）
- `deploy/README.md`：部署步骤说明
- 确保 `npm run build:web && npm run start:web` 端到端工作
- `.autovideo-web/config.json` 已在 `.gitignore` 中
- 服务启动时若 `.autovideo-web/` 不在 gitignore 中打印警告

**验收**：
- `npm run build:web` 成功
- `npm run start:web` 后 `127.0.0.1:3030` 可访问
- `web/dist/index.html` 存在

---

### WP6.6 进程稳定性 + 优雅退出

**输入**：WP6.5 完成
**输出**：server 进程稳定性保障
**做什么**（@WEB_PRD.md §10）：
- 任务运行抛出未捕获异常 → 只标该任务 failed，不退出进程
- SIGINT/SIGTERM → 拒收新任务 → abort 当前任务 → flush tasks.jsonl → 退出
- 日志清理：50 条之外的日志保留 7 天后清理

**验收**：
- 任务失败不影响后续任务执行
- `kill -TERM pid` 后进程优雅退出，tasks.jsonl 已 flush

---

### WP6.7 Phase 6 验收

**输入**：WP6.1 ~ WP6.6 全部完成
**输出**：通过 @WEB_PRD.md 附录 C Phase 6 全部验收命令
**做什么**：
- 运行 Phase 6 完整验收脚本
- 端到端测试：全量构建一个含动画块 + 图片块的项目
- 确认所有产物路径在 `project/{name}/build/{slug}/` 内
- 确认仓库根无孤儿 `build/` 目录

**验收**：附录 C Phase 6 全部命令成功
