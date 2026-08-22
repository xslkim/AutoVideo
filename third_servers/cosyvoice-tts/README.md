# Fun-CosyVoice3-0.5B — TTS 语音合成服务

AutoVideo 的可切换 TTS 底座(与 VoxCPM2 并存,框架通过 `tts.provider` 配置选择),
基于阿里 Fun-CosyVoice3-0.5B(Apache-2.0),zero-shot 音色克隆。

一致性策略:**每行用同一个注册的 voiceRef 作 zero-shot prompt,不走行链**
(对应客户端 `usesChain=false`)。

## 端口与 API

- 默认地址:`http://127.0.0.1:8002`
- 健康检查:`GET /health` → `{ "status": "ok" }`(模型加载中/失败返回 503)
- 注册音色:`POST /v1/voices` → `{ "voice_id": string }`
  - 请求体:`{ "wav_base64": "...", "prompt_text": "..."(可选) }`
  - `voice_id` = wav 内容 md5 前 16 位,**同一 wav 重复注册幂等**
  - `prompt_text` 是参考音频的文本转写,CosyVoice zero-shot **必需**;注册时缺失
    不报错(音色标记为"待补文本"),可之后对同一 wav 再 POST 一次补上
  - 引用无 `prompt_text` 的音色调 `/v1/speech` 会返回 400 并给出补传指引
  - 参考 wav 时长需 ≤ 30 秒(引擎 speech token 提取上限)
- 语音合成:`POST /v1/speech` → 48kHz WAV bytes
  - 请求体:`{ "text", "voice_id", "seed_salt?"(默认 ""), "normalize?"(默认 false) }`
  - **不收** voxcpm 专有参数(cfg_value / timesteps / denoise / retry_badcase / prev_*)
  - 文本预处理:`insert_zh_en_space`(中英边界加空格)→ 引擎自带 normalize
    (`normalize=true` 时;引擎优先 ttsfrd,未装则 wetext)
  - 确定性:`seed = md5(voice_id | seed_salt | text)`,同参必出同音频
  - 输出仅 clip-guard:峰值 > 0.99 才压缩,**不做满幅归一**

## 前置条件

- Python **3.10**(官方 requirements 面向 3.10;ttsfrd whl 仅 cp310 构建)
- GPU:Fun-CosyVoice3-0.5B 推理约需 6–8 GB 显存
  - **RTX 5090 注意**:官方 requirements 锁 `torch==2.3.1+cu121`,不支持
    Blackwell(sm_120)。`install.sh` 装完 requirements 后会自动把
    torch/torchaudio 换装 **2.8.0+cu128**(已验证兼容;老卡可用
    `TORCH_INDEX_URL="" bash install.sh` 跳过)
  - 已知无害告警:`pip check` 会报 `openai-whisper requires triton<3`——
    本服务只用 whisper 的 log-mel/tokenizer,不触 triton 内核
- 磁盘:约 15 GB(venv 依赖 ~10 GB + 模型 ~2 GB)
- 与 VoxCPM2 显存无法并存时,用 `bash ../stop.sh tts` / `bash ../stop.sh cosy`
  串行切换

## 安装

```bash
bash install.sh                 # venv + clone + 依赖 + ttsfrd + 模型(约 2GB)
SKIP_MODEL=1 bash install.sh    # 跳过模型下载
SKIP_TTSFRD=1 bash install.sh   # 跳过 ttsfrd(自动回退 wetext)
```

模型来自 ModelScope `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`(官方 README 收录 ID;
无 `-2512` 后缀的 ID 在 ModelScope 不存在),可用 `COSYVOICE_MODEL_ID` 覆盖。

### ttsfrd 手动安装(install.sh 该步失败时)

ttsfrd 不在 PyPI,官方发布渠道是 ModelScope 资源包 `iic/CosyVoice-ttsfrd`:

```bash
.venv/bin/python -c "from modelscope import snapshot_download; \
  snapshot_download('iic/CosyVoice-ttsfrd', local_dir='CosyVoice/pretrained_models/CosyVoice-ttsfrd')"
cd CosyVoice/pretrained_models/CosyVoice-ttsfrd
unzip resource.zip -d .
../../../.venv/bin/pip install ttsfrd_dependency-0.1-py3-none-any.whl ttsfrd-0.4.2-cp310-cp310-linux_x86_64.whl
```

不装也能跑:引擎自动回退 wetext 文本归一化。

## 启动

```bash
bash start.sh                   # 前台启动
```

环境变量:

| 变量 | 默认 | 说明 |
|------|------|------|
| `COSYVOICE_MODEL_DIR` | `<服务目录>/models/Fun-CosyVoice3-0.5B` | 模型权重目录 |
| `COSYVOICE_REPO_DIR` | `<服务目录>/CosyVoice` | CosyVoice 仓库克隆 |
| `COSYVOICE_VOICE_DIR` | `<服务目录>/voices` | 注册音色(wav + prompt_text)存放目录 |
| `COSYVOICE_HOST` | `127.0.0.1` | 监听地址 |
| `COSYVOICE_PORT` | `8002` | 监听端口 |
| `COSYVOICE_INSTRUCT_PREFIX` | `You are a helpful assistant.<\|endofprompt\|>` | prompt_text 缺 instruct 标记时自动补的前缀(官方 CosyVoice3 用法);置空禁用 |

## 文件

- `server.py` — FastAPI 服务(推理入口 `cosyvoice.cli.cosyvoice.AutoModel`,仓库代码非 pip 包)
- `install.sh` / `start.sh` — 安装 / 启动脚本
- `CosyVoice/` — 上游仓库克隆(`git clone --recursive`,含 `third_party/Matcha-TTS`)
- `models/` — 模型权重(不纳入版本库)
- `voices/` — 已注册音色(不纳入版本库)
