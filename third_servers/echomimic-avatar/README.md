# EchoMimicV3-Flash — 半身虚拟讲师服务

AutoVideo 的数字人后端(静态参考图 → 半身带表情讲课片段),基于蚂蚁集团 [EchoMimicV3-Flash](https://github.com/antgroup/echomimic_v3)(AAAI 2026)。

- 输入:**一张参考肖像图** + 一段旁白 wav
- 输出:**768×768、带表情与口型的半身视频片段**(无音轨 mp4,与渲染管线叠加约定一致)
- Flash 特性:8 步推理、无需人脸 mask、最高 768×768
- **显存需求:≥ 12 GB**(bfloat16);CUDA ≥ 12.1

> 仅当使用图片型数字人 avatar 时需要;视频 loop 头像请继续用 [`musetalk-lipsync/`](../musetalk-lipsync/)。

## 端口与 API

- 默认地址:`http://127.0.0.1:8006`
- 健康检查:`GET /health` → `{"status":"ok","gpu":...,"mode":"flash","resolution":"768x768"}`(权重/仓库未就绪返回 503)
- 生成:`POST /avatar`(multipart)

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `image` | 文件 | 是 | — | 参考肖像 `.png/.jpg/.jpeg/.webp`,半身正脸效果最佳 |
| `audio` | 文件 | 是 | — | 旁白 `.wav` |
| `fps` | int | 否 | 25 | 输出帧率(1–60) |
| `seed` | int | 否 | 43 | 采样种子 |
| `prompt` | str | 否 | `"A person is speaking."` | 文本提示词 |
| `steps` | int | 否 | 8 | 采样步数(Flash 8 步即可) |
| `audio_guidance_scale` | float | 否 | 3.0 | Audio CFG,官方建议 1.8–2 之间权衡口型/画质 |

成功响应 `video/mp4`(**无音频轨**,由服务端剥除);失败 JSON `{"error":"..."}`(400 参数问题 / 500 推理异常 / 503 未就绪)。同一时间只处理一个请求(全局锁),并发排队。

## 与 musetalk-lipsync 的接口差异

| 维度 | MuseTalk(`POST /lipsync`,:8001) | EchoMimicV3-Flash(`POST /avatar`,:8006) |
|------|--------------------------------|------------------------------------------|
| avatar 输入 | **循环视频** mp4(几秒,含清晰正脸) | **静态参考图** png/jpg |
| 表单字段 | `video` + `audio` + `fps` | `image` + `audio` + `fps/seed/prompt/steps/...` |
| 生成方式 | 仅替换嘴部区域(其余画面来自原视频) | 扩散模型全画面生成(半身 + 表情 + 口型) |
| 输出分辨率 | 与输入 avatar 一致 | **固定 768×768** |
| 输出音轨 | 无 | 无(一致) |
| 帧数/时长 | 跟随音频 1:1 | 按 Wan 约定 4n+1 帧,`--max-seconds`(默认 30)封顶 |
| 耗时 | 较快(UNet 单步) | 较慢(8 步扩散) |

### src/render/lipsync.ts 适配点

`generateLipsync()` 已内置最小后端开关(`backend: "musetalk" | "echomimic"`,默认 musetalk 行为不变):echomimic 时表单字段用 `image`、端点为 `/avatar`。其余集成(render.ts 按 avatarRef 类型路由、`echomimic.url` 配置、画中画尺寸改为探测生成结果而非源 avatar——因为输出固定 768×768)见 `docs/upgrade-2026/integration/avatar-upgrade.md`。

## 前置条件

- Ubuntu 22.04 + NVIDIA GPU,**显存 ≥ 12 GB**
- conda(环境名 `echomimic_v3`,Python 3.10)
- FFmpeg 在 `PATH` 中(服务端剥音轨、探测音频时长)

## 安装

```bash
bash install.sh    # clone 上游 + 建 conda 环境 + 下载权重(可用 SKIP_MODEL=1 跳过权重)
```

权重布局(`repo/flash/`,上游约定):

```
repo/flash/
├── transformer/diffusion_pytorch_model.safetensors   # EchoMimicV3-Flash 主权重
├── Wan2.1-Fun-V1.1-1.3B-InP/                          # 基础模型(VAE / text encoder)
└── chinese-wav2vec2-base/                             # 中文音频编码器
```

## 启动 / 停止

```bash
bash start.sh                    # 默认 0.0.0.0:8006
# 停止: 见下文显存排程(stop.sh 集成后支持 avatar|echomimic)
```

环境变量:`ECHO_PORT`(8006)、`ECHO_HOST`(0.0.0.0)、`ECHOMIMIC_REPO_DIR`(仓库目录)、`ECHO_CONDA_ENV`(默认 `echomimic_v3`)、`ECHO_MAX_SECONDS`(单片段封顶秒数,默认 30)、`ECHO_WEIGHT_DTYPE`(默认 `bfloat16`)。

## 显存互斥与排程

本服务常驻约 **12 GB** 显存,与 TTS(VoxCPM2 / CosyVoice3)、文生图(SenseNova)、MuseTalk(fp16 约 8–10 GB)**无法在同一张消费级显卡上全部并存**。沿用仓库既有的 **stop.sh 串行切换**模式——渲染到哪个阶段就起哪个服务,用完即停:

```bash
# 典型流水线串行排程(单卡 24GB 示例)
bash third_servers/stop.sh                    # 清空
bash third_servers/voxcpm-tts/start.sh &      # 阶段一:TTS
bash third_servers/stop.sh tts
bash third_servers/echomimic-avatar/start.sh &# 阶段二:数字人生成
bash third_servers/stop.sh avatar             # (集成后;当前可用 fuser -k 8006/tcp)
```

MuseTalk 与 EchoMimic 同为 avatar 后端,二选一即可,**不要同时常驻**。集成事项(stop.sh 增加 `avatar` target、`third_servers/README.md` 矩阵行)见 `docs/upgrade-2026/integration/avatar-upgrade.md`。

## 文件

- `server.py` — FastAPI 服务(本仓库收录;子进程包装上游 `infer_flash.py`)
- `install.sh` / `start.sh` — 安装 / 启动脚本
- `repo/` — 上游 echomimic_v3 clone(install.sh 生成,不入库)

## 常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `/health` 503 | 权重缺失或仓库未 clone | 按 `error` 字段提示补权重 / 跑 install.sh |
| 400 `image must be ...` | 参考图后缀不对 | 转成 png/jpg 再传 |
| 500 `infer_flash failed` | 上游推理报错(显存不足/权重不全) | 看 stderr 尾部;显存不足确认 ≥12GB 且无其它服务占用 |
| 输出时长比音频短 | 超过 `--max-seconds` 封顶 | AutoVideo 按 block 调用一般 ≤30s;需更长调 `ECHO_MAX_SECONDS` |
| 生成很慢 | 8 步扩散 + 帧数多 | 正常;确认 teacache 已开(默认开) |

## 参考

- 上游仓库:https://github.com/antgroup/echomimic_v3
- 权重:https://huggingface.co/BadToBest/EchoMimicV3(`echomimicv3-flash-pro/`)
- 论文:https://arxiv.org/abs/2507.03905
