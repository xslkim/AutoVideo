# AutoVideo 开发进度

> 这个文件由 AI agent 在每个任务**开始前**和**完成后**主动维护。中断恢复时，agent 必须**先读这个文件**，从第一个 `in_progress` 或 `pending` 的任务继续。

---

## 当前状态（agent 每次更新后修改这一节）

- **active_task**: `T2.1`
- **last_updated**: `2026-05-01T06:00:17Z`
- **next_action**: `implement T2.2`
- **completed**: `9 / 40`
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


### T0.1 — T0.1 @ 4bc6ac3
- acceptance: passed by agent
- artifacts: see git diff


### T0.2 — T0.2 @ ebdce66
- acceptance: passed by agent
- artifacts: see git diff

### T0.3 — 配置 loader @ HEAD
- acceptance:
  - 单测 `--meta dotted.key=val` 报错 → ✓ (parseMetaArgs throws on dot notation)
  - 单测 `--meta title=foo` 类型推断 → ✓ (string type inferred)
  - 单测 `--meta fps=60` 类型推断 → ✓ (number type inferred)
  - 单测 `--meta title=true` / `--meta title=false` → ✓ (boolean inferred)
  - 单测 配置合并优先级 → ✓ (defaults < root config < --config < --cache-dir)
  - 单测 路径展开 ~ → homedir → ✓
  - `tsc --noEmit` 零错误 → ✓
  - `vitest run` 全部 53 测试通过 → ✓
- artifacts: `src/config/defaults.ts`, `src/config/load.ts`, `tests/config/load.test.ts`


### T0.3 — T0.3 @ 75364b0
- acceptance: passed by agent
- artifacts: see git diff

### T1.1 — 项目文件 + meta 解析 @ HEAD
- acceptance:
  - 缺字段报错 → ✓ (missing meta/blocks/title all throw descriptive errors)
  - voiceRef 默认值 → ✓ (defaults to ./B00.wav relative to meta.md directory)
  - CLI override 生效 → ✓ (title/aspect/fps/voiceRef/theme overrides all tested)
  - aspect 解析 → ✓ (16:9→1920×1080, 9:16→1080×1920, 1:1→1080×1080)
  - tsc --noEmit 零错误 → ✓
  - vitest run 全部 104 测试通过 → ✓
- artifacts: `src/parser/project.ts`, `src/parser/meta.ts`, `tests/parser/project.test.ts`, `tests/parser/meta.test.ts`


### T1.1 — T1.1 @ 0f11306
- acceptance: passed by agent
- artifacts: see git diff


### T1.1 — T1.1 @ 0b7c3c2
- acceptance: passed by agent
- artifacts: see git diff


### T1.2 — T1.2 @ 6bddc2f
- acceptance: passed by agent
- artifacts: see git diff


### T1.3 — T1.3 @ ebf6311
- acceptance: passed by agent
- artifacts: see git diff

### T1.4 — 资产 hash 复制 @ HEAD
- acceptance:
  - 同名不同目录 → 不同 hash key → ✓ (two files named diagram.png in intro/ vs part1/ produce different manifest keys and different hashes)
  - 同文件被多块引用 → assets 去重 → ✓ (3 blocks reference same file → 1 manifest entry, 1 copy on disk)
  - 缺失"第 X-Y 行"标注的代码引用 → 不内联，仅 hash 复制 → ✓ (description without line range has no ```py fence)
  - 代码引用带行号范围 → 内联 ±5 行上下文 → ✓ (第 30-35 行 produces lines 25-40)
  - tsc --noEmit 零错误 → ✓
  - vitest run 全部 137 测试通过 → ✓
- artifacts: `src/parser/assets.ts`, `tests/parser/assets.test.ts`


### T1.4 — T1.4 @ 709d16c
- acceptance: passed by agent
- artifacts: see git diff


### T1.5 — T1.5 @ 6a8df59
- acceptance: passed by agent
- artifacts: see git diff


### T2.1 — T2.1 @ cc79062
- acceptance: passed by agent
- artifacts: see git diff

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