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
- MuseTalk 权重(`download_weights.sh` 下载)

## 安装

```bash
bash install.sh    # clone 上游 + 建 conda 环境 + 下载权重(可用 SKIP_MODEL=1 跳过权重)
```

## 启动

```bash
bash start.sh
```

环境变量:`MUSE_PORT`(8001)、`MUSE_HOST`(0.0.0.0)、`MUSETALK_REPO_DIR`(仓库目录)、`MUSE_CONDA_ENV`(默认 `MuseTalk`)。

## 文件

- `start.sh` / `install.sh` — 启动 / 安装脚本
- `DEPLOY.md` / `USAGE.md` — 详细部署与使用说明

## 说明

服务源码在上游 MuseTalk 仓库(含模型约 8 GB),本目录只提供部署/启动脚本,源码 clone 到 `./repo`。
