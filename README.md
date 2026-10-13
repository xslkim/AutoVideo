# AutoVideo

Markdown 教学脚本 → MP4 视频的自动化工具链,全流程以 **AI agent 操作**为第一场景(文档入口 [`docs/AGENTS.md`](docs/AGENTS.md)):**Agent 后端**(anthropic-api / claude / opencode / codex / kimi 五选一)生成视觉组件,**Fun-CosyVoice3** 合成中文旁白(**align-tts** 提供字级对齐),**Remotion** 渲染视频。

```
Markdown → compile → TTS → visuals → render → MP4
```

能力速览:20 个预制视觉组件库(组装优先,`remotion/library/`)、字幕三风格(teach / karaoke 逐字扫光 / hype)+ 字级时间戳、成片自动嵌入章节分段(YouTube/B站)、11 种块级动画预设、`@visual: aivideo` AI 文生视频模式、图片数字人(EchoMimic)与视频数字人(MuseTalk)双后端。

## 服务依赖

AutoVideo 通过 HTTP 调用若干 AI 服务。框架只连接 endpoint,**不负责启动服务**。

| 服务 | 用途 | 必需? | 部署指引 |
|------|------|--------|---------|
| **AI Agent** | 视觉组件生成 / 评审 | ✅ | 五选一:Anthropic 兼容 API(Claude / DeepSeek / GLM,设 `ANTHROPIC_API_KEY` + baseURL)、`claude` CLI、`opencode` CLI、`codex` CLI、`kimi` CLI(DeepSeek 官方端点 / GLM 走 OpenRouter,配 baseURL + apiKey)。Web 设置面板或 `autovideo.config.json` → `anthropic.provider` 配置 |
| **Fun-CosyVoice3** (TTS) | 旁白语音合成(默认底座,支持 instruct 情感指令 + ttsfrd 中文文本规整) | ✅ | [`third_servers/cosyvoice-tts/`](third_servers/cosyvoice-tts/) |
| **align-tts** (FunASR) | 字级强制对齐(逐字卡拉OK字幕,可纯 CPU) | ✅ 推荐 | [`third_servers/align-tts/`](third_servers/align-tts/) |
| **ComfyUI + Z-Image-Turbo** | 文生图(imageGen 默认 provider)/ 文生视频(aivideo 本地轨) | ✅ 推荐 | [`third_servers/comfyui/`](third_servers/comfyui/) |
| **EchoMimicV3-Flash** | 半身数字人(图片 avatar 模式;推理独占显存,用前停 ComfyUI) | ⬜ | [`third_servers/echomimic-avatar/`](third_servers/echomimic-avatar/) |
| **VoxCPM2** (TTS) | 旁白语音合成(历史底座) | ⬜ | [`third_servers/voxcpm-tts/`](third_servers/voxcpm-tts/) |
| **IndexTTS-2.5** (TTS) | 旁白语音合成(音色克隆 + 情感描述 + 语速) | ⬜ | [`third_servers/indextts-tts/`](third_servers/indextts-tts/) |
| **SenseNova-U1** | 文生图(替代 ComfyUI) | ⬜ | [`third_servers/sensenova-t2i/`](third_servers/sensenova-t2i/) |
| **GLM-Image** | 文生图(OpenAI 兼容 API,替代 ComfyUI) | ⬜ | [`third_servers/glm-image/`](third_servers/glm-image/) |
| **MuseTalk** | 口型同步(视频 avatar 模式) | ⬜ | [`third_servers/musetalk-lipsync/`](third_servers/musetalk-lipsync/) |

## 快速开始

### 1. 安装(Ubuntu 22.04+)

```bash
bash install.sh                      # 框架 + 推荐栈服务(CosyVoice3 / align-tts / ComfyUI)
# 或仅框架: bash install.sh --skip-services
# 加 --with-avatar 一并装 EchoMimic 数字人;更多开关见脚本头注释
```

各服务的端口、健康检查与单独启动方式见 [`third_servers/README.md`](third_servers/README.md)。

### 2. 启动需要的服务

```bash
# 推荐栈(本机默认配置):
bash third_servers/cosyvoice-tts/start.sh &        # TTS(必需)
bash third_servers/align-tts/start.sh &            # 字级对齐(逐字卡拉OK字幕,可纯 CPU)
bash third_servers/comfyui/start.sh &              # 文生图(imageGen 默认 provider)
# 可选:
bash third_servers/echomimic-avatar/start.sh &     # 数字人(图片 avatar;推理独占显存,用前 bash third_servers/stop.sh comfyui)
```

### 3. 创建并构建视频

```bash
npx tsx bin/autovideo.ts init my-video && cd my-video
# 编辑 meta.md / visuals.md / narration.md(见 docs/guidelines/AUTHORING.md)
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
| [`docs/guidelines/`](docs/guidelines/) | 编写 `meta.md` / `visuals.md` / `narration.md` 的唯一入口(格式规范 `AUTHORING.md` + 写作方法论) |
| [`docs/BUILD.md`](docs/BUILD.md) | 构建命令、故障排查 |
| [`third_servers/README.md`](third_servers/README.md) | 第三方服务部署 |
| [`CLAUDE.md`](CLAUDE.md) | 给 Claude Code 的项目指令 |
| [`docs/architecture/`](docs/architecture/) | 产品规格(PRD) |
| [`docs/archive/`](docs/archive/) | 历史开发文档(CLI / Web / Lipsync 任务跟踪) |

## 前置依赖

- **Ubuntu 22.04**(`install.sh` 目标平台)
- Node.js 20+、ffmpeg 5.0+
- Python 3.10+(TTS / SenseNova / MuseTalk 服务)
- **NVIDIA GPU(3090 / 4090)**——文生图与数字人需要;TTS / 字级对齐可 CPU 运行
- **Agent 后端凭证**:Anthropic 兼容 API 设 `ANTHROPIC_API_KEY`,或本地 CLI 已登录(claude / opencode / codex / kimi)

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
