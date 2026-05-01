# AutoVideo 开发进度

> 这个文件由 AI agent 在每个任务**开始前**和**完成后**主动维护。中断恢复时，agent 必须**先读这个文件**，从第一个 `in_progress` 或 `pending` 的任务继续。

---

## 当前状态（agent 每次更新后修改这一节）

- **active_task**: `—`
- **last_updated**: `2026-05-01T11:20:00Z`
- **next_action**: `从 T0.1 开始`
- **completed**: `0 / 35`
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
| T0.1 | 仓库骨架 | pending | — | — | — | — |
| T0.2 | 类型定义 + Schema | pending | — | — | — | — |
| T0.3 | 配置 loader | pending | — | — | — | — |
| T1.1 | 项目文件 + meta 解析 | pending | — | — | — | — |
| T1.2 | 块解析 + directive | pending | — | — | — | — |
| T1.3 | 旁白预处理 | pending | — | — | — | — |
| T1.4 | 资产 hash 复制 | pending | — | — | — | — |
| T1.5 | compile 命令组装 | pending | — | — | — | — |
| T2.1 | 缓存 store | pending | — | — | — | — |
| T2.2 | cache CLI | pending | — | — | — | — |
| T3.1 | VoxCPM FastAPI wrapper | pending | — | — | — | — |
| T3.2 | voxcpm-client + autoStart | pending | — | — | — | — |
| T3.3 | ffmpeg helpers | pending | — | — | — | — |
| T3.4 | lineTimings 计算 | pending | — | — | — | — |
| T3.5 | tts 命令组装 | pending | — | — | — | — |
| T4.1 | prompt + 组件骨架 | pending | — | — | — | — |
| T4.2 | Claude SDK 调用 + prompt cache | pending | — | — | — | — |
| T4.3 | 子进程隔离工具 | pending | — | — | — | — |
| T4.4 | 验证（tsc + render smoke） | pending | — | — | — | — |
| T4.5 | visuals 命令组装 | pending | — | — | — | — |
| T5.1 | theme + 字体加载 | pending | — | — | — | — |
| T5.2 | SubtitleOverlay | pending | — | — | — | — |
| T5.3 | BlockFrame + animations | pending | — | — | — | — |
| T5.4 | BlockComposition（render 用） | pending | — | — | — | — |
| T6.1 | Root.tsx 生成器（render 模式） | pending | — | — | — | — |
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

---

## 验收记录（任务完成后追加，方便回溯）

> 每个 done 任务追加一段，格式如下：
>
> ### Tx.y — <标题> @ <commit-hash>
> - acceptance: <PRD/TASKS 中列出的验收项> → ✓ / ✗
> - artifacts: <生成的关键文件路径列表>
> - 备注：<可选>

（开发中由 agent 追加）

---

## 决策日志（遇到 PRD 模糊点时记录）

> 当 PRD 中某处描述模糊但 agent 自行决定继续（**不阻塞、不报告人类**）时，必须在这里记录决策。后续如果决策错了，可以按时间倒查。
>
> 格式：
>
> ### YYYY-MM-DD HH:MM | Tx.y
> - 模糊点：<引用 PRD 章节 + 描述>
> - 选择方案：<采纳的实现>
> - 备选方案：<未采纳的方案及原因>
> - 影响范围：<是否影响其他任务>

（开发中由 agent 追加）

---

## 阻塞 / 待决策（必须停下问人类的事项）

> 这里是**真正的阻塞点**：agent 没有合理 default、且乱猜会带来高代价（删测试 / 数据丢失 / 大量返工）的事。
>
> agent 写入这里后**必须停下当前任务**（status 改 `blocked`），等人类回应后再继续。
>
> 格式：
>
> ### YYYY-MM-DD HH:MM | Tx.y | <一句话标题>
> - 上下文：<当前在做什么、卡在哪>
> - 选项 A：<...> 利弊
> - 选项 B：<...> 利弊
> - agent 倾向：<A / B / 其他> 理由

（开发中由 agent 追加）

---

## 已知差异（实现与 PRD 的偏离）

> 实现过程中，如果发现某项必须偏离 PRD（如 PRD 描述的某 API 不存在、某做法不可行），在此记录，**同时**回到 PRD 修订相应章节。
>
> 格式：
>
> ### Tx.y | <章节> | <一句话差异>
> - PRD 原描述：<...>
> - 实际实现：<...>
> - 原因：<...>
> - PRD 是否同步更新：是 / 否（commit hash）

（开发中由 agent 追加）
