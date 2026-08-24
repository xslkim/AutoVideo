# AutoVideo Agent 总入口

> **本文档面向所有 AI Agent**：先在这里搞清楚自己负责哪一步，然后跳转到对应的子文档。

AutoVideo 把 Markdown 教学脚本编译成 MP4 视频，全流程由 AI 驱动：
**Claude AI** 生成视觉组件、**VoxCPM2 / Fun-CosyVoice3**（`tts.provider` 可切换）生成旁白音频、**Remotion** 渲染视频。

---

## 制作视频的两个步骤

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ 步骤 1：编写输入资源      │        │ 步骤 2：构建生成视频      │
│ ────────────────────     │        │ ────────────────────     │
│ 产出：meta.md            │  ───►  │ 输入：meta.md            │
│       script.md          │        │       script.md          │
│                          │        │ 产出：final.mp4          │
│ 文档：AUTHORING.md       │        │ 文档：BUILD.md           │
└──────────────────────────┘        └──────────────────────────┘
```

| 你的任务 | 看哪个文档 |
|----------|-----------|
| **要写 / 修改 `meta.md` 或 `script.md`**（设计视频内容、视觉、旁白） | 📄 [`AUTHORING.md`](AUTHORING.md) |
| **要把已有的 `meta.md` + `script.md` 编译成 MP4**（执行构建命令） | 📄 [`BUILD.md`](BUILD.md) |
| **要同时承担两个步骤** | 先看 `AUTHORING.md`，再看 `BUILD.md` |

---

## 项目目录约定

每个视频项目放在 `project/<ProjectName>/` 下：

```
AutoVideo/
├── AGENTS.md                     # ← 你正在看的总入口
├── AUTHORING.md                  # ← 步骤 1 文档
├── BUILD.md                      # ← 步骤 2 文档
├── bin/autovideo.ts              # CLI 入口
├── src/                          # 工具链源码
├── remotion/                     # Remotion 渲染配置
├── templates/                    # 项目模板
├── B00.wav                       # 默认参考音色
└── project/                      # 视频项目目录
    └── MicroGpt/                 # 一个示例项目
        ├── meta.md               # ← 步骤 1 产出
        ├── part1.md              # ← 步骤 1 产出（可拆分）
        ├── project.json          # 自动生成
        ├── build-part1.sh        # 步骤 2 用的脚本
        └── build/                # 步骤 2 产出（在项目目录内，不是 AutoVideo 根目录）
            └── <slug>/output/final_normalized.mp4   # ★ 最终视频
```

---

## 管线架构（精简）

便于排错和理解流程。

### 四阶段流水线

```
Markdown → compile → TTS → visuals → render → MP4
                ↓       ↓       ↓        ↓
          script.json  WAV     TSX    partials
                                       ↓
                          ffmpeg concat + loudnorm
                                       ↓
                          final_normalized.mp4
```

| 阶段 | 输入 | 输出 | 说明 |
|------|------|------|------|
| **compile** | `project.json` + Markdown | `script.json` | 解析、校验、资产哈希复制 |
| **tts** | `script.json`（旁白） | `public/audio/<BXX>.wav` | 逐行合成（voxcpm 走行级延续链 / cosyvoice 固定参考音 zero-shot），QA 门检测爆音/静音/时长异常并自动换 seed 重 roll；逐行响度对齐 + 标点分级静音 |
| **visuals** | `script.json`（视觉描述） | `src/blocks/<BXX>/Component.tsx` | 组装优先：Claude 从预制组件库（`remotion/library/`）选组件填 JSON spec，机械生成 wrapper；无合适组件才回退自由生成 TSX。沙盒校验 |
| **render** | `script.json` + 组件 + 音频 | `output/final_normalized.mp4` | Remotion 渲染分块 → ffmpeg 拼接 → loudnorm |

### 中间表示 `script.json`

所有阶段读写同一份 `script.json`（按字段递增填充）：

```typescript
interface Script {
  meta: { title, aspect, width, height, fps, theme, ... };
  blocks: Block[];
  assets: Record<string, string>;
  artifacts: { compiledAt, audioGeneratedAt, visualsGeneratedAt, renderedAt };
}

interface Block {
  id: string;            // "B01"
  title: string;
  enter: AnimationPreset;
  exit: AnimationPreset;
  visual: { description, componentPath? };       // visuals 阶段补 componentPath
  narration: { lines: NarrationLine[] };
  audio?: { wavPath, durationSec, lineTimings }; // tts 阶段补
  timing?: { enterSec, holdSec, exitSec, frames }; // render 阶段补
  render?: { partialPath, cacheHit };              // render 阶段补
}
```

### 缓存机制

三类缓存，按内容哈希作为 key，**统一存放在配置 `cache.dir`（默认 `~/.autovideo/cache`），CLI 与 Web 共用同一份**：

| 类型 | Key | 内容 |
|------|-----|------|
| `audio` | 旁白文本哈希 + 音色配置 | WAV 文件 |
| `component` | 视觉描述哈希 + 模型版本 | TSX 文件 |
| `partial` | 组件哈希 + 音频哈希 + 主题 + 尺寸 + 运行时库哈希 | MP4 文件 |

修改任一块的旁白或视觉描述只会重跑该块；其他块复用缓存。

---

## 前置依赖与诊断

- **Node.js 20+**
- **Python 3.10+** + **VoxCPM2** 或 **Fun-CosyVoice3**（TTS 服务，`tts.provider` 选择，见 `third_servers/README.md`）
- **ffmpeg 5.0+**
- **Claude API key**：`ANTHROPIC_API_KEY` 环境变量，或 `~/.claude/settings.json`

```bash
npx tsx bin/autovideo.ts doctor   # 一键检查环境
```

---

## 开发者备注（非 Agent 必读）

- TypeScript 用 branded 类型在编译期保证阶段顺序：`CompiledScript` → `AudioReadyScript` → `VisualReadyScript` → `RenderInputScript` → `RenderedScript`
- 视觉组件在子进程沙盒（PATH/HOME/LANG 白名单 + 可选 `prlimit` / `unshare -n`）中校验
- `remotion/library/` 预制组件库由 `src/render/sync-runtime.ts` 在 visuals / render / preview 三阶段自动同步进 build 目录；生成组件经 `../../../remotion/library` 相对路径引用；partial 渲染缓存混入 `libraryHash`，库代码变更自动失效旧分块
- Remotion 渲染分两种入口：`src/render/root-render.ts`（程序化渲染）与 `src/preview/root-preview.ts`（Studio 预览）
- 仓库总体目录：`bin/`、`src/`、`remotion/`、`templates/`、`schemas/`、`tests/`
- 历史开发任务跟踪见 `docs/archive/`（CLI / Web / Lipsync 的 PRD / TASKS / PROGRESS，均已完工）

---

## License

MIT
