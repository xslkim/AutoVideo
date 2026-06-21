# SenseNova-U1 — 文生图服务

AutoVideo 文生图后端(image 视觉模式),基于 [SenseNova-U1](https://github.com/OpenSenseNova/SenseNova-U1) 文生图模型。

> 仅当项目的 block 使用 `@visual image` 模式时需要。`@visual animation` 模式走 Claude 生成组件,无需此服务。

## 端口与 API

- 默认地址:`http://127.0.0.1:8765`
- 文生图:`POST /api/t2i`(prompt + 参数,返回图片)

## 前置条件

- Ubuntu 22.04 + NVIDIA GPU(3090 / 4090)
- Python 3.10+ + [uv](https://github.com/astral-sh/uv)
- SenseNova-U1-8B-MoT 模型权重

## 安装

```bash
bash install.sh    # clone 上游 + uv sync + 下载模型(可用 SKIP_MODEL=1 跳过模型)
```

## 启动

```bash
bash start.sh
```

环境变量:`PORT`(8765)、`HOST`(0.0.0.0)、`SENSENOVA_MODEL_PATH`(权重目录)、`SENSENOVA_USE_GGUF`(低显存 GGUF,默认启用)。

## 说明

服务源码在上游 SenseNova-U1 仓库(含模型达数十 GB),本目录只提供部署/启动脚本,源码 clone 到 `./repo`。完整部署文档见上游仓库 `docs/web_t2i_deployment_CN.md`。
