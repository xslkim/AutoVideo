# AutoVideo

Markdown 教学脚本 → MP4 视频的自动化工具链。**Claude** 生成视觉组件,**VoxCPM2** 合成中文旁白,**Remotion** 渲染视频。

```
Markdown → compile → TTS → visuals → render → MP4
```

## 服务依赖

AutoVideo 通过 HTTP 调用若干 AI 服务。框架只连接 endpoint,**不负责启动服务**。

| 服务 | 用途 | 必需? | 部署指引 |
|------|------|--------|---------|
| **Claude API** | 视觉组件生成 / 评审 | ✅ | 设 `ANTHROPIC_API_KEY`,或用 `claude` CLI 登录 |
| **VoxCPM2** (TTS) | 旁白语音合成 | ✅ | [`third_servers/voxcpm-tts/`](third_servers/voxcpm-tts/) |
| **SenseNova-U1** | 文生图(image 视觉模式) | ⬜ | [`third_servers/sensenova-t2i/`](third_servers/sensenova-t2i/) |
| **MuseTalk** | 口型同步(avatar 模式) | ⬜ | [`third_servers/musetalk-lipsync/`](third_servers/musetalk-lipsync/) |

## 快速开始

### 1. 安装(Ubuntu 22.04+)

```bash
bash install.sh                      # 框架 + 全部服务
# 或仅框架: bash install.sh --skip-services
```

各服务的端口、健康检查与单独启动方式见 [`third_servers/README.md`](third_servers/README.md)。

### 2. 启动需要的服务

```bash
bash third_servers/voxcpm-tts/start.sh &           # TTS(必需)
# 可选:
bash third_servers/sensenova-t2i/start.sh &
bash third_servers/musetalk-lipsync/start.sh &
```

### 3. 创建并构建视频

```bash
npx tsx bin/autovideo.ts init my-video && cd my-video
# 编辑 meta.md / script.md(见 docs/AUTHORING.md)
npx tsx bin/autovideo.ts build project.json
# → build/<slug>/output/final_normalized.mp4
```

或用 **Web UI**:
```bash
npm run dev:web    # 后端 :3030 + 前端 :5173
```

## 命令

| 命令 | 说明 |
|------|------|
| `autovideo init <dir>` | 从模板创建项目 |
| `autovideo build <project.json>` | 一键:compile → tts → visuals → render |
| `autovideo compile` / `tts` / `visuals` / `render` | 单阶段执行 |
| `autovideo preview` | Remotion Studio 预览 |
| `autovideo doctor` | 环境与服务连通性诊断 |
| `autovideo cache [stats\|clean]` | 缓存管理 |

## 文档

| 文档 | 内容 |
|------|------|
| [`docs/AGENTS.md`](docs/AGENTS.md) | 总入口 + 管线架构概览 |
| [`docs/AUTHORING.md`](docs/AUTHORING.md) | 编写 `meta.md` / `script.md`(块语法、视觉描述) |
| [`docs/BUILD.md`](docs/BUILD.md) | 构建命令、故障排查 |
| [`third_servers/README.md`](third_servers/README.md) | 第三方服务部署 |
| [`CLAUDE.md`](CLAUDE.md) | 给 Claude Code 的项目指令 |
| [`docs/architecture/`](docs/architecture/) | 产品规格(PRD) |
| [`docs/archive/`](docs/archive/) | 历史开发文档(CLI / Web / Lipsync 任务跟踪) |

## 前置依赖

- **Ubuntu 22.04**(`install.sh` 目标平台)
- Node.js 20+、ffmpeg 5.0+
- Python 3.10+(TTS / SenseNova / MuseTalk 服务)
- **NVIDIA GPU(3090 / 4090)**——文生图与唇形同步需要;TTS 可 CPU 运行
- Claude API key

```bash
npx tsx bin/autovideo.ts doctor   # 一键检查
```

## 技术栈

- **CLI 核心**(`src/`):TypeScript + Commander,四阶段管线
- **Web 后端**(`server/`):Hono + @hono/node-server(import 复用 CLI)
- **Web 前端**(`web/`):Vue 3 + Vite + Naive UI + Pinia
- **渲染**(`remotion/`):Remotion

## License

MIT
