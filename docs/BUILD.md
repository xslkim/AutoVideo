# AutoVideo 视频构建指南

> **本文档专为执行视频构建的 AI Agent 编写**。
>
> 任务：输入一个已经准备好 `meta.md` + `script.md` 的工程目录，输出最终的 MP4 视频文件。
>
> **本文档不讲怎么写 `meta.md` / `script.md`**，那是 [`AUTHORING.md`](AUTHORING.md) 的内容。

---

## 0. 一分钟速览

```bash
# 输入：项目目录（已含 meta.md + script.md）
PROJECT_DIR=AutoVideo/project/MyVideo

# 一键构建（必须用 --out 把产物放到项目目录内）
cd AutoVideo
npx tsx bin/autovideo.ts compile $PROJECT_DIR/project.json \
  --out $PROJECT_DIR/build/$(basename $PROJECT_DIR)
# 之后 tts / visuals / render 会继续在同一目录内写产物

# 输出（在项目目录内，不是 AutoVideo 根目录）
# $PROJECT_DIR/build/<slug>/output/final_normalized.mp4
```

> ⚠️ **重要：构建产物必须放在项目目录内，不能放在 AutoVideo 根目录下。**
> 如果不加 `--out` 直接跑 `compile`，产物会落在当前工作目录（即 AutoVideo 根目录的 `build/`），导致路径混乱。
> **始终使用 `--out $PROJECT_DIR/build/<slug>` 或直接用项目目录下的构建脚本。**

完整构建流程内部依次跑四个阶段：

```
compile → tts → visuals → render
```

---

## 1. 输入要求与文件检查

构建前请确认项目目录满足以下条件（**不需要检查内容是否合理，只检查存在性 + 语法解析能否通过**）：

### 1.1 必须存在的文件

```
project/MyVideo/
├── meta.md              # 必须存在
├── script.md            # 必须存在（也可拆为 part1.md / part2.md ...）
└── (project.json)       # 可选；构建脚本会自动生成
```

快速检查：

```bash
PROJECT_DIR=AutoVideo/project/MyVideo
test -f "$PROJECT_DIR/meta.md"   && echo "OK: meta.md"   || echo "MISSING: meta.md"
test -f "$PROJECT_DIR/script.md" && echo "OK: script.md" || echo "MISSING: script.md (或 part*.md)"
```

### 1.2 验证语法（可选但推荐）

跑 `compile` 阶段就能验证 Markdown 语法是否合规——它只解析、不调外部服务：

```bash
cd AutoVideo

# 读取 meta.md 里的 slug 字段（或用项目名代替）
SLUG=my-video-slug   # 改成 meta.md 中的 slug 值

npx tsx bin/autovideo.ts compile $PROJECT_DIR/project.json \
  --out $PROJECT_DIR/build/$SLUG \
  --verbose
```

> ⚠️ 必须加 `--out $PROJECT_DIR/build/$SLUG`，否则 `script.json` 会写到 AutoVideo 根目录下的 `build/` 里。

如果输出中报错（缺 section、块 ID 重复、动画预设无效等），需要回到 [`AUTHORING.md`](AUTHORING.md) 修正源文件后再继续。

### 1.3 `voiceRef` 文件存在性

`meta.md` 中 `voiceRef` 字段指向的 WAV 文件必须存在（路径相对 `meta.md` 自身）：

```bash
# 简单检查（假设 voiceRef 是 ../../B00.wav）
test -f "$PROJECT_DIR/../../B00.wav" && echo "OK: voiceRef" || echo "MISSING: voiceRef"
```

---

## 2. 构建方式

### 2.1 方式一：项目自带构建脚本（推荐，可避免路径问题）

如果项目目录里有 `build*.sh`（如 `build-part1.sh`），直接跑即可：

```bash
cd $PROJECT_DIR
bash build.sh                        # 增量构建（命中缓存则复用）
bash build.sh --force                # 忽略缓存，强制重新生成
bash build.sh --dry-run              # 只打印命令，不实际执行
bash build.sh --cache-dir=./cache    # 指定缓存目录
```

构建脚本内部会自动：

1. 写入临时 `project.json`
2. 跑 compile → tts → visuals → render 四个阶段
3. **把所有产物输出到 `$PROJECT_DIR/build/<slug>/`**（在项目目录内）

> ✅ 推荐原因：脚本内部已正确设置 `BUILD_DIR` 为项目目录下的 `build/`，不会污染 AutoVideo 根目录。

参考脚本：[`project/MicroGpt/build-part1.sh`](project/MicroGpt/build-part1.sh)

### 2.2 方式二：CLI 一键构建

如果没有项目自带脚本，且已有 `project.json`：

```bash
cd AutoVideo
SLUG=my-video-slug   # 改成 meta.md 中的 slug 值

# ⚠️ 必须用 --out 把产物写到项目目录内
npx tsx bin/autovideo.ts build $PROJECT_DIR/project.json \
  --out $PROJECT_DIR/build/$SLUG
```

> ⚠️ **不要**用 `npx tsx bin/autovideo.ts build $PROJECT_DIR/project.json`（不加 `--out`），
> 这会把 `build/` 写在 AutoVideo 根目录，而不是项目目录里。

### 2.3 方式三：CLI 分步执行

需要逐阶段控制时使用：

```bash
cd AutoVideo
SLUG=my-video-slug   # 改成 meta.md 中的 slug 值

# ⚠️ BUILD 路径必须在 PROJECT_DIR 内
BUILD=$PROJECT_DIR/build/$SLUG

npx tsx bin/autovideo.ts compile $PROJECT_DIR/project.json --out $BUILD
npx tsx bin/autovideo.ts tts     $BUILD/script.json --block B01,B02,B03
npx tsx bin/autovideo.ts visuals $BUILD/script.json --block B01,B02,B03
npx tsx bin/autovideo.ts render  $BUILD/script.json --block B01,B02,B03
```

> ✅ 这样所有产物（`script.json`、WAV、TSX、MP4）都在 `$PROJECT_DIR/build/$SLUG/` 下，不影响根目录。

### 2.4 没有 `project.json` 时手动创建

如果项目里只有 `meta.md` + `script.md`，没有 `project.json`，可手动写一个：

```bash
cat > $PROJECT_DIR/project.json <<EOF
{
  "meta": "./meta.md",
  "blocks": ["./script.md"]
}
EOF
```

如果脚本拆成多个文件：

```json
{
  "meta": "./meta.md",
  "blocks": ["./part1.md", "./part2.md", "./part3.md"]
}
```

---

## 3. 完整命令列表

| 命令 | 说明 |
|------|------|
| `autovideo init <dir>` | 从模板创建新项目（含示例 `meta.md` / `script.md`） |
| `autovideo compile <project.json>` | 解析 Markdown → `script.json` |
| `autovideo tts <script.json>` | 生成旁白音频（VoxCPM2） |
| `autovideo visuals <script.json>` | Claude AI 生成视觉组件 |
| `autovideo render <script.json>` | 渲染为 MP4（Remotion） |
| `autovideo build <project.json>` | 一键：compile → tts → visuals → render |
| `autovideo quick-build <project.json>` | 快速预览构建：compile → tts → 占位文字卡片（不调 LLM/文生图/口型同步）→ render（crf 30 + veryfast），输出到 `build/<slug>-quick/` |
| `autovideo preview <script.json>` | 打开 Remotion Studio 交互预览 |
| `autovideo cache [stats\|clean]` | 缓存管理 |
| `autovideo doctor` | 环境诊断 |

所有命令都通过 `npx tsx bin/autovideo.ts <cmd>` 调用。

---

## 4. 常用选项

适用于 `tts` / `visuals` / `render` / `build`：

| 选项 | 说明 | 示例 |
|------|------|------|
| `--block B01,B02` | 只处理指定块 | `--block B01,B02,B03` |
| `--force` | 忽略缓存，强制重新生成 | `--force` |
| `--cache-dir <path>` | 指定缓存目录 | `--cache-dir ./cache` |
| `--out <path>` | 指定输出目录（仅 `compile`） | `--out build/my-video` |
| `--verbose` | 详细日志 | `--verbose` |
| `--dry-run` | 预演，不实际执行 | `--dry-run` |

---

## 5. 输出文件

> ⚠️ **所有构建产物必须在项目目录内**，不要放在 AutoVideo 根目录。

正确的目录结构（以 `project/MyVideo` 为例，`slug = my-video`）：

```
project/MyVideo/                         ← 项目目录（PROJECT_DIR）
├── meta.md
├── script.md
├── project.json
└── build/
    └── my-video/                        ← BUILD_DIR（= PROJECT_DIR/build/<slug>）
        ├── script.json                  # compile 产物
        ├── src/blocks/<BXX>/Component.tsx  # AI 生成的视觉组件
        ├── public/
        │   ├── audio/<BXX>.wav          # TTS 生成的语音
        │   └── script.json
        ├── remotion-root.tsx            # Remotion 入口
        └── output/
            ├── partials/<BXX>.mp4       # 每个块的独立视频
            ├── concat.txt
            ├── final.mp4
            └── final_normalized.mp4     # ★ 最终视频
```

**最终交付给用户的视频始终是** `$PROJECT_DIR/build/<slug>/output/final_normalized.mp4`。

`<slug>` 由 `meta.md` 中的 `slug` 字段决定（如未指定，则由 `title` 自动推导）。

**错误的结构（不应出现）**：

```
AutoVideo/              ← AutoVideo 根目录
├── build/              ← ❌ 构建产物不应在这里
│   └── my-video/
...
```

如果发现 `build/` 出现在根目录，说明构建时漏加了 `--out $PROJECT_DIR/build/$SLUG`。

---

## 6. 增量构建与缓存

### 6.1 缓存机制

三类缓存，按内容哈希作为 key：

| 类型 | Key | 内容 |
|------|-----|------|
| `audio` | 旁白文本哈希 + 音色配置 | WAV 文件 |
| `component` | 视觉描述哈希 + 模型版本 | TSX 文件 |
| `partial` | 组件哈希 + 音频哈希 + 主题 + 尺寸 | MP4 文件 |

修改某个块的旁白或视觉描述后，**只会重跑该块**；其他块复用缓存。

### 6.2 重跑某一个块

```bash
# BUILD 变量指向项目目录内的 build 路径
BUILD=$PROJECT_DIR/build/$SLUG

npx tsx bin/autovideo.ts visuals $BUILD/script.json --block B03 --force
npx tsx bin/autovideo.ts render  $BUILD/script.json --block B03 --force
```

### 6.3 整体重建

```bash
bash build.sh --force
# 或（注意 --out 不能省略）
npx tsx bin/autovideo.ts build $PROJECT_DIR/project.json \
  --out $PROJECT_DIR/build/$SLUG --force
```

### 6.4 清空缓存

```bash
npx tsx bin/autovideo.ts cache clean
```

---

## 7. 前置依赖与诊断

### 依赖

- **Node.js 20+**
- **Python 3.10+** + **VoxCPM2**（TTS 服务，需在后台运行；构建脚本可自动启动）
- **ffmpeg 5.0+**
- **Claude API key**：`ANTHROPIC_API_KEY` 环境变量，或 `~/.claude/settings.json`

### 一键诊断

```bash
npx tsx bin/autovideo.ts doctor
```

会检查 Node 版本、ffmpeg、TTS 服务连通性、API key、Chromium（Remotion 渲染需要）等。

---

## 8. 故障排查

| 现象 | 排查方向 |
|------|---------|
| `compile` 失败 | 源文件语法问题 → 让 Agent 按 [`AUTHORING.md`](AUTHORING.md) 修正 |
| 块 ID 冲突 | 多个文件中存在相同 `#BXX`，统一编号或省略让其自动递增 |
| `voiceRef` 找不到 | 检查 `meta.md` 中 `voiceRef` 路径（相对 `meta.md` 自身），WAV 文件是否存在 |
| `tts` 卡住 / 失败 | 确认 VoxCPM2 服务运行中（默认端口 `8000`），可 `curl http://127.0.0.1:8000/health` 验证 |
| `visuals` 反复重试 | Claude 生成的组件未通过沙盒校验；用 `--verbose` 看错误；可能需要回到 `AUTHORING.md` 让视觉描述更具体 |
| `render` 黑屏 / 时长异常 | 用 `autovideo preview` 在 Remotion Studio 单块调试 |
| 想重做某一块 | 见 §6.2 |
| 整体重建 | 见 §6.3 |
| `Chromium not found` | 安装 Remotion 所需的 Chromium：`npx remotion install` |
| `ANTHROPIC_API_KEY missing` | 设置环境变量或在 `~/.claude/settings.json` 中配置 |

---

## 9. 完整端到端示例（参考）

```bash
# 0. 设定项目目录（所有产物都应在这个目录内）
PROJECT_DIR=AutoVideo/project/MicroGpt
SLUG=microgpt-py-survival-guide        # 与 meta.md 中的 slug 保持一致
BUILD=$PROJECT_DIR/build/$SLUG         # ⚠️ 产物目录在项目目录内，不是根目录

# 1. 健全性检查
test -f "$PROJECT_DIR/meta.md"   && echo "OK: meta.md"   || echo "MISSING: meta.md"
test -f "$PROJECT_DIR/part1.md"  && echo "OK: part1.md"  || echo "MISSING: part1.md"

# 2. 验证语法（--out 指向项目目录内）
cd AutoVideo
npx tsx bin/autovideo.ts compile "$PROJECT_DIR/project.json" \
  --out "$BUILD" --verbose

# 3. 方式一：用项目脚本构建（脚本内已正确处理 BUILD_DIR）
bash "$PROJECT_DIR/build-part1.sh"

# 方式二：CLI 分步（手动控制时）
# npx tsx bin/autovideo.ts tts     $BUILD/script.json --verbose
# npx tsx bin/autovideo.ts visuals $BUILD/script.json --verbose
# npx tsx bin/autovideo.ts render  $BUILD/script.json --verbose

# 4. 确认产物在项目目录内
ls -lh "$BUILD/output/final_normalized.mp4"
# ✅ 正确路径：project/MicroGpt/build/microgpt-py-survival-guide/output/final_normalized.mp4
# ❌ 错误路径：build/microgpt-py-survival-guide/output/final_normalized.mp4（根目录下）
```

---

## 上一步

如需修改或重写 `meta.md` / `script.md`，请按 [`AUTHORING.md`](AUTHORING.md) 进行。
