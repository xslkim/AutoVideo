# AutoVideo Agent 使用说明

> `agent.py` 是一个 Python 脚本，调用 Claude API（tool use）自动实现 TASKS.md 中定义的所有开发任务。

## 快速开始

```bash
# 1. 安装依赖（已完成）
pip3 install anthropic

# 2. 直接运行（API 配置自动从 Claude Code 读取）
cd /home/ubuntu/AutoVideo
python3 agent.py

# 3. 推荐先试跑 3 个任务
python3 agent.py --max-tasks 3 --verbose
```

**不需要手动设置 API key** — 脚本自动从 `~/.claude/settings.json` 读取：
- `ANTHROPIC_AUTH_TOKEN` → API key
- `ANTHROPIC_BASE_URL` → 代理地址
- `ANTHROPIC_MODEL` → 模型名

如果想覆盖，设置环境变量即可：
```bash
export ANTHROPIC_API_KEY=your-key
export ANTHROPIC_BASE_URL=https://...
```

## 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--start-task T0.1` | 自动（从 PROGRESS.md 判断） | 从指定任务开始 |
| `--stop-task T1.5` | 无 | 完成指定任务后停止 |
| `--max-tasks 5` | 无限制 | 本次最多完成 N 个任务 |
| `--max-iters 80` | 50 | 每个任务最大迭代次数 |
| `--max-retries 3` | 2 | 任务失败后最大重试次数 |
| `--model glm-5.1` | 自动（从 Claude Code 读取） | 覆盖模型 |
| `--dry-run` | — | 只显示计划，不执行 |
| `-v / --verbose` | — | 显示每次工具调用的详细信息 |

## 工作流程

```
agent.py 启动
    │
    ├── 读取 ~/.claude/settings.json → 获取 API key / base URL / model
    ├── 读取 PROGRESS.md → 找到第一个 pending 或 in_progress 的任务
    │
    └── 对每个任务循环:
         │
         ├── 1. 更新 PROGRESS.md → in_progress
         ├── 2. git commit (chore(Tx.y): start)
         ├── 3. 构建 prompt:
         │       - 任务描述（从 TASKS.md 提取）
         │       - PRD 全文
         │       - 当前项目文件树
         │
         ├── 4. Claude tool-use 循环（最多 50 轮）:
         │       Claude 用 6 个工具自主实现:
         │       - create_file  → 创建/覆盖文件
         │       - edit_file    → 精确替换文件内容
         │       - read_file    → 读取文件
         │       - run_command  → 运行 shell 命令（npm install, tsc, 测试等）
         │       - list_dir     → 列出目录
         │       - grep         → 搜索代码
         │
         ├── 5. Agent 自行跑验收测试
         ├── 6. 验收通过 → 回复 "TASK COMPLETE"
         │
         ├── 成功:
         │   ├── 更新 PROGRESS.md → done
         │   ├── git commit (feat + chore)
         │   └── 进入下一个任务
         │
         └── 失败:
             ├── 重试（默认 2 次，每次重新开始 agent 循环）
             ├── 连续 3 个任务失败 → 自动停止
             └── 标记 blocked，输出原因
```

## 常用命令

```bash
# 从头开始
python3 agent.py --start-task T0.1

# 只跑 T0.1 ~ T0.3（项目初始化阶段）
python3 agent.py --start-task T0.1 --stop-task T0.3 -v

# 跑 compile 阶段（T1.1 ~ T1.5）
python3 agent.py --start-task T1.1 --stop-task T1.5 -v

# 中断后恢复（自动从 PROGRESS.md 读取进度）
python3 agent.py

# 干跑（看看会做什么，不实际执行）
python3 agent.py --dry-run

# 只跑 1 个任务（适合调试某个任务）
python3 agent.py --start-task T0.1 --max-tasks 1 -v

# 复杂任务用更多迭代
python3 agent.py --start-task T1.5 --max-tasks 1 --max-iters 80 -v
```

## 中断与恢复

脚本设计为可随时中断（Ctrl+C）并从断点恢复：

1. 中断后检查 `git status`，可能有未提交的中间产物
2. 重新运行 `python3 agent.py`，会从 PROGRESS.md 中第一个 `pending` 或 `in_progress` 的任务继续
3. 如果某个任务被标记为 `in_progress` 但实际没有有效产出，可以：
   ```bash
   # 丢弃中间产物重来
   git checkout .
   python3 agent.py --start-task T0.1
   ```

## 输出

- **PROGRESS.md** — 实时更新任务状态（pending → in_progress → done / blocked）
- **git log** — 每个任务有 3 个 commit：
  - `chore(Tx.y): start` — 任务开始
  - `feat(Tx.y): 标题` — 代码实现
  - `chore(Tx.y): done` — 任务完成
- **终端** — 运行结束时显示 token 用量和费用估算

## 费用估算

使用 Sonnet 定价（$3/M input, $15/M output）估算：

| 阶段 | 任务数 | 预估 tokens | 预估费用 |
|------|--------|------------|---------|
| T0.x 项目初始化 | 3 | ~200K | ~$3 |
| T1.x compile | 5 | ~800K | ~$12 |
| T2.x 缓存 | 2 | ~400K | ~$6 |
| T3.x TTS | 5 | ~1M | ~$15 |
| T4.x visuals | 5 | ~1.5M | ~$25 |
| T5.x Remotion | 4 | ~800K | ~$12 |
| T6.x render | 7 | ~2M | ~$30 |
| T7-T9 后续 | 7 | ~1.5M | ~$25 |
| **总计** | **38** | **~8M** | **~$128** |

实际费用取决于模型（GLM vs Claude）和代理定价。

## 注意事项

1. **必须先 git commit 当前改动** — 脚本启动前检查工作树是否干净
2. **每个任务独立 commit** — 可以安全回滚到任意任务
3. **某些任务需要真实环境** — T3.x 需要 VoxCPM 服务，T6.x 需要 Chromium。这些任务可能需要在 agent 跑完后手动验收
4. **建议先 `--max-tasks 3` 试跑** — 确认生成质量后再全量跑
5. **verbose 模式日志量大** — 正常跑不用 `-v`，调试时加
