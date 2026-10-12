# 集成事项 — image-gen-upgrade(文生图底座升级)

> 负责人任务:`src/ai/image-gen.ts` + `third_servers/glm-image/` + `third_servers/comfyui/`(均已完成)。
> 本文档列出需要集成 Agent 合入**共享文件**的改动,均可直接照抄。当前所有功能已通过环境变量可用,以下改动只是让 config 文件路径正式化。

## 1. `src/config/defaults.ts`

### 1a. 放宽 provider 联合类型(L256)

```ts
export type ImageGenProvider = "openai" | "sensenova" | "comfyui";
```

### 1b. `ImageGenConfig`(L258)追加可选字段

```ts
  /** openai provider: snap requested size to a backend-supported grid (e.g. GLM-Image 32px grid) */
  sizeMapper?: "glm-image";
  /** comfyui provider: path to an API-format workflow JSON template ({{PROMPT}} placeholders) */
  workflowPath?: string;
  /** comfyui provider: negative prompt substituted into {{NEGATIVE_PROMPT}} */
  negativePrompt?: string;
  /** comfyui provider: fixed seed; random per request when omitted */
  seed?: number;
  /** comfyui provider: /history poll interval in ms (default 1000) */
  pollIntervalMs?: number;
```

### 1c. `defaults.imageGen`(L373 起)追加 env 透传

```ts
    sizeMapper: (process.env.IMAGE_GEN_SIZE_MAPPER as "glm-image" | undefined) || undefined,
    workflowPath: process.env.COMFYUI_WORKFLOW_PATH,
    negativePrompt: process.env.COMFYUI_NEGATIVE_PROMPT,
    seed: process.env.COMFYUI_SEED ? Number(process.env.COMFYUI_SEED) : undefined,
    pollIntervalMs: process.env.COMFYUI_POLL_INTERVAL_MS
      ? Number(process.env.COMFYUI_POLL_INTERVAL_MS)
      : undefined,
```

## 2. `src/cli/visuals.ts`(L573 附近 generateImage 调用)

config 透传对象追加 5 个字段:

```ts
              const result = await generateImage(block, {
                config: {
                  provider: config.imageGen.provider,
                  baseURL: config.imageGen.baseURL,
                  apiKey: config.imageGen.apiKey,
                  model: config.imageGen.model,
                  size: config.imageGen.size,
                  timeoutMs: config.imageGen.timeoutMs,
                  concurrency: config.imageGen.concurrency,
                  numSteps: config.imageGen.numSteps,
                  cfgScale: config.imageGen.cfgScale,
                  sizeMapper: config.imageGen.sizeMapper,       // 新增
                  workflowPath: config.imageGen.workflowPath,   // 新增
                  negativePrompt: config.imageGen.negativePrompt, // 新增
                  seed: config.imageGen.seed,                   // 新增
                  pollIntervalMs: config.imageGen.pollIntervalMs, // 新增
                },
```

## 3. 环境变量清单(已实现于 `src/ai/image-gen.ts`,无需集成即可用)

| 变量 | 作用 |
|------|------|
| `IMAGE_GEN_PROVIDER=comfyui` | 选择 ComfyUI 后端(defaults.ts 已有透传,cast 使其运行时生效) |
| `COMFYUI_BASE_URL` | 未设 `imageGen.baseURL` 时的 ComfyUI 地址(默认 `http://127.0.0.1:8188`) |
| `COMFYUI_WORKFLOW_PATH` | workflow JSON 模板路径(默认内置 Z-Image-Turbo FP8 工作流) |
| `COMFYUI_POLL_INTERVAL_MS` | `/history` 轮询间隔(默认 1000) |
| `IMAGE_GEN_SIZE_MAPPER=glm-image` | openai provider 尺寸映射:1920x1080→1664x928、1080x1920→928x1664,其余吸附 32 网格 |

## 4. `third_servers/README.md`(共享文件,我没动)

服务矩阵追加两行:

```markdown
| **GLM-Image** | 文生图 (image 视觉模式,OpenAI 兼容 API) | `8005` | ⬜ 可选 | `imageGen.baseURL` |
| **ComfyUI + Z-Image-Turbo** | 文生图 (image 视觉模式,workflow 驱动) | `8188` | ⬜ 可选 | `imageGen.provider=comfyui` / `imageGen.baseURL` |
```

目录表追加:

```markdown
| [`glm-image/`](glm-image/) | GLM-Image 文生图(sglang serve) | 启动/安装脚本(模型首次启动自动下载) |
| [`comfyui/`](comfyui/) | ComfyUI + Z-Image-Turbo FP8 文生图 | workflow 模板 + 启动/安装脚本(源码 clone 上游) |
```

健康检查约定表追加:

```markdown
| GLM-Image | `GET http://127.0.0.1:8005/v1/models`(OpenAI 兼容) |
| ComfyUI | `GET http://127.0.0.1:8188/system_stats` |
```

## 5. `third_servers/stop.sh`(共享文件,我没动)

如支持按服务名停止,可追加端口映射:`glm-image` → 8005、`comfyui`/`t2i-comfyui` → 8188。

## 6. Web 设置面板(`web/src/`,不在我的范围)

- `imageGen.provider` 下拉追加 `comfyui` 选项(选中后 apiKey 非必填)。
- `imageGen.sizeMapper` 可做成 `glm-image` 开关/下拉。

## 7. 无需改动已验证兼容的部分

- `server/routes/system.ts` 的 doctor 健康检查:`comfyui` provider 走 `GET /system_stats`,通用 `resp.ok` 分支即判定成功;`isImageGenConfigured` 对 comfyui 返回 true(无需 apiKey)。
- `src/cache/store.ts` 的 `ImageKey.provider` 是 `string`,`"comfyui"` 直接可用;comfyui 的 workflow/seed 身份已折叠进 cache key 的 model 字段。
- `schemas/script.schema.json`:脚本 IR 不含 imageGen 配置,无需改动。
