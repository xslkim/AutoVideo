# IndexTTS-2.5 — TTS 语音合成服务（情感可控）

AutoVideo 的可切换 TTS 底座之一（`tts.provider: "indextts"` 选择），基于
IndexTeam IndexTTS-2.5，零样本音色克隆 + **自然语言情感描述** + 语速控制。

> **脚手架说明**：本目录是服务包装层（FastAPI）。`server.py` 中标记
> `ADJUST IF NEEDED` 的两处（模型 import 路径、`infer()` 的 kwargs）需按
> 实际安装的 IndexTTS-2.5 版本核对——不同发行版的 Python 入口可能略有差异。

一致性策略与 cosyvoice-tts 相同：**每行用同一个注册的 voiceRef 作克隆
prompt，不走行链**（客户端 `usesChain=false`）。API 表面刻意与
`../cosyvoice-tts/server.py` 对齐，框架侧按 provider 切换即可。

## 端口与 API

- 默认地址：`http://127.0.0.1:8004`
- 健康检查：`GET /health` → `{ "status": "ok" }`（模型加载中/失败返回 503）
- 注册音色：`POST /v1/voices` → `{ "voice_id": string }`
  - 请求体：`{ "wav_base64": "...", "prompt_text"? }`
  - `voice_id` = wav 内容 md5 前 16 位，**同一 wav 重复注册幂等**
  - IndexTTS 克隆只需参考音频本身，**不需要文本转写**（`prompt_text` 仅为
    与 cosyvoice 客户端对称而保留，当前忽略）
- 语音合成：`POST /v1/speech` → 48kHz WAV bytes
  - 请求体：`{ "text", "voice_id", "seed_salt?"(默认 ""), "emotion?"(默认 ""),
    "duration_factor?"(默认 1.0，0.5–2.0，>1 更快) }`
  - `emotion`：自然语言情感描述（如 `平静耐心地讲解`、`excited`），走
    IndexTTS-2.5 的 emo_text 通路；空 = 中性
  - `duration_factor`：语速倍率。当前实现对合成结果做 sox `tempo`
    变调不变速处理；若安装的 2.5 版本 infer() 原生支持时长控制，
    优先改用原生参数（见 `server.py` `_infer`）
  - 确定性：`seed = md5(voice_id | seed_salt | emotion | duration_factor | text)`，
    同参必出同音频（`use_random=False`）
  - 输出仅 clip-guard：峰值 > 0.99 才压缩，**不做满幅归一**

## 前置条件

- Python **3.10**
- GPU：建议 ≥ 8 GB 显存（`INDEXTTS_FP16=0` 可关半精度）
- 磁盘：约 10 GB（venv 依赖 + 模型权重）
- 与 CosyVoice/VoxCPM 显存无法并存时，用 `bash ../stop.sh` 串行切换
  （`stop.sh` 的 indextts 端口 8004 支持见集成笔记）

## 安装

```bash
bash install.sh                 # venv + clone + 依赖 + 模型下载
SKIP_MODEL=1 bash install.sh    # 跳过模型下载（已有权重时）
```

模型 ID 默认 `IndexTeam/IndexTTS-2.5`（优先 ModelScope，失败回退
HuggingFace），可用 `INDEXTTS_MODEL_ID` 覆盖；模型目录可用软链接指向
已有权重。

## 启动

```bash
bash start.sh                   # 默认 127.0.0.1:8004
INDEXTTS_PORT=9004 bash start.sh
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `INDEXTTS_MODEL_DIR` | `./models/IndexTTS-2.5` | 模型权重目录（必填） |
| `INDEXTTS_REPO_DIR` | `./index-tts` | 上游仓库目录 |
| `INDEXTTS_VOICE_DIR` | `./voices` | 已注册音色存储 |
| `INDEXTTS_MODEL_CONFIG` | `<模型目录>/config.yaml` | checkpoint 配置路径 |
| `INDEXTTS_DEVICE` | `cuda`（无 GPU 时 `cpu`） | 推理设备 |
| `INDEXTTS_FP16` | `1` | 半精度推理（0 关闭） |
| `INDEXTTS_HOST` / `INDEXTTS_PORT` | `127.0.0.1` / `8004` | 监听地址 |

框架侧（`autovideo.config.json` 的 `indextts` 段，schema 增补见
`docs/upgrade-2026/integration/tts-emotion.md`）：

```jsonc
{
  "tts": { "provider": "indextts" },
  "indextts": {
    "endpoint": "http://127.0.0.1:8004",
    "modelDir": "/path/to/IndexTTS-2.5",
    "emotion": "平静耐心地讲解",   // 默认情感；行级可覆盖
    "durationFactor": 1.0
  }
}
```

不加配置段时也可用环境变量：`INDEXTTS_ENDPOINT` / `INDEXTTS_MODEL_DIR` /
`INDEXTTS_EMOTION` / `INDEXTTS_DURATION_FACTOR` / `INDEXTTS_SEED_SALT`。
