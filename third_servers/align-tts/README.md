# align-tts — FunASR 字级强制对齐服务

AutoVideo 的可选对齐服务：输入一行旁白 WAV + 原文，输出**字级时间戳**，
供逐字卡拉OK字幕（`audio.charTimings`）使用。

不启动也能跑完整流水线：TTS 阶段的健康检查探测不到本服务时，自动回退
**行内均匀语速估算**（见 `src/tts/timings.ts` 的 `estimateCharTimings`）。
启动后估算值被真实强制对齐覆盖，逐字高亮与语音严格同步。

对齐模型：ModelScope `iic/speech_timestamp_prediction-v1-16k-offline`
（FunASR `fa-zh`，字级时间戳预测，输入音频+文本）。模型很小（<1GB），
**可纯 CPU 运行**，与 GPU 上的 TTS/文生图服务不抢显存。

## 端口与 API

- 默认地址：`http://127.0.0.1:8003`
- 健康检查：`GET /health` → `{ "status": "ok" }`（模型加载中/失败返回 503）
- 强制对齐：`POST /align` → `{ "tokens": [...], "duration_ms": int }`
  - 请求体：`{ "wav_base64": "...", "text": "..." }`
    - `text` 是**实际被朗读的文本**（客户端已剥离不朗读的 ASCII 括号）
  - 响应 `tokens`：`[{ "char": "你", "start_ms": 0, "end_ms": 240 }, ...]`，
    行内相对毫秒
  - **契约**：中文对齐按非空白字计数，tokens 只覆盖 `text` 的**非空白字符**，
    一一对应、顺序一致；客户端把空白/括号映射成零时长
  - 模型产出的时间戳数与非空白字符数对不上时（英文混排按词/子词分词等）
    返回 **422**，客户端自动回退该行估算——本服务主要面向中文逐字旁白

## 前置条件

- Python **3.10**
- 磁盘：约 5 GB（venv 依赖为主，模型 <1 GB）
- GPU 非必需；有 GPU 可设 `ALIGN_DEVICE=cuda:0` 加速批量对齐
  - **RTX 5090 注意**：需要 cu128 构建的 torch，
    `TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128 bash install.sh`

## 安装

```bash
bash install.sh                 # venv + funasr/modelscope/fastapi + 模型(<1GB)
SKIP_MODEL=1 bash install.sh    # 跳过模型下载(首次启动时 FunASR 自动拉取)
```

## 启动

```bash
bash start.sh                   # 前台启动
```

环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ALIGN_MODEL` | `<服务目录>/models/speech_timestamp_prediction-v1-16k-offline`（不存在则用 ModelScope ID） | 对齐模型 ID 或本地目录 |
| `ALIGN_DEVICE` | `cpu` | 推理设备（`cuda:0` 等） |
| `ALIGN_HOST` | `127.0.0.1` | 监听地址 |
| `ALIGN_PORT` | `8003` | 监听端口 |
| `VENV_PYTHON` | `<服务目录>/.venv/bin/python` | 虚拟环境解释器 |

## 与 AutoVideo 的接线

TTS 阶段（`src/cli/tts.ts`）通过环境变量控制，无需改配置文件：

| 变量 | 默认 | 说明 |
|------|------|------|
| `AUTOVIDEO_CHAR_TIMINGS` | 启用 | `off`/`0`/`false` 时完全不产出 `charTimings` |
| `AUTOVIDEO_ALIGN_ENDPOINT` | `http://127.0.0.1:8003` | 本服务地址；改了 `ALIGN_PORT` 要同步改这里 |
| `AUTOVIDEO_ALIGN` | 启用 | `off`/`0`/`false` 时禁用对齐覆盖，只写均匀估算 |

行为细节：
- 合成完成后做一次 `GET /health`；不可达则整块脚本只用估算，**不会拖慢流水线**
- dict.md 改写过的行（`speakText ≠ ttsText`）无法把对齐字符映射回字幕展示
  文本，这些行保留估算
- 对齐请求连续失败 3 次后本次运行熔断，剩余行全部用估算
- `charTimings` 时间是**块相对秒**，含 `lineIndex`，字符顺序与 `ttsText` 一致

## 文件

- `server.py` — FastAPI 服务（FunASR `AutoModel`，后台线程加载模型）
- `install.sh` / `start.sh` — 安装 / 启动脚本
- `models/` — 模型权重（install.sh 下载，不纳入版本库）

## 已知待校准项

本服务是脚手架，首次真机部署时按实际 FunASR 版本校准两处：
1. `server.py` 中对 `model.generate()` 返回结构的解析（`timestamp` 字段的
   确切位置/含义）——不同 funasr 版本可能有出入
2. `install.sh` 里模型 `revision="v2.0.4"` 的钉版是否仍然有效
