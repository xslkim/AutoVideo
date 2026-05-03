# AutoVideo — Claude Code 项目指令

## 项目概况

AutoVideo 是一个将 Markdown 教学脚本编译为 MP4 视频的工具。CLI 版已完成，正在开发 Web UI。

## 当前工作：Web UI 开发

**核心文档**（按优先级）：
1. `WEB_PROGRESS.md` — 进度跟踪，**每次启动先读此文件**确认当前任务
2. `WEB_TASKS.md` — 任务清单，每个任务的输入/输出/做什么/验收
3. `WEB_PRD.md` — 产品需求文档 v2.4，所有设计决策的来源

## 开发工作流（严格遵守）

```
1. 读 WEB_PROGRESS.md → 确认 active_task 和 next_action
2. 读 WEB_TASKS.md → 找到当前任务的详细描述
3. 更新 WEB_PROGRESS.md：对应任务 status → in_progress
4. 实现任务（参考 WEB_PRD.md 中引用的章节）
5. 运行验收命令，确认全部通过
6. git commit（见下方提交规范）
7. 更新 WEB_PROGRESS.md：status → done，填写 commit hash，更新 completed 计数和 next_action
```

## 提交规范

- 每个任务完成后单独 commit
- commit message 格式：`web: WPx.x 任务标题`
- 例：`web: WP1.4 前端：项目列表页`
- 验收修复也计入同一 commit（amend 或追加 commit 均可）

## 技术栈

- **后端**：Hono + @hono/node-server，代码在 `server/`
- **前端**：Vue 3 + Vite + TypeScript + Naive UI + Pinia，代码在 `web/`
- **CLI**：已有代码在 `src/`，Web 后端通过 import 调用
- **编译**：`tsconfig.server.json` 编译 server/ + src/ → `dist/server/`

## 已完成的基础设施

- `server/index.ts` — Hono 入口（health API + dev 反代 + 生产 serveStatic）
- `server/middleware/pathGuard.ts` — 项目名/文件名校验 + 路径穿越防护
- `server/services/projectService.ts` — 项目列表/详情/文件读写/ETag
- `server/routes/projects.ts` — 项目 CRUD + meta/script GET/PUT（含 ETag 协议）
- `server/types/api.ts` — 共享类型定义
- `web/` — Vue 3 项目骨架（路由、Pinia、Naive UI 已配置）

## 关键约束

- 所有 build 产物必须在 `project/{name}/build/{slug}/` 内
- ETag 协议：GET 返回 `ETag: sha256:xxx`，PUT 需要 `If-Match`，冲突返回 409
- 任务队列单线程 FIFO，同一时刻只运行一个任务
- Web 模式不读 `~/.claude/settings.json`，配置走 UI 设置面板 + 环境变量
- `npm run dev:web` 启动前后端联调（server :3030 + vite :5173）

## 常用命令

```bash
npm run dev:web          # 启动开发环境
npm run build:server     # 编译 server
npx tsc -p tsconfig.server.json --noEmit  # 类型检查 server
cd web && npx vue-tsc --noEmit             # 类型检查前端
```

## 不要做

- 不要修改 CLI 核心逻辑（src/），除非任务明确要求（如 WP3.1 CLI 改造）
- 不要跳过验收步骤
- 不要在一次执行中做多个任务
- 不要添加任务未要求的功能
