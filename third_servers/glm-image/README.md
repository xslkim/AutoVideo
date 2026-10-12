# GLM-Image — 文生图服务

AutoVideo 文生图后端(image 视觉模式)的可选新底座,基于智谱 [GLM-Image](https://huggingface.co/zai-org/GLM-Image)(自回归 + 扩散双引擎),通过 [SGLang Diffusion](https://github.com/sgl-project/sglang) 暴露 **OpenAI 兼容**的文生图 API,直接复用 AutoVideo 的 `openai` provider。

> 仅当项目的 block 使用 `@visual image` 模式时需要。与 `sensenova-t2i` 二选一(或并存不同端口)。

## 端口与 API

- 默认地址:`http://127.0.0.1:8005`
- 文生图:`POST /v1/images/generations`(OpenAI images 格式:`model` + `prompt` + `size` + `response_format: b64_json`)
- 健康检查:`GET /v1/models`

## 前置条件

- Ubuntu 22.04 + NVIDIA GPU(建议 3090 / 4090 及以上)
- Python 3.10+ + [uv](https://github.com/astral-sh/uv)

## 安装

```bash
bash install.sh    # 创建 .venv + 安装 sglang[diffusion] + 预下载模型(SKIP_MODEL=1 可跳过预下载)
```

## 启动

```bash
bash start.sh
```

环境变量:`PORT`(8005)、`HOST`(0.0.0.0)、`GLM_IMAGE_MODEL_ID`(zai-org/GLM-Image)、`GLM_IMAGE_MODEL_PATH`(本地权重目录,存在 config.json 时优先)、`HF_ENDPOINT`(默认 hf-mirror.com)、`SGLANG_EXTRA_ARGS`(追加给 `sglang serve` 的额外参数,如 `--mem-fraction-static 0.8`)。

## 接入 AutoVideo

环境变量(立即可用):

```bash
export IMAGE_GEN_BASE_URL=http://127.0.0.1:8005
export IMAGE_GEN_API_KEY=glm-image-local   # 本端不校验,但 openai provider 要求非空,任意占位即可
export IMAGE_GEN_SIZE_MAPPER=glm-image     # 关键:见下方说明
```

`autovideo.config.json`(`model` 必须改为本端模型 ID——sglang 会校验请求里的 model;`sizeMapper` 字段待集成合入共享 schema 后生效):

```json
{
  "imageGen": {
    "provider": "openai",
    "baseURL": "http://127.0.0.1:8005",
    "apiKey": "glm-image-local",
    "model": "zai-org/GLM-Image",
    "sizeMapper": "glm-image"
  }
}
```

> **`sizeMapper: "glm-image"` 必须开启**:GLM-Image 要求宽高为 32 的整数倍且只支持固定分辨率阶梯;开启后 AutoVideo 会把 `1920x1080` 映射为 `1664x928`、`1080x1920` 映射为 `928x1664`,其余尺寸就近吸附到 32 网格。

## 说明

本目录只提供部署/启动脚本,模型权重与 sglang 依赖安装在 `./.venv` 与 `./models/`,不纳入仓库。sglang diffusion 对 GLM-Image 的支持迭代较快,install.sh 默认从 GitHub 主干安装;需要稳定版可设 `SGLANG_SPEC="sglang[diffusion]"` 改装 PyPI 版。
