# AutoVideo 开发进度

> 这个文件由 AI agent 在每个任务**开始前**和**完成后**主动维护。中断恢复时，agent 必须**先读这个文件**，从第一个 `in_progress` 或 `pending` 的任务继续。

---

## 当前状态（agent 每次更新后修改这一节）

- **active_task**: `T6.1`
- **last_updated**: `2026-05-01T08:46:46Z`
- **next_action**: `implement T6.1`
- **completed**: `24 / 40`
- **blockers**: `0`

恢复检查清单（agent 启动时按顺序确认）：

1. [ ] 已读 `PRD.md` 全文
2. [ ] 已读 `TASKS.md` 全文
3. [ ] 已读本文件，确认 `active_task` 与 `next_action`
4. [ ] 已 `git status` 确认工作树干净（如有未提交改动，先决定是否丢弃/续上）
5. [ ] 已确认 `git log -1` 的 hash 与下表中最近一个 `done` 任务的 commit 一致

---

## 任务表

> 状态值：`pending` / `in_progress` / `done` / `blocked` / `skipped`  
> 修改方式：直接 StrReplace 改对应行的 status / commit / notes 列。

| ID | 标题 | 状态 | 开始 | 完成 | Commit | 备注 |
|----|------|------|------|------|--------|------|
| T0.1 | 仓库骨架 | done | — | 2026-05-01T04:03:26Z | 4bc6ac3 | — |
| T0.2 | 类型定义 + Schema | done | — | 2026-05-01T04:08:26Z | ebdce66 | — |
| T0.3 | 配置 loader | done | — | 2026-05-01T04:13:04Z | 75364b0 | — |
| T1.1 | 项目文件 + meta 解析 | done | — | 2026-05-01T04:57:56Z | 0b7c3c2 | — |
| T1.2 | 块解析 + directive | done | — | 2026-05-01T05:00:14Z | 6bddc2f | — |
| T1.3 | 旁白预处理 | done | — | 2026-05-01T05:02:26Z | ebf6311 | — |
| T1.4 | 资产 hash 复制 | done | — | 2026-05-01T05:10:20Z | 709d16c | — |
| T1.5 | compile 命令组装 | done | — | 2026-05-01T05:47:24Z | 6a8df59 | — |
| T2.1 | 缓存 store | done | — | 2026-05-01T06:00:17Z | cc79062 | — |
| T2.2 | cache CLI | done | — | 2026-05-01T06:18:18Z | 361b9ae | — |
| T3.1 | VoxCPM FastAPI wrapper | done | — | 2026-05-01T06:20:14Z | fa65353 | — |
| T3.2 | voxcpm-client + autoStart | done | — | 2026-05-01T06:22:34Z | 3e83d98 | — |
| T3.3 | ffmpeg helpers | done | — | 2026-05-01T06:24:11Z | fb3408d | — |
| T3.4 | lineTimings 计算 | done | — | 2026-05-01T06:25:13Z | 255e089 | — |
| T3.5 | tts 命令组装 | done | — | 2026-05-01T07:00:57Z | 8283f7f | — |
| T4.1 | prompt + 组件骨架 | done | — | 2026-05-01T07:03:14Z | 7fb2319 | — |
| T4.2 | Claude SDK 调用 + prompt cache | done | — | 2026-05-01T07:16:29Z | 4daad42 | — |
| T4.3 | 子进程隔离工具 | done | — | 2026-05-01T07:18:09Z | a2d5243 | — |
| T4.4 | 验证（tsc + render smoke） | done | — | 2026-05-01T07:36:56Z | 48a7566 | — |
| T4.5 | visuals 命令组装 | done | — | 2026-05-01T08:01:06Z | f445982 | — |
| T5.1 | theme + 字体加载 | done | — | 2026-05-01T08:08:35Z | 3ddfd09 | — |
| T5.2 | SubtitleOverlay | done | — | 2026-05-01T08:30:00Z | fecacf0 | — |
| T5.3 | BlockFrame + animations | done | — | 2026-05-01T08:32:43Z | 494f90c | — |
| T5.4 | BlockComposition（render 用） | done | — | 2026-05-01T08:46:37Z | 5be0da3 | — |
| T6.1 | Root.tsx 生成器（render 模式） | in_progress | 2026-05-01T08:46:46Z | — | — | — |
| T6.2 | timing 计算 | pending | — | — | — | — |
| T6.3 | partial 渲染（程序化 bundle + renderMedia） | pending | — | — | — | — |
| T6.4 | ffmpeg concat | pending | — | — | — | — |
| T6.5 | loudnorm two-pass | pending | — | — | — | — |
| T6.6 | 质量校验 | pending | — | — | — | — |
| T6.7 | render 命令组装 | pending | — | — | — | — |
| T7.1 | Root.tsx 生成器（preview 模式） | pending | — | — | — | — |
| T7.2 | preview 命令 | pending | — | — | — | — |
| T8.1 | build orchestrator | pending | — | — | — | — |
| T8.2 | doctor | pending | — | — | — | — |
| T8.3 | init + templates | pending | — | — | — | — |
| T9.1 | 单测补全 | pending | — | — | — | — |
| T9.2 | E2E 测试 | pending | — | — | — | — |
| T9.3 | install.sh | pending | — | — | — | — |
| T9.4 | 文档 | pending | — | — | — | — |