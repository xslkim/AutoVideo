# MuseTalk 服务部署任务清单

> **目标**：在 `http://localhost:8001` 暴露 `/lipsync` REST API，供 AutoVideo 口型同步功能调用。
>
> **API 规范**：见 `LIPSYNC_TASKS.md` § 1

---

## 当前状态（调研结论）

| 项目 | 状态 | 路径 |
|------|------|------|
| MuseTalk 代码 | ✅ 已存在 | `/home/xsl/work/MuseTalk/` |
| conda 环境 | ✅ 已就绪 | `MuseTalk`（Python 3.10, PyTorch 2.12.0+cu128） |
| 模型文件 | ✅ 全部已下载 | `/home/xsl/work/MuseTalk/models/` |
| FastAPI / uvicorn | ✅ 已安装 | conda env `MuseTalk` 内 |
| mmcv 2.1.0 | ✅ 已安装 | conda env `MuseTalk` 内 |
| Gradio 推理测试 | ❓ 未验证 | `app.py` port 7860 |
| FastAPI 服务 | ✅ 已创建 | `lipsync_server.py`（`/home/xsl/work/MuseTalk/`） |

**主要工作**：已在 MuseTalk 目录实现 `lipsync_server.py` + `start_lipsync_server.sh`；MS1（Gradio）与「含清晰人脸的 `/lipsync` 端到端」需你本地用真实 avatar 素材完成。

---

## 已知技术坑（RTX 5090 + PyTorch 2.12 特有）

1. **`torch.load` 行为变更**：PyTorch ≥ 2.6 默认 `weights_only=True`，会导致旧版 mmpose/mmengine checkpoint 加载失败，报 `UnpicklingError: Weights only load failed`。需要在导入 musetalk 模块之前打补丁。

2. **xtcocotools numpy 兼容问题**：pip 安装的 xtcocotools 可能与新版 numpy 不兼容，需要从源码安装。

3. **工作目录**：MuseTalk 代码里大量用了相对路径（`./models/`、`./results/`），服务启动时必须 `cd /home/xsl/work/MuseTalk/`。

---

## 任务列表

### MS0：验证推理环境

**目的**：在构建 FastAPI 包装之前，先确认底层推理代码没有环境问题。

**执行步骤**：

```bash
# 1. 激活环境，进入 MuseTalk 目录
conda activate MuseTalk
cd /home/xsl/work/MuseTalk

# 2. 验证 GPU 和 PyTorch 可用
python -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0))"
# 预期输出：PyTorch: 2.12.x, CUDA: True, GPU: NVIDIA GeForce RTX 5090

# 3. 验证 mmcv 可以正常导入
python -c "import mmcv; print('mmcv:', mmcv.__version__)"
# 预期输出：mmcv: 2.1.0

# 4. 测试 torch.load 补丁是否需要
python -c "
import torch
_orig = torch.load
def _patched(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _orig(*args, **kwargs)
torch.load = _patched
from musetalk.utils.utils import load_all_model
print('musetalk import OK')
"
# 如果不报错，说明补丁有效；如果仍报错请记录错误信息
```

**验收标准**：
- [ ] PyTorch CUDA 可用
- [ ] mmcv 可以 import
- [ ] musetalk 模块可以 import（需要 torch.load 补丁）

**如果 MS0 有报错，先解决以下已知问题再继续：**

```bash
# 问题 A：xtcocotools 与 numpy 不兼容
# 解决方案：
pip uninstall -y xtcocotools
cd /tmp && git clone https://github.com/pzc163/xtcocoapi.git
cd xtcocoapi && pip install -e .

# 问题 B：mmcv 符号未定义（ImportError: _ext undefined symbol）
# 解决方案：从源码重编译
pip uninstall -y mmcv
pip cache remove mmcv
MMCV_WITH_OPS=1 FORCE_CUDA=1 pip install mmcv==2.1.0 --no-cache-dir --no-build-isolation
# 注意：此步骤需要 20-40 分钟编译时间
```

---

### MS1：运行一次完整推理测试（Gradio）

**目的**：用已有的 Gradio 界面做端到端验证，确认 MuseTalk 推理链路完全正常，再写 FastAPI 包装。

**执行步骤**：

```bash
conda activate MuseTalk
cd /home/xsl/work/MuseTalk

# 启动 Gradio 界面
python app.py --ip 127.0.0.1 --port 7860 --use_float16
```

**测试方法**：
1. 访问 http://127.0.0.1:7860
2. 上传一个人物头像视频（任意 mp4，有人脸，不一定要 192x192）
3. 上传一段音频（wav/mp3 均可）
4. 点击 "2. Generate" 按钮
5. 等待推理完成（视长度 1-3 分钟）
6. 确认右侧出现口型同步视频

**验收标准**：
- [ ] app.py 启动无报错
- [ ] 模型加载成功（日志中无 CUDA 错误）
- [ ] 推理完成，输出视频正常播放

> **注意**：`--use_float16` 可减少显存占用（约 8-10GB），建议加上。如不加则使用 float32（约 14-16GB）。

---

### MS2：编写 FastAPI 服务文件

**目的**：创建 `lipsync_server.py`，暴露符合 LIPSYNC_TASKS.md 规范的 `/lipsync` API。

**文件位置**：`/home/xsl/work/MuseTalk/lipsync_server.py`

**API 规范**（来自 LIPSYNC_TASKS.md § 1）：
```
POST http://localhost:8001/lipsync
Content-Type: multipart/form-data

字段：
  video  File (mp4)  必填  人物头像 loop 视频
  audio  File (wav)  必填  完整旁白音频
  fps    int         选填  输出帧率，默认 30

响应：
  200  video/mp4 binary  口型同步视频（无音频轨）
  400  JSON {"error": "..."}
  500  JSON {"error": "..."}
```

**实现要点**：

1. **torch.load 补丁**（必须在其他任何 import 之前）：
   ```python
   import torch
   _orig_torch_load = torch.load
   def _patched_torch_load(*args, **kwargs):
       kwargs.setdefault('weights_only', False)
       return _orig_torch_load(*args, **kwargs)
   torch.load = _patched_torch_load
   ```

2. **工作目录切换**（musetalk 用相对路径）：
   ```python
   import os
   os.chdir(os.path.dirname(os.path.abspath(__file__)))
   ```

3. **模型加载**（启动时加载一次，复用）：
   - 加载 VAE, UNet, PE, Whisper（与 app.py 第 390-430 行相同）
   - 支持 `--use_float16` 参数

4. **推理逻辑**：
   - 从 app.py 的 `inference()` 函数（第 184-386 行）提取
   - 去掉 `gr.Progress` 参数（改为直接 print 进度）
   - 使用 `uuid` 或时间戳生成唯一临时目录，避免并发冲突（虽然 AutoVideo 串行调用，但以防万一）

5. **音频剥离**（返回无音频轨视频）：
   ```bash
   ffmpeg -y -i output_with_audio.mp4 -an -c:v copy output_no_audio.mp4
   ```

6. **临时文件清理**：
   - 推理完成后清理上传的临时文件
   - 推理完成后清理中间产物（帧图片目录等）

7. **超时配置**：
   - 不需要在服务端设置，客户端（AutoVideo）设置 10 分钟超时

**需要创建的文件**：`/home/xsl/work/MuseTalk/lipsync_server.py`

**验收标准**：
- [ ] 文件创建完成，语法无错误（`python -m py_compile lipsync_server.py`）
- [ ] 启动时模型加载成功，无报错
- [ ] `/health` 端点返回 `{"status": "ok"}`

---

### MS3：测试 FastAPI 服务

**目的**：验证 `/lipsync` 端点行为符合规范。

**启动服务**：

```bash
conda activate MuseTalk
cd /home/xsl/work/MuseTalk
python lipsync_server.py --port 8001 --use_float16
```

**测试 /health 端点**：

```bash
curl http://localhost:8001/health
# 预期：{"status": "ok", "gpu": "NVIDIA GeForce RTX 5090"}
```

**测试 /lipsync 端点**：

需要准备测试素材：
- 测试头像视频：可以从项目里找一个 mp4（或截取任意含人脸的视频）
- 测试音频：可以用 AutoVideo 项目里的任意 `.wav` 文件（如 `B00.wav`）

```bash
# 转换参考音色为合适的 WAV（如果需要）
ffmpeg -i /home/xsl/AutoVideo/B00.wav -ar 16000 -ac 1 /tmp/test_audio.wav

# 调用 /lipsync API
curl -X POST http://localhost:8001/lipsync \
  -F "video=@/path/to/test_avatar.mp4" \
  -F "audio=@/tmp/test_audio.wav" \
  -F "fps=30" \
  --output /tmp/lipsync_test_output.mp4 \
  -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n"

# 验证输出视频
ffprobe /tmp/lipsync_test_output.mp4
# 检查：有视频轨，无音频轨，分辨率合理
```

**验收标准**：
- [ ] `/health` 返回 200
- [ ] `/lipsync` 返回 200，body 是合法 mp4 文件
- [ ] 输出 mp4 无音频轨（`ffprobe` 只显示 video stream）
- [ ] 视频中人物嘴型在动（口型同步有效）
- [ ] 错误场景：上传非视频文件返回 400

---

### MS4：创建启动脚本

**目的**：提供标准启动命令，方便每次手动启动服务。

**文件位置**：`/home/xsl/work/MuseTalk/start_lipsync_server.sh`

**内容**：

仓库内实际脚本使用 `$HOME/miniconda3`（见 `start_lipsync_server.sh`）。启动示例：

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source "${HOME}/miniconda3/etc/profile.d/conda.sh"
conda activate MuseTalk
exec python lipsync_server.py --host 0.0.0.0 --port 8001 --use_float16 "$@"
```

**执行**：

```bash
chmod +x /home/xsl/work/MuseTalk/start_lipsync_server.sh
# 启动服务：
/home/xsl/work/MuseTalk/start_lipsync_server.sh
```

**验收标准**：
- [ ] 脚本可以直接运行，无需手动 conda activate

---

## 任务依赖关系

```
MS0（验证环境）
  └─→ MS1（Gradio 推理测试）
        └─→ MS2（编写 FastAPI 服务）
              └─→ MS3（测试 API）
                    └─→ MS4（启动脚本）
```

**建议执行顺序**：MS0 → MS1 → MS2 → MS3 → MS4

> MS0 和 MS1 的目的是发现潜在问题，如果 MS1 完全正常，MS2 就是直接的代码编写工作。

---

## 已实现说明（执行记录）

以下逻辑已写入 `/home/xsl/work/MuseTalk/lipsync_server.py`（不在 AutoVideo 仓库内，需单独备份）：

1. **PyTorch `torch.load` 补丁**：在导入 musetalk / moviepy 之前统一 `weights_only=False`，避免 PyTorch 2.6+ 加载旧 checkpoint 失败。
2. **模型文件校验**：Whisper 目录仅校验 `preprocessor_config.json` + `pytorch_model.bin`（你当前快照无 `config.json`，与官方 `download_weights` 脚本假设不一致）。
3. **`POST /lipsync`**：`multipart` 字段 `video`（`.mp4`）、`audio`（`.wav`）、`fps`（默认 30）；成功时返回 **无音频轨** 的 `video/mp4`；错误时 JSON `{"error":"..."}`（400/500）。
4. **`GET /health`**：`{"status":"ok","gpu":"..."}`。
5. **Avatar 时长上限**：默认用 ffmpeg 将上传视频裁到 **`--max-avatar-seconds`（默认 15）**，避免误传长视频导致人脸检测逐帧耗时过长（与 LIPSYNC_TASKS 中「几秒 loop」一致）。
6. **无人脸素材**：上游 `get_landmark_and_bbox` 在全程检测不到人脸时会除零崩溃；已捕获并转为 **400**，提示使用含清晰正脸的 avatar。
7. **并发**：线程锁串行执行推理，与 AutoVideo「单任务 FIFO」一致。

**MS3 建议**：不要用幻灯片类 partial mp4 测口型；请使用 **192×192 左右、含正脸** 的短视频（可先跑 MS1 确认 Gradio 能出结果），再对 `/lipsync` 做 `curl`，客户端超时建议 ≥ 600s。

---

## 参考信息

### 模型目录结构（已确认存在）

```
/home/xsl/work/MuseTalk/models/
├── musetalk/       # V1.0
├── musetalkV15/    # V1.5（服务默认使用此版本）
├── syncnet/
├── dwpose/
├── face-parse-bisent/
├── sd-vae/
├── whisper/
└── hub/
```

### MuseTalk conda 环境关键包版本

| 包 | 版本 |
|----|------|
| Python | 3.10 |
| torch | 2.12.0.dev20260324+cu128 |
| mmcv | 2.1.0 |
| fastapi | 0.135.2 |
| uvicorn | 0.42.0 |
| gradio | 5.24.0 |

### 显存消耗参考

| 模式 | 预计显存 | RTX 5090 (32GB) |
|------|----------|-----------------|
| float32 | ~14-16 GB | ✅ 足够 |
| float16 | ~8-10 GB | ✅ 足够（推荐） |

### 相关文档

- AutoVideo 口型同步集成规范：`LIPSYNC_TASKS.md`
- RTX 5090 + MuseTalk 参考文章：https://zenn.dev/toki_mwc/articles/94b612a28391bc
