# AutoVideo Web UI — 开发进度

> 本文件由 AI agent 在每个任务**开始前**和**完成后**主动维护。
> 中断恢复时，agent 必须**先读这个文件**，从第一个 `in_progress` 或 `pending` 的任务继续。

---

## 当前状态（agent 每次更新后修改这一节）

- **active_task**: `WP5.7 单块缓存清理 + 批量操作`
- **last_updated**: `2026-05-04T07:00:00Z`
- **next_action**: `实现 WP5.7 单块缓存清理 + 批量操作`
- **completed**: `33 / 42`
- **blockers**: `0`

恢复检查清单（agent 启动时按顺序确认）：

1. [ ] 已读 `WEB_PRD.md` 全文
2. [ ] 已读 `WEB_TASKS.md` 全文
3. [ ] 已读本文件，确认 `active_task` 与 `next_action`
4. [ ] 已 `git status` 确认工作树状态
5. [ ] 已确认 `git log -1` 的 hash 与下表中最近一个 `done` 任务的 commit 一致
6. [ ] 已确认 `project/microgpt/` 存在（验收需要）
7. [ ] 已确认现有 CLI 可工作：`npx tsx bin/autovideo.ts --help`

---

## 参考文档

| 文档 | 用途 |
|------|------|
| `WEB_PRD.md` | 产品需求文档（v2.4），所有设计决策的来源 |
| `WEB_TASKS.md` | 任务分解，每个任务的输入/输出/验收 |
| `PRD.md` | CLI 版 PRD（已完成，参考 CLI 模块接口） |
| `TASKS.md` | CLI 版任务清单（已完成） |
| `PROGRESS.md` | CLI 版进度（全部完成） |

---

## 任务表

> 状态值：`pending` / `in_progress` / `done` / `blocked` / `skipped`
> 修改方式：直接替换对应行的 status / commit / notes 列。

### 阶段 WP0：Web 项目初始化

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP0.1 | 后端目录结构 + tsconfig.server.json | done | 2026-05-03 | 2026-05-03 | — | — |
| WP0.2 | 前端项目初始化 | done | 2026-05-03 | 2026-05-03 | — | — |
| WP0.3 | Dev 模式联调 | done | 2026-05-03 | 2026-05-03 | — | — |

### 阶段 WP1：基础骨架（Phase 1）

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP1.1 | 路径守卫中间件 | done | 2026-05-03 | 2026-05-03 | — | — |
| WP1.2 | 项目服务 + 项目列表 API | done | 2026-05-03 | 2026-05-03 | — | — |
| WP1.3 | Meta / Script 读写 API（含 ETag） | done | 2026-05-03 | 2026-05-03 | — | — |
| WP1.4 | 前端：项目列表页 | done | 2026-05-03 | 2026-05-03 | 9aa5d6a | — |
| WP1.5 | 前端：项目页三栏布局 + MetaEditor | done | 2026-05-03 | 2026-05-03 | 50ddce3 | — |
| WP1.6 | Phase 1 验收 | done | 2026-05-03 | 2026-05-03 | 50edb7f | — |

### 阶段 WP2：脚本编辑与资源管理（Phase 2）

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP2.1 | 服务端脚本解析器 | done | 2026-05-03 | 2026-05-03 | b2d8ccd | — |
| WP2.2 | 块列表 API + 单块 API | done | 2026-05-03 | 2026-05-03 | 6861802 | — |
| WP2.3 | 前端：ScriptEditor + 自定义语法高亮 | done | 2026-05-03 | 2026-05-03 | 1c248fe | — |
| WP2.4 | 前端：BlockSidebar 侧边栏 | done | 2026-05-03 | 2026-05-03 | 4c240ff | — |
| WP2.5 | 前端：BlockPanel 块详情面板 Tab A | done | 2026-05-03 | 2026-05-03 | ea03100 | — |
| WP2.6 | 资源管理 API + 前端 | done | 2026-05-03T17:00:00Z | 2026-05-03T18:00:00Z | db83a09 | — |
| WP2.7 | Phase 2 验收 | done | 2026-05-03T18:30:00Z | 2026-05-03T18:45:00Z | 87ab2e6 | — |

### 阶段 WP3：任务队列与进度（Phase 3）

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP3.1 | CLI 模块改造：onProgress / signal / force | done | 2026-05-03T19:00:00Z | 2026-05-03T20:00:00Z | 753b1c5 | — |
| WP3.2 | 任务队列服务 | done | 2026-05-03 | 2026-05-03 | 9400925 | — |
| WP3.3 | 任务运行器 | done | 2026-05-03 | 2026-05-03 | 7db0ef6 | — |
| WP3.4 | 任务 API + SSE | done | 2026-05-03 | 2026-05-03 | 217dff1 | — |
| WP3.5 | 前端：任务栏 + 任务触发 | done | 2026-05-03 | 2026-05-03 | d93b9dc | — |
| WP3.6 | Phase 3 验收 | done | 2026-05-03 | 2026-05-03 | dafbe56 | — |

### 阶段 WP4：产物预览（Phase 4）

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP4.1 | Range 中间件 | done | 2026-05-03 | 2026-05-03 | 10feb05 | — |
| WP4.2 | 产物 API | done | 2026-05-03 | 2026-05-03 | d3cd01e | — |
| WP4.3 | 帧渲染服务 | done | 2026-05-03 | 2026-05-03 | fd312d2 | — |
| WP4.4 | 前端：产物预览组件 | done | 2026-05-04 | 2026-05-04 | 3f6b2f7 | — |
| WP4.5 | Phase 4 验收 | done | 2026-05-04 | 2026-05-04 | 5b60ff9 | — |

### 阶段 WP5：视觉模式 / 文生图 / 设置面板（Phase 5）

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP5.1 | 类型与 Schema 更新 | done | 2026-05-04 | 2026-05-04 | cfcd06e | — |
| WP5.2 | compile.ts 解析 @visual 指令 | done | 2026-05-04 | 2026-05-04 | 2ca36a2 | — |
| WP5.3 | image-gen.ts 文生图模块 | done | 2026-05-04 | 2026-05-04 | 0c9e923 | — |
| WP5.4 | visuals.ts 模式分流 | done | 2026-05-04 | 2026-05-04 | e47bb7f | — |
| WP5.5 | 设置面板（后端 + 前端） | done | 2026-05-04 | 2026-05-04 | 60b63d9 | — |
| WP5.6 | 前端：视觉模式切换 + 图片产物展示 | done | 2026-05-04 | 2026-05-04 | d2916ff | — |
| WP5.7 | 单块缓存清理 + 批量操作 | in_progress | 2026-05-04T07:00:00Z | — | — | — |
| WP5.8 | Phase 5 验收 | pending | — | — | — | — |

### 阶段 WP6：全量构建与部署收尾（Phase 6）

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| WP6.1 | 全局操作完善 | pending | — | — | — | — |
| WP6.2 | 项目 CRUD | pending | — | — | — | — |
| WP6.3 | 健康指示灯 + Doctor | pending | — | — | — | — |
| WP6.4 | 错误展示 + 日志查看 | pending | — | — | — | — |
| WP6.5 | 部署脚本 | pending | — | — | — | — |
| WP6.6 | 进程稳定性 + 优雅退出 | pending | — | — | — | — |
| WP6.7 | Phase 6 验收 | pending | — | — | — | — |

---

## Agent 操作规范

### 每个任务的工作流

```
1. 读 WEB_PROGRESS.md → 找到当前 active_task
2. 读 WEB_TASKS.md → 找到该任务的详细描述
3. 更新 WEB_PROGRESS.md：status → in_progress, 更新 active_task / next_action
4. 执行任务
5. 运行验收命令
6. git add + commit（message 格式：web: WPx.x 任务标题）
7. 更新 WEB_PROGRESS.md：status → done, commit hash, 更新 completed 计数
8. 进入下一个任务
```

### 提交规范

- 每个任务完成后单独 commit
- commit message 格式：`web: WPx.x 任务标题`
- 例：`web: WP0.1 后端目录结构 + tsconfig.server.json`
- 验收阶段如有修复也计入同一 commit

### 中断恢复

1. 读 `WEB_PROGRESS.md` → 检查 `active_task`
2. 读 `WEB_TASKS.md` → 确认任务详情
3. `git status` → 是否有未提交的改动
4. `git log -1` → 确认最近 commit
5. 从 `in_progress` 或第一个 `pending` 任务继续

### 遇到阻塞

- 在任务表对应行的 notes 列写明原因
- 状态改为 `blocked`
- 继续后续不依赖该任务的任务（如果有的话）
- 如果无法继续，更新 `blockers` 计数并停止
