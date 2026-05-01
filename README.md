# AutoVideo

Markdown 教学脚本 → MP4 视频的自动化工具链。通过 Claude AI 生成视觉组件，VoxCPM2 生成旁白音频，Remotion 渲染视频。

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourname/AutoVideo.git
cd AutoVideo

# 一键安装依赖（Ubuntu 22.04+）
bash install.sh

# 或手动安装
npm install
```

### 创建项目

```bash
npx tsx bin/autovideo.ts init my-video
cd my-video
```

这会在 `my-video/` 下创建一个包含示例脚本的项目：

```
my-video/
  project.json       # 项目清单
  meta.md            # 视频元数据（标题、比例、主题）
  script.md          # 脚本内容（视觉描述 + 旁白）
  hero.png           # 示例图片资产
```

### 编辑脚本

编辑 `script.md`，每个 `>>>` 块定义一个视频片段：

```markdown
>>> 欢迎观看 #B01
@enter: fade-up

--- visual ---
屏幕中央显示大标题 "Hello World"，白色大字

--- narration ---
欢迎观看我的视频
这是一个 **重要** 的示例
```

- `--- visual ---`：视觉描述，由 Claude AI 生成 React 组件
- `--- narration ---`：旁白文本，由 VoxCPM2 生成语音
- `**粗体**` 标记的字词会在字幕中高亮显示

### 构建视频

```bash
# 一键构建（编译 → 语音 → 视觉 → 渲染）
npx tsx bin/autovideo.ts build project.json

# 或分步执行
npx tsx bin/autovideo.ts compile project.json
npx tsx bin/autovideo.ts tts build/my-video/script.json
npx tsx bin/autovideo.ts visuals build/my-video/script.json
npx tsx bin/autovideo.ts render build/my-video/script.json
```

### 预览

```bash
npx tsx bin/autovideo.ts preview build/my-video/script.json
```

打开 Remotion Studio，交互式预览每个视频片段。

## 命令

| 命令 | 说明 |
|------|------|
| `autovideo init <dir>` | 从模板创建新项目 |
| `autovideo build <project>` | 一键构建：compile → tts → visuals → render |
| `autovideo compile <project>` | 解析 Markdown → script.json |
| `autovideo tts <script>` | 生成旁白音频 |
| `autovideo visuals <script>` | AI 生成视觉组件 |
| `autovideo render <script>` | 渲染为 MP4 |
| `autovideo preview <script>` | 打开 Remotion Studio 预览 |
| `autovideo cache [action]` | 缓存管理（stats / clean） |
| `autovideo doctor` | 环境诊断 |

## 前置依赖

- Node.js 20+
- Python 3.10+ + VoxCPM2（TTS 服务）
- ffmpeg 5.0+
- Claude API key（`ANTHROPIC_API_KEY` 环境变量）

运行 `autovideo doctor` 检查环境是否就绪。

## 文档

- [输入格式参考](docs/INPUT_SPEC.md) — project.json、meta.md、块语法
- [架构设计](docs/ARCHITECTURE.md) — 管线阶段、缓存、类型安全

## 开发

```bash
npm install        # 安装依赖
npm test           # 运行测试
npx tsc --noEmit   # 类型检查
```

## License

MIT
