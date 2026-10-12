# tts-emotion 集成笔记（TTS 情感控制与多 provider）

本任务已落地的文件（均已验证 `npm run build` + `tests/tts` 99 测试通过）：

- `src/tts/provider.ts` — `TtsProvider.speak` options 新增 per-call `instruct?: string`；
  `CosyVoiceProvider` 支持默认 instruct（配置字段或 `COSYVOICE_INSTRUCT` 环境变量）；
  新增 `IndexTtsConfig` / `IndexTtsProvider`（provider 名 `"indextts"`）/ 内联
  `IndexTtsClient` / `resolveIndexTtsConfig()` / `resolveProviderSection()`；
  `TtsProviderName` 扩为 `"voxcpm" | "cosyvoice" | "indextts"`。
- `src/tts/cosyvoice-client.ts` — `CosyVoiceSpeakOptions.instruct?`，非空才出现在
  `/v1/speech` 请求体（旧 server 与精确 body 断言不受影响）。
- `third_servers/cosyvoice-tts/server.py` — `SpeechRequest.instruct`（默认 `""`）；
  prompt 特征按 (voice, instruct) 变体分键缓存（`_spk_id_for`）；instruct 非空时
  折进确定性 seed；空 instruct 行为与旧版逐字节一致。README 已更新。
- `src/tts/pronounce.ts` — 新增拼音标注模式（默认关）：`PronunciationApplyMode`、
  `resolvePronunciationMode()`（env `AUTOVIDEO_PRONOUNCE_PINYIN`）、
  `parsePinyinSyllable()` / `isPinyinReplacement()`（均已导出）、
  `applyPronunciation(text, rules, { mode })`。拼音 RHS 生成 CosyVoice3 hotfix
  标签（`给予 => ji3 yu3` → `[j][ǐ][y][ǔ]`，与上游 example.py 的
  `报道[j][ǐ]予` 格式一致）；纯文本 RHS 行为不变；regex 规则恒为替换。
- `third_servers/indextts-tts/` — `server.py`（FastAPI，端口 8004，emotion
  自然语言描述 + duration_factor 语速 + 参考音频克隆）、`install.sh`、`start.sh`、
  `README.md`。纯脚手架，未真装模型。

以下共享文件改动需要集成 Agent 完成。

## 1. `src/config/defaults.ts`

`CosyVoiceConfig` 加可选字段（紧跟 `speed` 之后即可）：

```ts
  /**
   * CosyVoice3 instruct: natural-language emotion/style instruction applied
   * to every line (e.g. "请耐心讲解"). When set, it joins the audio cache key.
   * Per-line overrides via speak options.instruct; env fallback:
   * COSYVOICE_INSTRUCT.
   */
  instruct?: string;
```

`TtsConfig.provider` 放宽：

```ts
  provider: "voxcpm" | "cosyvoice" | "indextts";
```

新增 `IndexTtsConfig`（可直接从 `src/tts/provider.ts` 的同名导出 re-export，
避免两处定义漂移）：

```ts
// 在 defaults.ts 顶部 import type { IndexTtsConfig } from "../tts/provider.js";
// 或照抄 provider.ts 中的接口定义。

export interface AutoVideoConfig {
  // ...existing...
  cosyvoice: CosyVoiceConfig;
  /** IndexTTS-2.5 service (optional; only needed when tts.provider = "indextts") */
  indextts?: IndexTtsConfig;
}
```

`DEFAULT_CONFIG` 可选地加（不加也能跑，`resolveIndexTtsConfig` 有 env/默认值兜底）：

```ts
  indextts: {
    endpoint: process.env.INDEXTTS_ENDPOINT ?? "http://127.0.0.1:8004",
    modelDir: process.env.INDEXTTS_MODEL_DIR ?? "/path/to/IndexTTS-2.5",
    emotion: process.env.INDEXTTS_EMOTION,
    durationFactor: 1.0,
    seedSalt: "",
    concurrency: 1,
  },
```

注意：若 `AutoVideoConfig.indextts` 设为必选则 `DEFAULT_CONFIG` 必须加段，且
`config/load.ts` 的合并逻辑要确认 optional 段不被覆盖丢失——建议保持 optional。

## 2. `server/routes/system.ts`（web 端）

- `PUT /api/config` 的 provider 白名单：`['voxcpm', 'cosyvoice']` →
  `['voxcpm', 'cosyvoice', 'indextts']`，报错文案同步。
- `POST /api/config/test` 的 service 白名单加 `'indextts'`，并在 switch 里补
  连通性分支（可参考 cosyvoice 分支，健康检查就是 `GET {endpoint}/health`）。
- web 设置面板（`web/src/`）的 TTS provider 下拉/配置表单如按 provider 枚举渲染，
  需加 indextts 项（字段：endpoint / modelDir / emotion / durationFactor / seedSalt）。

## 3. `src/cli/tts.ts`

- 第 156 行 `providerCfg` 改为统一解析（helper 已在 provider.ts 导出）：

```ts
import { createTtsProvider, resolveProviderSection, TtsProviderError } from "../tts/provider.js";
const providerCfg = resolveProviderSection(config);
```

- 行级 instruct 接线（可选，需要 narration 行携带情感指令时）：在两次
  `provider.speak(spoken, voiceId, {...})` 调用点传
  `instruct: (line as { instruct?: string }).instruct`。**注意缓存键**：
  per-call instruct 不在 `cacheDescriptor()` 里（与 salt 同契约），行级 instruct
  必须折进 audio cache key，否则换 instruct 会命中旧音频——建议把
  `cacheKey.ttsText` 改为 `instruct ? `${instruct}\n${spoken}` : spoken`，或给
  `AudioKey` 加 `instruct` 字段。

## 4. `schemas/script.schema.json`（行级 instruct 的中间表示，如启用 §3 接线）

`NarrationLine` 增加可选字段：

```json
"instruct": {
  "type": "string",
  "description": "Per-line emotion/style instruction passed to the TTS engine (CosyVoice3 instruct / IndexTTS emotion). Overrides the provider-level default for this line only."
}
```

narration.md 的 authoring 语法（如行内 `@instruct 强调` 或 HTML 注释）属于
parser/compile 域，需与 parser 负责人对齐后实现；schema 字段先行即可。

## 5. `src/tts/lint.ts`（拼音模式下消除误报）

拼音 RHS（如 `给予 => ji3 yu3`）含数字，会触发 `lintDictReplacements` 的
「RHS 含数字/符号」警告。该模式下拼音 RHS 不经 wetext 变形（标签是引擎原生
token），应跳过：

```ts
import { applyPronunciation, isPinyinReplacement, resolvePronunciationMode, type PronunciationRule } from "./pronounce.js";

// lintDictReplacements 循环内：
if (resolvePronunciationMode() === "pinyin" && isPinyinReplacement(rule.replacement)) continue;
```

## 6. `third_servers/README.md` 与 `third_servers/stop.sh`

README 服务表格加一行：`| indextts-tts | IndexTTS-2.5 | 8004 | 音色克隆+情感描述+语速 |`（措辞随表格格式）。

`stop.sh`：

```bash
INDEXTTS_PORT="${INDEXTTS_PORT:-8004}"
# targets 默认值改为: (tts t2i lipsync cosy indextts)
# case 加: indextts|index)  stop_one "IndexTTS TTS"  "$INDEXTTS_PORT"  || rc=1 ;;
# 用法注释与端口列表注释同步加 INDEXTTS_PORT(8004)
```

## 7. `autovideo.config.example.json`

```json
  "indextts": {
    "endpoint": "http://127.0.0.1:8004",
    "modelDir": "/path/to/IndexTTS-2.5",
    "emotion": "平静耐心地讲解",
    "durationFactor": 1.0,
    "seedSalt": "",
    "concurrency": 1
  }
```

`cosyvoice` 段示例可加 `"instruct": "请耐心讲解"`（可选字段，省略即默认）。

## 8. `docs/guidelines/AUTHORING.md` §4.5（发音词典文档）

默认行为不变，无需立刻改；如要公开拼音模式，建议在 §4.5 末尾补：

> **拼音标注模式（CosyVoice3 专用，默认关）**：设 `AUTOVIDEO_PRONOUNCE_PINYIN=1`
> 后，RHS 为纯拼音的规则改为生成引擎原生 hotfix 标签而非替换同音字：
> `给予 => ji3 yu3`（每字一个音节，声调数字 1–5 或声调符号均可）。字幕仍保持
> 原文。仅 CosyVoice3 识别该标签，其他引擎请勿开启。

## 9. 建议新增的测试（tests/tts/ 不属本任务范围，代码可直接照抄）

```ts
// tests/tts/pronounce-pinyin.test.ts
import { describe, it, expect } from "vitest";
import { applyPronunciation, parsePronunciationDict, isPinyinReplacement } from "../../src/tts/pronounce.js";

describe("pinyin mode", () => {
  const rules = parsePronunciationDict("给予 => ji3 yu3\n回调 => hui2 diao4\nFoo => 富\n");
  it("annotates pure-pinyin RHS as CosyVoice3 hotfix tags", () => {
    expect(applyPronunciation("对报道给予好评", rules, { mode: "pinyin" }))
      .toBe("对报道[j][ǐ][y][ǔ]好评");
    expect(applyPronunciation("注册回调", rules, { mode: "pinyin" }))
      .toBe("注册[h][uí][d][iào]");
  });
  it("keeps plain-text RHS as replacement in pinyin mode", () => {
    expect(applyPronunciation("用 Foo", rules, { mode: "pinyin" })).toBe("用 富");
  });
  it("default mode treats pinyin RHS as literal text (backward compat)", () => {
    expect(applyPronunciation("给予", rules)).toBe("ji3 yu3");
  });
  it("rejects syllable/character count mismatch", () => {
    const bad = parsePronunciationDict("给予 => ji3\n");
    expect(() => applyPronunciation("给予", bad, { mode: "pinyin" }))
      .toThrow(/1 syllable.*2 character/);
  });
  it("isPinyinReplacement", () => {
    expect(isPinyinReplacement("ji3 yu3")).toBe(true);
    expect(isPinyinReplacement("G P U")).toBe(false);
    expect(isPinyinReplacement("回掉")).toBe(false);
  });
});
```

provider 侧建议补：`instruct` 进 `cacheDescriptor`（设值时）、per-call instruct
覆盖默认、`createTtsProvider` 对 `provider: "indextts"` 返回 `IndexTtsProvider`
（可参考现有 cosyvoice mock server 测试，把 `/v1/speech` body 断言为
`{ text, voice_id, seed_salt, emotion?, duration_factor? }`）。

## 遗留 / 风险

- **IndexTTS-2.5 Python 入口未实测**：`third_servers/indextts-tts/server.py` 中
  `_load_model()` 的 import 路径与 `_infer()` 的 `infer()` kwargs 标了
  `ADJUST IF NEEDED`，首装时需按实际发行版核对；`duration_factor` 目前走 sox
  tempo 后处理，若 2.5 原生支持时长控制应改用原生参数。
- **ttsfrd 与拼音标签**：拼音模式在 `normalize=true` 且引擎用 ttsfrd 前端时
  未验证（wetext 路径确认不破坏 `[...]` 标签——`remove_bracket` 只删全角括号）。
  建议拼音模式项目把 `cosyvoice.normalize` 保持默认并用 wetext。
- **行级 instruct 的 authoring 入口**（narration.md 语法 → parser → schema）
  未实现，需 parser/compile 负责人配合（§3/§4）。
- `web/src` 设置面板未检查 indextts 渲染分支（§2）。
