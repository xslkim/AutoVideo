# TTS 调研对比报告

> 目标：为 AutoVideo 重构选定主力 TTS 引擎，解决中英混读卡顿问题
> 约束：接受云 API 付费，**优先本地部署**，无数据出境顾虑，男声，无需多说话人
> 调研时间：2026-04

---

## TL;DR

| 维度 | 推荐方案 |
|------|---------|
| **主力（本地）** | **CosyVoice 2-0.5B**（男声克隆 + 中英混读最佳开源方案） |
| **高质量兜底（云）** | **Azure zh-CN-YunyiMultilingualNeural**（按需调用，$16/1M 字符） |
| **最终兜底** | **edge-tts**（现状保留，零成本，保证流水线永远能跑通） |
| **不推荐** | ElevenLabs（贵 4-7 倍且中文非强项）、IndexTTS2（速度慢，更适合音色克隆场景） |

**路由策略**（默认）：
```
纯中文短句         → edge-tts（够用，免费）
中英混读 / 有代码术语 → CosyVoice 2（本地 GPU）
CosyVoice 不可用    → Azure Yunyi（云兜底）
Azure 不可用       → edge-tts（最终兜底）
```

---

## 一、问题陈述：edge-tts 为什么不够用

当前视频（`teaching-video-20260411-122634`）暴露的问题：

1. **句间停顿过长** — edge-tts 的已知缺陷，[issue #1777 (readest)](https://github.com/readest/readest/issues/1777) 和 [issue #136 (rany2/edge-tts)](https://github.com/rany2/edge-tts/issues/136) 都有记录。微软的 Edge 浏览器内核在每句话后重建音频上下文，造成长停顿。
2. **中英混排韵律断裂** — 遇到 `RMSNorm`、`softmax`、`∂loss/∂v` 之类的术语时，英文部分会被拆成单字母朗读或者突然变调。
3. **`**加粗**` 标记没有对应的声学强调** — 当前引擎完全忽略 Markdown 强调，重点词没有语气变化。
4. **SSML 控制受限** — 理论上能用 SSML 插入 `<break>`、`<emphasis>`，但 edge-tts 的 Python 封装对 SSML 支持不完整。

这些问题的共同根源是：edge-tts 不是一个可控 TTS，而是一个"Edge 浏览器朗读功能的协议逆向"——你得到的是一个现成的播报引擎，不是一个能精细调参的模型。

---

## 二、四个候选深度对比

### 2.1 CosyVoice 2（主推本地）

| 项目 | 详情 |
|------|------|
| **开发方** | 阿里通义 FunAudioLLM 团队 |
| **模型** | [FunAudioLLM/CosyVoice2-0.5B](https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B) |
| **参数量** | 0.5B（LLM 架构） |
| **许可证** | Apache 2.0（代码）+ 模型权重开源 |
| **语言覆盖** | 中文、英文、日文、韩文、粤语，**中英混读是核心卖点** |
| **VRAM** | **6-8 GB**（RTX 3060/3090/4090 均可） |
| **延迟** | **流式模式 150ms 首字** |
| **RTF** | < 0.3（3090 / 4090） |
| **加速** | TensorRT-LLM 可提速 4× |
| **韵律控制** | 支持 instruct 模式：`"用平静的播音腔说: ..."` |
| **零样本克隆** | 支持，3-10 秒 prompt 音频 |
| **部署方式** | Python 直接调用 / gRPC / FastAPI / Docker |

**为什么它适合我们**：

1. **中英混读是论文级第一梯队**——CosyVoice 2 的论文 [arxiv.org/abs/2412.10117](https://arxiv.org/abs/2412.10117) 明确把跨语言韵律列为主要评测项，[CosyVoice 2 demo page](https://funaudiollm.github.io/cosyvoice2/) 有 zh-en 混读样本，听感明显好于 edge-tts。
2. **可控性强**——支持 SSML-like 的 `<laughter>`、`<break>`、`<strong>` 标签，正好可以把我们 markdown 的 `**加粗**` 映射过去。
3. **离线运行**——训练视频素材不走网络，构建稳定。
4. **音色灵活**——我们可以用一段 10 秒的中文男声样本做零样本克隆，得到一个独家音色，不和任何 YouTube 视频"撞音"。

**风险**：
- 首次需要下载 ~2GB 模型权重
- 依赖 PyTorch + CUDA，Stage 0 需要增加一个"GPU 可用性检测"任务
- ComfyUI / gRPC 模式启动开销约 5-10 秒（一次启动，常驻即可）

**集成工作量**：中等。需要写一个 FastAPI 包装器常驻，Stage 2 通过 HTTP POST 调用。

---

### 2.2 Azure Speech（云兜底主力）

| 项目 | 详情 |
|------|------|
| **多语言神经声音** | `zh-CN-YunyiMultilingualNeural`（云逸）男声<br/>`zh-CN-YunxiaoMultilingualNeural`（云霄）男声<br/>`zh-CN-YunfanMultilingualNeural`（云帆）男声 |
| **定价（Neural）** | **$16 / 1M 字符**（标准神经）|
| **定价（Neural HD）** | $22 / 1M 字符（2026 年 3 月起下调）|
| **延迟** | 首字约 300-500ms（REST），长文本整体流式 |
| **SSML** | 完整支持（break / emphasis / prosody / phoneme）|
| **中英混读** | Multilingual 系列专为语言切换优化，**官方宣传强项** |

**按我们的视频预算估算**：
- 一个 10 分钟的视频大约 1500 中文字符
- 按 Neural 价格 = `1500 × $16 / 1,000,000 = $0.024`（约 ¥0.17）
- 即使全部走 Azure，**一个视频 2 毛钱**，可以忽略

**为什么它适合做云兜底**：

1. **零本地依赖**——没有 GPU 也能跑，CI 环境友好
2. **SSML 支持最完整**——`<emphasis level="strong">加粗</emphasis>` 直接映射
3. **`Multilingual` 系列专门优化中英切换**，是 4 个候选里唯一在官方文档里明确把"代码词汇插入中文句子"列为测试场景的
4. **SLA 稳定**——99.9% 可用性，企业级
5. **价格**可接受

**风险**：
- 需要 Azure 订阅 + `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` 环境变量
- 需要网络出口
- 音色三选一，不能自定义（但官方男声本身质量足够）

**推荐用法**：
- **默认声音**：`zh-CN-YunyiMultilingualNeural`（云逸，成熟稳重，接近当前 YunxiNeural 的调性）
- **备选**：`zh-CN-YunxiaoMultilingualNeural`（云霄，年轻有活力）

**集成工作量**：小。`azure-cognitiveservices-speech` Python SDK 开箱即用，SSML 模板化。

---

### 2.3 IndexTTS2（次选本地，不推荐作为主力）

| 项目 | 详情 |
|------|------|
| **开发方** | 哔哩哔哩开源（2025 年 9 月） |
| **模型** | [index-tts/index-tts](https://github.com/index-tts/index-tts) |
| **语言** | 中英（其他语言支持有限）|
| **VRAM** | **8 GB+**（推荐更多） |
| **速度** | [issue #585](https://github.com/index-tts/index-tts/issues/585) 报告：RTX 3060 12GB 上 **RTF ≈ 13**（生成 17 秒音频用了 227 秒）|
| **FP16** | 支持，速度提升、显存下降，质量损失小 |
| **独特优势** | **情感可控**（高兴/悲伤/愤怒独立于音色） |
| **情感克隆** | 情感 prompt 和音色 prompt 解耦 |
| **时长控制** | 可精确指定生成 token 数量 |

**为什么不推荐作为主力**：
- **速度是致命伤**——RTX 3060 上 RTF=13 意味着生成 1 秒音频要花 13 秒，在 4090 上可能降到 RTF≈2-3，仍然比 CosyVoice 2 慢一个数量级
- 我们的用途（教学旁白）对情感控制需求弱，不需要"悲伤+微笑"这种细粒度控制
- 中英混读质量和 CosyVoice 相当，没有压倒性优势

**适合的场景**（不是我们的场景）：
- 需要剧情配音、有情感起伏
- 需要精确音色克隆（IndexTTS2 的零样本克隆保真度略强于 CosyVoice 2）
- 时长卡帧对齐特别严格（它能精确指定 token 数）

**结论**：**留作备选**，不进入默认路由。如果用户未来需要"有情感"的视频（比如产品故事、悲情纪录片），可以打开。

---

### 2.4 ElevenLabs（不推荐）

| 项目 | 详情 |
|------|------|
| **模型** | Eleven Multilingual v2 / v3（Turbo 更快但质量略低） |
| **定价** | **$0.12 / 1k 字符 = $120 / 1M 字符**（Multilingual v2/v3）<br/>$0.06 / 1k 字符 = $60 / 1M 字符（Flash/Turbo） |
| **语言** | v3 支持 70+ 语言，含普通话 |
| **中文音色库** | 有限（相比英文） |

**为什么不推荐**：

1. **价格是 Azure 的 4-7 倍**——同样一个 10 分钟视频：
   - Azure Neural: $0.024
   - ElevenLabs v3: $0.18
   - 看起来都不贵，但规模化之后（100 个视频）差距就是 $2.4 vs $18
2. **中文不是强项**——ElevenLabs 的统治级优势在英文情感表达，中文虽然能跑，但和 Azure Multilingual / CosyVoice 相比听感没有明显胜出
3. **没有离线方案**，强依赖云
4. **男声音色库比 Azure 小**，而且很多是英文音色强行说中文，口音重

**结论**：**不纳入默认路由**。如果未来做英文或中英 1:1 混排的内容可以考虑，但目前不投入集成成本。

---

## 三、横向对比矩阵

| 维度 | CosyVoice 2 | Azure Yunyi | IndexTTS2 | ElevenLabs v3 | edge-tts（现状） |
|------|:-----------:|:-----------:|:---------:|:-------------:|:---------------:|
| **中英混读质量** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **自然度 MOS** | ~4.5 | ~4.6 | ~4.4 | ~4.5 | ~3.8 |
| **SSML/重音控制** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **速度 (RTF)** | 0.1-0.3 | 实时 | 2-13 | 实时 | 实时 |
| **离线部署** | ✅ | ❌ | ✅ | ❌ | ✅ |
| **GPU 需求** | 8GB | 无 | 8GB+ | 无 | 无 |
| **成本** | 0（自建）| $16/1M | 0（自建）| $120/1M | 0 |
| **音色克隆** | ✅ 零样本 | ❌ | ✅ 零样本 | ✅ 付费 | ❌ |
| **音色多样性** | 自定义 | 官方 3 男声 | 自定义 | 官方库大 | 官方 ~5 男声 |
| **集成难度** | 中 | 低 | 中 | 低 | 已集成 |
| **SLA / 稳定性** | 自担 | 99.9% | 自担 | 99.9% | 非官方 |

---

## 四、推荐架构

### 4.1 路由决策树

```
┌─────────────────────────────┐
│  一段旁白文本（narration）   │
└──────────────┬──────────────┘
               │
               ▼
    ┌────────────────────┐
    │ 内容特征检测         │
    │ - 含英文单词？       │
    │ - 含 `**加粗**`？    │
    │ - 含代码/符号？      │
    │ - 长度 > 30 字？     │
    └──────────┬─────────┘
               │
     ┌─────────┴─────────┐
     │                   │
  纯中文短句           混读/强调/长句
     │                   │
     ▼                   ▼
 ┌────────┐       ┌──────────────┐
 │edge-tts│       │ CosyVoice 2  │
 │ (免费) │       │  (本地 GPU)  │
 └────────┘       └──────┬───────┘
                         │失败
                         ▼
                  ┌──────────────┐
                  │ Azure Yunyi  │
                  │  (云兜底)    │
                  └──────┬───────┘
                         │失败
                         ▼
                  ┌──────────────┐
                  │  edge-tts    │
                  │ (最终兜底)   │
                  └──────────────┘
```

### 4.2 Provider 抽象层

```python
# scripts/tts/provider.py （新增）
class TTSProvider(Protocol):
    name: str                       # 'edge' | 'cosyvoice' | 'azure' | 'elevenlabs'
    def is_available(self) -> bool: ...
    def synth(self, text: str, voice: str, *, ssml_ok: bool = False) -> TTSResult: ...

@dataclass
class TTSResult:
    wav_path: Path
    vtt_path: Path             # 词级时间戳
    provider_used: str         # 实际使用的 provider（可能是 fallback 的结果）
    duration_s: float
```

**配置示例**（`video-agent-config.json`）：

```jsonc
{
  "tts": {
    "strategy": "auto",               // auto | cosyvoice | azure | edge
    "voice": "zh-CN-YunyiMultilingualNeural",  // 默认音色（Azure 语义）
    "cosyvoice": {
      "endpoint": "http://127.0.0.1:50000",
      "promptWav": "./assets/voice-prompt.wav",
      "promptText": "大家好，欢迎收看本期视频。"
    },
    "azure": {
      "keyEnv": "AZURE_SPEECH_KEY",
      "region": "eastasia",
      "voice": "zh-CN-YunyiMultilingualNeural"
    },
    "edge": {
      "voice": "zh-CN-YunxiNeural"
    },
    "routing": {
      "mixedLangThreshold": 0.15,     // 英文占比 > 15% 就升级
      "minLengthForUpgrade": 30,      // 超过 30 字的长句优先升级
      "upgradeOnEmphasis": true        // 含 `**加粗**` 就升级
    }
  }
}
```

### 4.3 词级时间戳统一格式

无论哪个 provider，都输出统一的 VTT 格式，包含**词级**时间戳：

```vtt
WEBVTT

00:00:00.080 --> 00:00:00.240
<00:00:00.080>这<00:00:00.150>是<00:00:00.240>

00:00:00.320 --> 00:00:00.580
<00:00:00.320>RMSNorm<00:00:00.580>
```

- **edge-tts**：原生支持 `WordBoundary` 事件
- **Azure**：SSML `<mark>` + `WordBoundary` 回调
- **CosyVoice 2**：需要额外跑一次 whisper 强制对齐（Whisper-large-v3 在 CPU 上跑 10 分钟音频约 30 秒），或使用 [whisperx](https://github.com/m-bain/whisperX) 做词级对齐

---

## 五、验收标准（选定模型前必须做的盲测）

在正式接入主力引擎前，用以下 3 段文本做听感盲测：

**测试用例 A**（纯中文）：
> 每个月看到云服务器的账单，我都肉疼。

**测试用例 B**（中英混读 + 代码术语）：
> 用 **RMSNorm** 归一化之后，过一个 `linear(x, w)` 投影，就能得到 logits。

**测试用例 C**（长句 + 标点停顿）：
> 这就是反向传播的核心：先用 DFS 后序遍历把计算图拓扑排序，然后从 loss 出发反向遍历，每个节点把梯度乘以局部偏导累加到子节点上，一层一层传回去。

**评分维度**（1-5 分）：
- 中文自然度
- 英文术语清晰度
- 语速节奏
- 重音位置
- 整体"像真人"

**通过门槛**：平均分 ≥ 4.0，且英文术语不被拆成字母拼读。

---

## 六、实施路线

| 阶段 | 内容 | 估计工时 |
|------|------|---------|
| **P0** | Provider 抽象层 + edge-tts 重构为 provider 形式 | 0.5 天 |
| **P1** | Azure provider 集成（SSML 模板 + 词级对齐） | 0.5 天 |
| **P2** | CosyVoice 2 FastAPI 服务 + 客户端 | 1 天 |
| **P3** | 路由决策引擎 + 策略配置 | 0.5 天 |
| **P4** | whisperX 强制对齐兜底（CosyVoice 无词级时间戳时） | 0.5 天 |
| **P5** | 3 段盲测验收 | 0.5 天 |
| **合计** | | **3.5 天** |

---

## 七、开放问题

1. **CosyVoice 男声 prompt** 从哪里来？
   - **方案一**：用 Azure Yunyi 朗读一段 10 秒的 prompt 文本 → 作为 CosyVoice 的克隆输入（音色一致性）
   - **方案二**：录一段您本人的 10 秒中文朗读 → 作为克隆输入（最个性化）
   - **方案三**：用 CosyVoice 官方 demo 里的预设男声 → 简单但不独家
   - **建议方案二**，但需要您提供录音

2. **是否需要多音色用于强调对比**？
   - 比如正文用一个男声，金句引用用另一个声音
   - 默认：**单一音色**，通过 `<prosody rate="slow" pitch="+2st">` 变化来区分强调

3. **云兜底的账单监控**？
   - 建议加一个 Stage 6 阶段的成本统计：`"tts_cost": {"azure": 0.024, "edge": 0, "cosyvoice": 0}`

---

## 参考链接

- CosyVoice 2 官方：[github.com/FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice)
- CosyVoice 2 demo：[funaudiollm.github.io/cosyvoice2](https://funaudiollm.github.io/cosyvoice2/)
- CosyVoice 2 论文：[arxiv.org/abs/2412.10117](https://arxiv.org/abs/2412.10117)
- CosyVoice 2 权重：[huggingface.co/FunAudioLLM/CosyVoice2-0.5B](https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B)
- Azure TTS 语音列表：[learn.microsoft.com/azure/ai-services/speech-service/language-support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)
- Azure Neural HD 价格更新：[techcommunity.microsoft.com Neural HD Recent Voice Updates](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-speech-%E2%80%93-neural-hd-text-to-speech-recent-voice-updates/4505380)
- Azure 定价官方：[azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/)
- IndexTTS2：[github.com/index-tts/index-tts](https://github.com/index-tts/index-tts)
- IndexTTS2 性能问题：[issue #585 - slow on RTX 3060](https://github.com/index-tts/index-tts/issues/585)
- ElevenLabs 定价：[elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api)
- edge-tts 停顿问题：[readest/readest#1777](https://github.com/readest/readest/issues/1777)、[rany2/edge-tts#136](https://github.com/rany2/edge-tts/issues/136)
