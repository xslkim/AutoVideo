# MuseTalk — 口型/唇形同步服务

AutoVideo 的口型同步后端(avatar PiP 模式),基于 [MuseTalk](https://github.com/TMElyralab/MuseTalk)。

> 仅当项目的 meta 设置 `avatarRef` 且未设 `skipLipsync: true` 时需要。

## 端口与 API

- 默认地址:`http://127.0.0.1:8001`
- 健康检查:`GET /health`
- 唇形同步:`POST /lipsync`(视频 + 音频,返回口型同步后的视频)

## 前置条件

- Ubuntu 22.04 + NVIDIA GPU(3090 / 4090)
- conda(MuseTalk 用 conda 环境 `MuseTalk`)
- MuseTalk 权重(默认只装 **MuseTalk 1.5 / v15** 集,见下节)

## 安装

```bash
bash install.sh    # clone 上游 + 建 conda 环境 + 下载 v15 权重
```

环境变量:`SKIP_MODEL=1`(跳过权重)、`MUSETALK_WEIGHTS=v15|all`(默认 `v15`,只下 1.5 权重;`all` 跑上游 `download_weights.sh` 含 V1.0)。

## MuseTalk 1.5(v15)说明

本服务的 FastAPI 包装(`lipsync_server.py`,在上游仓库目录)自部署起即固定加载 **`models/musetalkV15/`**(1.5)权重,相比 V1.0 嘴部区域更清晰、画质更好。相关参数约定:

| 参数 / 机制 | 适用位置 | 说明 |
|-------------|----------|------|
| `--version v15` | 上游 `scripts/inference.py` / `realtime_inference.py`;新版 `lipsync_server.py` | 选择权重版本(上游默认已是 `v15`)。`start.sh` 会自动检测服务脚本是否支持该参数,支持则用 `MUSE_VERSION`(默认 `v15`)传入,旧版脚本跳过 |
| preparation 缓存 | 上游 `realtime_inference.py`:`configs/realtime.yaml` 里 `preparation: True`;本服务等价物为 **`avatar_cache/`** | 首次为 avatar 预生成人脸坐标 + 帧缓存,后续请求跳过检测与提帧。本服务按 `md5(avatar 内容)+bbox_shift` 键控持久化,换素材自动失效 |
| `--skip_save_images` | 上游 `realtime_inference.py` | 中间帧不落盘 PNG 直接编码,省磁盘 IO。本服务当前为逐帧 PNG 流程,**不支持**该参数 |

显存不变:float16 约 8–10 GB(推荐,`start.sh` 默认开 `--use_float16`)。

## 启动

```bash
bash start.sh
```

环境变量:`MUSE_PORT`(8001)、`MUSE_HOST`(0.0.0.0)、`MUSETALK_REPO_DIR`(仓库目录)、`MUSE_CONDA_ENV`(默认 `MuseTalk`)、`MUSE_VERSION`(默认 `v15`)、`MUSE_MAX_AVATAR_SECONDS`(默认 15)。

## 文件

- `start.sh` / `install.sh` — 启动 / 安装脚本
- `DEPLOY.md` / `USAGE.md` — 详细部署与使用说明

## 说明

服务源码在上游 MuseTalk 仓库(含模型约 8 GB),本目录只提供部署/启动脚本,源码 clone 到 `./repo`。
