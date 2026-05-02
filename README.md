# AutoVideo

Markdown 教学脚本 → MP4 视频的自动化工具链。
通过 **Claude AI** 生成视觉组件，**VoxCPM2** 生成旁白音频，**Remotion** 渲染视频。

```
Markdown → compile → TTS → visuals → render → MP4
```

---

## 给 AI Agent 使用

视频制作分两个步骤，每一步都有独立文档：

| 步骤 | 任务 | 文档 |
|------|------|------|
| **1. 编写输入资源** | 产出 `meta.md` + `script.md` | [`AUTHORING.md`](AUTHORING.md) |
| **2. 构建生成视频** | 用上述两个文件跑出 MP4 | [`BUILD.md`](BUILD.md) |

总入口与架构概览见 [`AGENTS.md`](AGENTS.md)。

最简短的一键构建：

```bash
cd /home/ubuntu/AutoVideo
npx tsx bin/autovideo.ts build project/MyVideo/project.json
# → build/<slug>/output/final_normalized.mp4
```

---

## 给开发者

### 安装

```bash
git clone https://github.com/yourname/AutoVideo.git
cd AutoVideo

# 一键安装依赖（Ubuntu 22.04+）
bash install.sh

# 或手动
npm install
```

### 创建项目

```bash
npx tsx bin/autovideo.ts init my-video
cd my-video
```

模板会创建 `project.json` / `meta.md` / `script.md` / `hero.png`。

### 常用命令

| 命令 | 说明 |
|------|------|
| `autovideo init <dir>` | 从模板创建新项目 |
| `autovideo build <project.json>` | 一键构建：compile → tts → visuals → render |
| `autovideo compile <project.json>` | 解析 Markdown → script.json |
| `autovideo tts <script.json>` | 生成旁白音频 |
| `autovideo visuals <script.json>` | AI 生成视觉组件 |
| `autovideo render <script.json>` | 渲染为 MP4 |
| `autovideo preview <script.json>` | 打开 Remotion Studio 预览 |
| `autovideo cache [stats\|clean]` | 缓存管理 |
| `autovideo doctor` | 环境诊断 |

完整命令选项、构建脚本、故障排查见 [`BUILD.md`](BUILD.md)；
输入文件规范、块语法、视觉描述写法见 [`AUTHORING.md`](AUTHORING.md)。

### 前置依赖

- Node.js 20+
- Python 3.10+ + VoxCPM2（TTS 服务）
- ffmpeg 5.0+
- Claude API key（`ANTHROPIC_API_KEY` 或 `~/.claude/settings.json`）

```bash
npx tsx bin/autovideo.ts doctor   # 检查环境
```

### 开发

```bash
npm install
npm test
npx tsc --noEmit
```

---

## 文档

视频生成相关（按 Agent 任务分工）：

- **[AGENTS.md](AGENTS.md)** — 总入口 + 管线架构概览
- **[AUTHORING.md](AUTHORING.md)** — 步骤 1：怎么写 `meta.md` / `script.md`
- **[BUILD.md](BUILD.md)** — 步骤 2：怎么把上述两个文件构建成 MP4

项目内部开发：

- **[AGENT_README.md](AGENT_README.md)** — `agent.py` 使用说明（自动开发 AutoVideo 本身的工具，与生成视频无关）
- **[PRD.md](PRD.md)** — 产品需求文档
- **[TASKS.md](TASKS.md)** / **[PROGRESS.md](PROGRESS.md)** — 开发任务跟踪

## License

MIT
