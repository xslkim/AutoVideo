# 第三方服务集成

AutoVideo 视频生成管线调用下列**自托管的 HTTP 服务**。框架只通过 endpoint 连接它们,**不负责安装或启动**——请按各服务目录的说明部署并启动,然后在 AutoVideo 配置中填入对应地址。

> **目标环境**:Ubuntu 22.04 + NVIDIA GPU(3090 / 4090)。文生图与唇形同步需 GPU;TTS 可 CPU 运行。

## 服务依赖矩阵

| 服务 | 用途 | 默认端口 | 必需? | 对应配置项 |
|------|------|---------|--------|-----------|
| **VoxCPM2** | 旁白语音合成 (TTS) | `8000` | ✅ 必需 | `voxcpm.endpoint` |
| **Fun-CosyVoice3** | 旁白语音合成 (TTS 可切换底座,支持 instruct 情感指令) | `8002` | ⬜ 可选(替代 VoxCPM2) | `tts.provider` / `cosyvoice.endpoint` |
| **align-tts (FunASR)** | 字级强制对齐 (逐字卡拉OK字幕 `charTimings`) | `8003` | ⬜ 可选(缺席时回退均匀估算) | `AUTOVIDEO_ALIGN_ENDPOINT` |
| **IndexTTS-2.5** | 旁白语音合成 (音色克隆 + 情感描述 + 语速) | `8004` | ⬜ 可选(替代 VoxCPM2) | `tts.provider` / `indextts.endpoint` |
| **GLM-Image** | 文生图 (image 视觉模式,OpenAI 兼容 API) | `8005` | ⬜ 可选 | `imageGen.baseURL` |
| **SenseNova-U1** | 文生图 (image 视觉模式) | `8765` | ⬜ 可选 | `imageGen.baseURL` |
| **MuseTalk** | 口型/唇形同步 (视频 avatar 模式) | `8001` | ⬜ 可选 | `musetalk.url` |
| **EchoMimicV3-Flash** | 半身数字人 (图片 avatar 模式) | `8006` | ⬜ 可选 | `echomimic.url` |
| **ComfyUI + Z-Image-Turbo** | 文生图 / 文生视频 (workflow 驱动;亦供 aivideo 模式) | `8188` | ⬜ 可选 | `imageGen.provider=comfyui` / `imageGen.baseURL` / `VIDEO_GEN_COMFYUI_URL` |

> Claude(视觉组件生成 / 评审)是外部 API,无需自托管,见根目录 README。

## 目录

| 目录 | 服务 | 收录内容 |
|------|------|---------|
| [`voxcpm-tts/`](voxcpm-tts/) | VoxCPM2 TTS | 服务源码 `server.py` + 依赖 + 启动/安装脚本 |
| [`cosyvoice-tts/`](cosyvoice-tts/) | Fun-CosyVoice3 TTS | 服务源码 `server.py` + 启动/安装脚本(引擎代码需 clone 上游) |
| [`align-tts/`](align-tts/) | FunASR 字级强制对齐 | 服务源码 `server.py` + 启动/安装脚本(模型首次启动自动下载,可纯 CPU) |
| [`indextts-tts/`](indextts-tts/) | IndexTTS-2.5 TTS | 服务源码 `server.py` + 启动/安装脚本(引擎代码需 clone 上游) |
| [`glm-image/`](glm-image/) | GLM-Image 文生图(sglang serve) | 启动/安装脚本(模型首次启动自动下载) |
| [`comfyui/`](comfyui/) | ComfyUI + Z-Image-Turbo FP8 文生图 | workflow 模板 + 启动/安装脚本(源码 clone 上游) |
| [`sensenova-t2i/`](sensenova-t2i/) | SenseNova-U1 文生图 | 部署文档 + 启动/安装脚本(源码需 clone 上游) |
| [`musetalk-lipsync/`](musetalk-lipsync/) | MuseTalk 唇形同步 | 部署文档 + 启动/安装脚本(源码需 clone 上游) |
| [`echomimic-avatar/`](echomimic-avatar/) | EchoMimicV3-Flash 数字人 | 服务源码 `server.py` + 启动/安装脚本(引擎代码需 clone 上游) |

> 服务本体代码与模型权重体积巨大(数 GB ~ 数十 GB),**不纳入本仓库**。VoxCPM 服务代码很小,直接收录;SenseNova / MuseTalk 需 clone 各自上游仓库。

## 快速启动

每个服务目录下:
- `install.sh` — 安装依赖 + 下载模型(支持 `SKIP_MODEL=1` 跳过模型)
- `start.sh` — 启动服务(支持 `HOST` / `PORT` / 模型路径环境变量)

```bash
# 1. 装并启动 TTS(必需;CosyVoice3 为可切换替代底座,二选一)
bash third_servers/voxcpm-tts/install.sh
bash third_servers/voxcpm-tts/start.sh &
#   或: bash third_servers/cosyvoice-tts/install.sh && bash third_servers/cosyvoice-tts/start.sh &
#   (两者显存无法并存时用 bash third_servers/stop.sh tts|cosy 串行切换)

# 2.(可选)文生图 / 唇形同步 / 字级对齐 / 数字人
bash third_servers/sensenova-t2i/install.sh   && bash third_servers/sensenova-t2i/start.sh &
bash third_servers/musetalk-lipsync/install.sh && bash third_servers/musetalk-lipsync/start.sh &
#   字级对齐(逐字卡拉OK字幕;可纯 CPU): bash third_servers/align-tts/install.sh && bash third_servers/align-tts/start.sh &
#   GLM-Image 文生图: bash third_servers/glm-image/install.sh && bash third_servers/glm-image/start.sh &
#   ComfyUI 文生图/文生视频: bash third_servers/comfyui/install.sh && bash third_servers/comfyui/start.sh &
#   EchoMimic 数字人: bash third_servers/echomimic-avatar/install.sh && bash third_servers/echomimic-avatar/start.sh &
#   ⚠️ EchoMimic 常驻约 12GB 显存,与 MuseTalk 二选一,用 stop.sh 串行切换
```

启动后在 AutoVideo 的 Web 设置面板填入各 endpoint,或写入 `autovideo.config.json`。运行 `autovideo doctor` 可检查连通性。

停止服务(按监听端口定位进程,优雅关停):

```bash
bash third_servers/stop.sh                 # 停止全部
bash third_servers/stop.sh tts             # 只停某个: tts | t2i | lipsync | cosy | align | indextts | glm | comfyui | avatar
```

## 端口与健康检查约定

| 服务 | 健康检查 |
|------|---------|
| VoxCPM2 | `GET http://127.0.0.1:8000/health` → `{ "status": "ok" }` |
| Fun-CosyVoice3 | `GET http://127.0.0.1:8002/health` → `{ "status": "ok" }`(模型加载中返回 503) |
| align-tts | `GET http://127.0.0.1:8003/health` → `{ "status": "ok" }`(模型加载中返回 503) |
| IndexTTS-2.5 | `GET http://127.0.0.1:8004/health` → `{ "status": "ok" }` |
| GLM-Image | `GET http://127.0.0.1:8005/v1/models`(OpenAI 兼容) |
| SenseNova-U1 | `GET http://127.0.0.1:8765/`(Web 服务根) |
| MuseTalk | `GET http://127.0.0.1:8001/health` |
| EchoMimicV3-Flash | `GET http://127.0.0.1:8006/health` → `{ "status": "ok" }`(未就绪 503) |
| ComfyUI | `GET http://127.0.0.1:8188/system_stats` |

端口冲突时,改 `start.sh` 的 `PORT` 环境变量,并同步更新 AutoVideo 配置里的 endpoint。
