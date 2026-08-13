# AutoVideo — Claude Code 项目指令

## 项目概况

AutoVideo 将 Markdown 教学脚本编译为 MP4 视频：

```
Markdown → compile → TTS(VoxCPM2) → visuals(LLM 生成组件) → render(Remotion) → MP4
```

CLI 与 Web UI 均已完成，项目处于**持续优化迭代**阶段（无固定任务清单，按需求逐项改进）。
历史开发文档（CLI / Web / Lipsync 任务跟踪）在 `docs/archive/`，产品规格在 `docs/architecture/`。

## 代码地图

| 目录 | 内容 |
|------|------|
| `src/` | CLI 核心：四阶段管线（compile/tts/visuals/render） |
| `src/ai/agent/` | **AgentDriver 抽象层**：所有 LLM 调用的唯一入口（见下） |
| `server/` | Web 后端（Hono）：路由、任务队列、taskRunner |
| `server/services/configService.ts` | Web 配置**单一事实来源**（两个视图，见文件头注释） |
| `web/` | Web 前端（Vue 3 + Naive UI + Pinia） |
| `remotion/` | Remotion 渲染工程 |
| `third_servers/` | TTS / 文生图 / 口型同步服务部署 |

## AgentDriver 层（关键约定）

- 所有 LLM 调用（组件生成、视觉评审、dict suggest）必须走 `createAgentDriver(config)`，
  **不要**在调用点直接 new Anthropic SDK 或 spawn CLI。
- Provider：`anthropic-api`（含 DeepSeek/GLM 的 Anthropic 兼容端点）/ `claude-cli` / `opencode-cli`。
  legacy `useCLI: true` 兼容映射为 `claude-cli`。
- Provider 怪癖（thinking 参数、OAuth header、CLI flag、输出解析）封装在各 driver 内。
- CLI 调用统一带超时（`cliTimeoutMs`，默认 600s）；opencode 出错时退出码为 0，
  空 stdout 视为失败（详见 `opencode-cli.ts`）。

## 配置协议

- 配置分层（低→高）：`DEFAULT_CONFIG` → 仓库根 `autovideo.config.json` → 环境变量 →
  `.autovideo-web/config.json`（Web 设置面板，明文密钥，权限 600，已 gitignore）。
- server 端任何读配置的地方用 `configService`（`resolveWebConfig` 展示 / `resolveTaskConfig` 执行），
  不要自己合并。
- ETag 协议：GET 返回 `ETag: sha256:xxx`，PUT 需 `If-Match`，冲突 409。
- 所有 build 产物必须在 `project/{name}/build/{slug}/` 内；任务队列单线程 FIFO。

## 开发工作流

1. 改代码前先 `graphify query` 了解影响面（规则见 AGENTS.md）
2. 实现后运行验收命令（见下），全部通过再提交
3. 每个独立改动单独 commit，改完跑 `graphify update .`

## 提交规范

格式：`type(scope): 中文描述`（见 git log 风格），如：
- `feat(agent): provider 可配置`
- `fix(visuals): 增加横向边界检查规则`
- `refactor(server): 统一配置解析到 configService`

## 验收命令

```bash
npx tsc -p tsconfig.server.json --noEmit   # 类型检查 server + src
cd web && npx vue-tsc --noEmit             # 类型检查前端
npx vitest run                             # 全量测试（约 40s）
npm run dev:web                            # 联调（server :3030 + vite :5173）
npx tsx bin/autovideo.ts doctor            # 环境诊断
```

## 不要做

- 不要绕过 AgentDriver 直接调用 LLM SDK / CLI
- 不要在 server 里新写一份配置合并逻辑
- 不要把密钥写进日志（只允许 last4）
- 不要跳过验收命令
- 不要添加需求之外的功能
