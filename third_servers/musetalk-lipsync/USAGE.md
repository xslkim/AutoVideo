# MuseTalk 口型同步服务 — 使用说明

本文档说明如何在本机启动 **MuseTalk FastAPI 服务**，以及如何调用 **`/lipsync`** 生成无音轨口型视频。与 AutoVideo 引擎约定的 API 契约见 [`LIPSYNC_TASKS.md`](LIPSYNC_TASKS.md) § 1。

部署与排障任务清单见 [`MUSETALK_DEPLOY.md`](MUSETALK_DEPLOY.md)。

---

## 1. 服务是什么、代码在哪

| 项目 | 说明 |
|------|------|
| **作用** | 接收一段 **人物头像视频**（avatar）和一段 **旁白 WAV**，返回 **口型与音频对齐** 的 MP4；**响应体不包含音频轨**（由服务端剥除，便于主流程再叠加到成片）。 |
| **默认地址** | `http://127.0.0.1:8001`（可通过启动参数修改） |
| **实现文件** | `lipsync_server.py`（与官方 Gradio `app.py` 共用同一套 MuseTalk 模型与推理逻辑） |
| **代码目录** | 本仓库机器上示例路径：`/home/xsl/work/MuseTalk/`（**不在 AutoVideo git 仓库内**，升级 AutoVideo 不会自动带上；请自行备份或在该目录单独做版本管理） |
| **Conda 环境名** | `MuseTalk`（Python 3.10，PyTorch CUDA 等依赖已预装在环境中） |

---

## 2. 前置条件

1. **NVIDIA GPU**，驱动正常；推荐 **显存 ≥ 8GB**（开启 `--use_float16` 更省显存）。
2. **Miniconda/Anaconda**，且已创建并安装好依赖的环境 **`MuseTalk`**。
3. **FFmpeg** 在 `PATH` 中（服务端会用 ffmpeg 裁剪 avatar、剥音轨）。
4. **模型文件** 已置于 MuseTalk 目录下的 `models/`，且能通过服务启动时的校验（详见 `MUSETALK_DEPLOY.md`）。

若 Miniconda 不在 `${HOME}/miniconda3`，请编辑 `start_lipsync_server.sh` 里的 `source` 路径，或改用下文「手动启动」方式。

---

## 3. 启动服务

### 3.1 推荐：一键脚本

```bash
chmod +x /path/to/MuseTalk/start_lipsync_server.sh   # 仅需第一次
/path/to/MuseTalk/start_lipsync_server.sh
```

脚本默认：

- 监听 **`0.0.0.0:8001`**（局域网其它机器也可访问，注意安全边界）
- 开启 **`--use_float16`**
- 将额外参数原样传给 `lipsync_server.py`，例如：

```bash
/path/to/MuseTalk/start_lipsync_server.sh --max-avatar-seconds 20
```

### 3.2 手动启动（等价）

```bash
source "${HOME}/miniconda3/etc/profile.d/conda.sh"   # 按你本机实际路径修改
conda activate MuseTalk
cd /path/to/MuseTalk
python lipsync_server.py --host 0.0.0.0 --port 8001 --use_float16
```

常用 **命令行参数**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--host` | `127.0.0.1` | 绑定地址；本机_only 可改为 `127.0.0.1` |
| `--port` | `8001` | 监听端口（与 `LIPSYNC_TASKS.md` 中默认一致） |
| `--use_float16` | 关闭 | **建议开启**：推理用半精度，省显存、通常更快 |
| `--max-avatar-seconds` | `15` | 上传的 avatar **从头裁切**的最长秒数；过长视频会极大增加人脸检测耗时，AutoVideo 场景一般为几秒 loop |

首次启动会加载 UNet/VAE/Whisper 等权重，**可能需要数十秒**；看到日志中出现 **Application startup complete** 后再访问接口。

### 3.3 停止服务

在运行服务的终端按 **Ctrl+C**，或结束占用端口的进程（示例）：

```bash
fuser -k 8001/tcp
```

---

## 4. 接口说明

### 4.1 健康检查 `GET /health`

**请求**

```http
GET http://127.0.0.1:8001/health
```

**成功（200）** 示例：

```json
{"status":"ok","gpu":"NVIDIA GeForce RTX 5090"}
```

**未就绪（503）**：模型尚未加载完成或加载失败。

---

### 4.2 口型生成 `POST /lipsync`

**请求**

```http
POST http://127.0.0.1:8001/lipsync
Content-Type: multipart/form-data
```

**表单字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `video` | 文件 | 是 | **必须为 `.mp4`**（文件名后缀需为小写 `mp4`，校验按小写比较） |
| `audio` | 文件 | 是 | **必须为 `.wav`**（后缀小写 `wav`） |
| `fps` | 整数 | 否 | 输出视频帧率，**默认 30**；合法范围 **1–120** |

**行为摘要**

1. 服务端将 avatar **截断**至最长 `--max-avatar-seconds`（默认 15 秒），再做人脸与口型推理。
2. 同一时间 **仅处理一个请求**（全局锁）；并发请求会排队。
3. 成功时响应 **`Content-Type: video/mp4`**，正文为 **无音频轨** 的 MP4。
4. 失败时响应 **`application/json`**：`{"error":"..."}`，HTTP 状态码多为 **400**（参数/素材问题）或 **500**（推理异常）。

**与 AutoVideo 集成时的超时**：客户端建议 **600000 ms（10 分钟）**，见 `LIPSYNC_TASKS.md` § 1.5。

---

## 5. 调用示例

### 5.1 curl（命令行）

```bash
# 健康检查
curl -sS http://127.0.0.1:8001/health

# 口型生成（按你本机路径修改）
curl -sS --max-time 600 -X POST http://127.0.0.1:8001/lipsync \
  -F "video=@/path/to/avatar.mp4" \
  -F "audio=@/path/to/narration.wav" \
  -F "fps=30" \
  --output /path/to/out_lipsync.mp4 \
  -w "\nHTTP %{http_code}\n"
```

检查输出是否 **只有视频轨、无音频**：

```bash
ffprobe -hide_banner /path/to/out_lipsync.mp4
```

### 5.2 本项目内曾验证的路径（示例）

以下组合曾在本环境跑通 **HTTP 200**（耗时因音频长度与 GPU 而异）：

- 视频：`temp/MicroGptRes/xiangsilian.mp4`
- 音频：`project/microgpt1/build/microgpt1/public/audio/B07.wav`
- 输出示例：`temp/MicroGptRes/lipsync_xiangsilian_B07.mp4`

---

## 6. 素材建议（avatar / 音频）

### 6.1 Avatar 视频

- **内容**：面部清晰、尽量 **正脸**；侧脸、过小脸、强遮挡易导致检测失败。
- **长度**：AutoVideo 设计为 **几秒 loop**；服务端默认最多取 **前 15 秒**，过长素材会被裁掉后半段。
- **分辨率 / 帧率**：不强制 192×192（实测可得其它正方形分辨率，如 320×320）；若需与 AutoVideo 画中画规格一致，请按 `LIPSYNC_TASKS.md` 准备 **192×192、30fps**。
- **格式**：**MP4**。幻灯片、无真人脸的片段可能导致「无人脸」错误。

### 6.2 音频

- **格式**：**WAV**（后缀 `.wav`）。若为其它格式，请先用 ffmpeg 转换，例如：

```bash
ffmpeg -y -i input.m4a -acodec pcm_s16le -ar 16000 -ac 1 output.wav
```

（具体采样率以你流水线为准；AutoVideo 提取轨常用 16 kHz 单声道，见 `LIPSYNC_TASKS.md`。）

---

## 7. 常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `Connection refused` | 服务未启动或端口不对 | 先 `GET /health`，确认进程与 `--port` |
| `video must be .mp4` / `audio must be .wav` | 后缀不符合要求 | 改名或使用正确容器格式后再试 |
| `400` + 无人脸相关文案 | avatar 中检测不到可用脸部 | 更换含清晰正脸的短视频 |
| `400` + ffmpeg 报错 | 上传文件损坏或非合法 mp4 | 用 `ffprobe` 检查源文件 |
| 请求很慢 | avatar 接近时长上限、帧数多 | 缩短素材或减小 `--max-avatar-seconds` |
| 进程退出码 **137** | 常被 **SIGKILL**（OOM 或手动杀进程） | 释放 GPU/内存；保持 `--use_float16` |
| curl 超时 | 长音频推理耗时长 | 增大 `--max-time`（如 600），或为客户端设置 10 min 超时 |

---

## 8. 与 AutoVideo 配置的关系

- AutoVideo / Web 侧可通过 **`MUSETALK_URL`** 或设置面板配置服务基地址（见 `LIPSYNC_TASKS.md` Task L8）。
- 默认期望：**`http://localhost:8001`**。

---

## 9. 相关文档

- [`LIPSYNC_TASKS.md`](LIPSYNC_TASKS.md) — API 契约与引擎集成步骤  
- [`MUSETALK_DEPLOY.md`](MUSETALK_DEPLOY.md) — 环境验证、模型与部署任务清单  
- [`AUTHORING.md`](../../docs/guidelines/AUTHORING.md) — `meta.md` 中 `avatarRef` 等
