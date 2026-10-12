# ComfyUI + Z-Image-Turbo FP8 — 文生图服务

AutoVideo 文生图后端(image 视觉模式)的可选新底座:[ComfyUI](https://github.com/comfyanonymous/ComfyUI) server 模式运行 [Z-Image-Turbo](https://huggingface.co/Comfy-Org/z_image_turbo) FP8 工作流,出图快(9 步蒸馏),AutoVideo 通过 `comfyui` provider 接入。

> 仅当项目的 block 使用 `@visual image` 模式时需要。与 `sensenova-t2i` / `glm-image` 按端口并存或二选一。

## 端口与 API

- 默认地址:`http://127.0.0.1:8188`
- 提交任务:`POST /prompt`(body: `{ "prompt": <API 格式 workflow JSON> }`,返回 `{ "prompt_id" }`)
- 轮询结果:`GET /history/{prompt_id}`(出现 outputs 即完成)
- 取图:`GET /view?filename=...&subfolder=...&type=output`
- 健康检查:`GET /system_stats`

AutoVideo 的 `comfyui` provider 已实现上述完整流程,无需手工调用。

## 前置条件

- Ubuntu 22.04 + NVIDIA GPU(3090 / 4090)
- Python 3.12+ + [uv](https://github.com/astral-sh/uv) + git + curl

## 安装

```bash
bash install.sh    # clone ComfyUI 到 ./repo + uv venv + 下载模型(SKIP_MODEL=1 跳过模型)
```

模型文件(自动下载到 `repo/models/`,文件名可用环境变量覆盖):

| 用途 | 默认文件 | 默认来源 |
|------|---------|---------|
| diffusion_models | `z-image-turbo-fp8-e4m3fn.safetensors` | `T5B/Z-Image-Turbo-FP8`(HF) |
| text_encoders | `qwen_3_4b.safetensors` | `Comfy-Org/z_image_turbo`(HF) |
| vae | `ae.safetensors` | `Comfy-Org/z_image_turbo`(HF) |

覆盖方式:`COMFYUI_UNET_FILE` / `COMFYUI_UNET_URL`、`COMFYUI_CLIP_FILE` / `COMFYUI_CLIP_URL`、`COMFYUI_VAE_FILE` / `COMFYUI_VAE_URL`;`HF_ENDPOINT` 默认 `https://hf-mirror.com`。

## 启动

```bash
bash start.sh
```

环境变量:`PORT`(8188)、`HOST`(0.0.0.0)、`COMFYUI_REPO_DIR`、`COMFYUI_EXTRA_ARGS`(如 `--lowvram`)。

## 工作流模板

`workflow-z-image-turbo-fp8.api.json` 是 **ComfyUI API 格式**(非 UI 导出的 nodes/links 格式)的 Z-Image-Turbo 文生图工作流,内含占位符:

| 占位符 | 替换内容 |
|--------|---------|
| `{{PROMPT}}` | block 视觉描述 |
| `{{NEGATIVE_PROMPT}}` | `imageGen.negativePrompt`(默认空) |
| `{{WIDTH}}` / `{{HEIGHT}}` | 目标分辨率(建议 8 的整数倍) |
| `{{SEED}}` | `imageGen.seed`,未配置时每张随机 |

默认采样参数:9 steps / cfg 1.0 / euler / simple。自定义时复制该文件、改节点参数,然后:

```bash
export COMFYUI_WORKFLOW_PATH=/path/to/your-workflow.api.json
```

> 注意:改 `unet_name` / `clip_name` / `vae_name` 要与 `repo/models/` 下实际文件一致;换自定义节点需先在 ComfyUI 里装好对应插件。

## 接入 AutoVideo

`autovideo.config.json`(provider 字段的 `"comfyui"` 枚举待集成合入共享 schema,当前可直接用环境变量):

```bash
export IMAGE_GEN_PROVIDER=comfyui
export IMAGE_GEN_BASE_URL=http://127.0.0.1:8188   # 或 COMFYUI_BASE_URL
```

```json
{
  "imageGen": {
    "provider": "comfyui",
    "baseURL": "http://127.0.0.1:8188",
    "model": "z-image-turbo-fp8",
    "workflowPath": "third_servers/comfyui/workflow-z-image-turbo-fp8.api.json",
    "negativePrompt": "",
    "pollIntervalMs": 1000
  }
}
```

> `comfyui` provider 不需要 apiKey;不配置 `workflowPath` 时使用 `src/ai/image-gen.ts` 内置的同款 Z-Image-Turbo 工作流。

## 说明

ComfyUI 本体与模型权重(数十 GB)clone/下载到 `./repo`,不纳入本仓库;本目录只提供部署/启动脚本与 workflow 模板。
