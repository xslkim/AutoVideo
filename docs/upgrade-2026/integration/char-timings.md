# char-timings — 字级时间戳数据通路（集成事项）

任务负责人已完成的文件：
- `src/tts/timings.ts` — 新增 `CharTiming` / `AlignToken` 类型、`splitChars`、
  `estimateLineCharTimings` / `estimateCharTimings`（行内均匀估算）、
  `buildCharTimingsFromAlignment`（对齐结果映射回展示文本）、
  `fetchAlignHealth` / `requestLineAlignment`（align-tts 客户端）
- `src/cli/tts.ts` — Step 8b：合成后填充 `block.audio.charTimings`；
  环境变量 `AUTOVIDEO_CHAR_TIMINGS`（默认开，`off` 关闭）、
  `AUTOVIDEO_ALIGN_ENDPOINT`（默认 `http://127.0.0.1:8003`）、
  `AUTOVIDEO_ALIGN`（`off` 禁用对齐覆盖）；对齐服务健康检查一次 + 连续失败 3 次熔断
- `third_servers/align-tts/` — FunASR 强制对齐服务脚手架（server.py / install.sh /
  start.sh / README.md），默认端口 **8003**

## 1. schemas/script.schema.json（必须由集成 Agent 改，tts 已会写出该字段）

`audio` 对象的 `properties` 里追加（`additionalProperties: false` 不改，
所以不加这个定义的话带 charTimings 的 script.json 过不了 schema 校验）：

```json
"charTimings": {
  "type": "array",
  "description": "Char-level timings for karaoke subtitles (block-relative seconds). Filled by tts stage; uniform estimate by default, forced alignment when align-tts is reachable.",
  "items": {
    "type": "object",
    "required": ["lineIndex", "char", "startSec", "endSec"],
    "additionalProperties": false,
    "properties": {
      "lineIndex": { "type": "integer", "minimum": 0 },
      "char": { "type": "string", "minLength": 1 },
      "startSec": { "type": "number", "minimum": 0 },
      "endSec": { "type": "number", "minimum": 0 }
    }
  }
}
```

注意 `required` 保持 `["wavPath", "durationSec", "lineTimings"]` 不变（charTimings 可选）。

## 2. src/types/script.ts（类型定义同步）

`Block["audio"]` 加一个可选字段：

```typescript
  // Stage 2 fills
  audio?: {
    wavPath: string;
    durationSec: number;
    lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
    /**
     * 字级时间戳（逐字卡拉OK字幕用），块相对秒；可选。
     * 均匀估算兜底，align-tts 服务可达时被真实强制对齐覆盖。
     * 字符顺序与该行 narration.lines[lineIndex].ttsText 一致；
     * 不发音的字符（ASCII 括号、空白）为零时长。
     */
    charTimings?: { lineIndex: number; char: string; startSec: number; endSec: number }[];
  };
```

## 3. src/config/defaults.ts（可选；环境变量已够用）

当前全部走环境变量（见上），不破坏现有类型。若要把配置搬进配置文件，
建议在 `TtsConfig` 加可选字段并在 `src/cli/tts.ts` 里让配置优先于环境变量：

```typescript
export interface TtsCharTimingsConfig {
  /** 产出 audio.charTimings（默认 true）；false 等价于 AUTOVIDEO_CHAR_TIMINGS=off */
  enabled?: boolean;
  /** align-tts 强制对齐服务地址；默认 http://127.0.0.1:8003 */
  alignEndpoint?: string;
  /** 用真实对齐覆盖估算（默认 true）；false 只写估算 */
  align?: boolean;
}
// TtsConfig 里加：charTimings?: TtsCharTimingsConfig;
```

## 4. third_servers/README.md（服务矩阵登记）

服务依赖矩阵表加一行：

```markdown
| **FunASR align-tts** | 字级强制对齐（逐字卡拉OK字幕，可选） | `8003` | ⬜ 可选 | 环境变量 `AUTOVIDEO_ALIGN_ENDPOINT` |
```

目录表加一行：

```markdown
| [`align-tts/`](align-tts/) | FunASR 字级强制对齐 | 服务源码 `server.py` + 启动/安装脚本 |
```

「端口与健康检查约定」表加一行：

```markdown
| FunASR align-tts | `GET http://127.0.0.1:8003/health` → `{ "status": "ok" }`（模型加载中返回 503） |
```

## 5. third_servers/stop.sh（关停支持）

脚本头部注释与端口变量区加 `ALIGN_PORT`（默认 8003），并把它纳入
「停止全部」与按名停止（建议名字 `align`）的分支。

## 6. 消费方契约（给 karaoke 字幕/组件任务的 Agent）

`audio.charTimings` 数据形态：

- 扁平数组，按行序 + 行内字序排列；`lineIndex` 挂回 `narration.lines[lineIndex]`
- `startSec` / `endSec` 是**块相对秒**（与 `lineTimings` 的 ms 除以 1000 同一时钟）；
  Remotion 组件里 `char.startSec * fps` 即入场帧
- `char` 顺序与该行 `ttsText` **逐字符一致**（含标点）；ASCII 括号与空白是
  零时长（startSec === endSec，锚在前一字末尾），karaoke 高亮应跳过它们
- 字段可能缺失（`AUTOVIDEO_CHAR_TIMINGS=off` 或旧产物）——消费方必须做
  `charTimings ?? fallback`（回退到行级 lineTimings 高亮）
- 数据来源有两种：均匀估算（默认兜底）与 align-tts 强制对齐（服务可达时），
  产物中**不标注来源**；两者字段契约完全一致
