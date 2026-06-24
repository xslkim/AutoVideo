# VoxCPM2 — TTS 语音合成服务

AutoVideo 的旁白语音合成后端,基于 VoxCPM2 模型。

## 端口与 API

- 默认地址:`http://127.0.0.1:8000`
- 健康检查:`GET /health` → `{ "status": "ok" }`
- 注册音色:`POST /v1/voices`(上传参考 wav,返回 `voice_id`)
- 语音合成:`POST /v1/speech`(文本 + voice_id,返回 48kHz WAV)
- 风格化合成:`POST /v1/speech/styled`

## 前置条件

- Python 3.10+
- VoxCPM2 模型权重(约 4–8 GB)
- GPU 推荐(CPU 可跑但显著变慢)

## 安装

```bash
bash install.sh                 # 建 venv + 装依赖
```

或手动:
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

模型权重需从 VoxCPM2 上游自行下载,默认放到服务目录内的 `models/VoxCPM2/`
(已被 `.gitignore` 忽略),无需设置环境变量:
```bash
mkdir -p models
# 直接放权重: models/VoxCPM2/{config.json,model.safetensors,...}
# 或软链接到已有权重: ln -s /path/to/VoxCPM2 models/VoxCPM2
```
也可通过 `VOXCPM_MODEL_DIR` 覆盖默认路径。

## 启动

```bash
bash start.sh                   # 前台启动
```

环境变量:

| 变量 | 默认 | 说明 |
|------|------|------|
| `VOXCPM_MODEL_DIR` | `<服务目录>/models/VoxCPM2` | VoxCPM2 权重目录 |
| `VOXCPM_HOST` | `127.0.0.1` | 监听地址 |
| `VOXCPM_PORT` | `8000` | 监听端口 |
| `VOXCPM_ENABLE_DENOISER` | `1` | 是否启用降噪 |

## 文件

- `server.py` — FastAPI 服务(VoxCPM2 推理)
- `requirements.txt` — Python 依赖
- `start.sh` / `install.sh` — 启动 / 安装脚本
