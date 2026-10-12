# 集成事项 — avatar-upgrade(数字人升级)

任务 slug:`avatar-upgrade`。本任务完成内容:

- `third_servers/musetalk-lipsync/`(MuseTalk 1.5 升级):
  - `install.sh`:新增 `MUSETALK_WEIGHTS` 环境变量,`v15`(默认,只下 musetalkV15 + 共享辅助模型,内联 huggingface-cli/gdown 下载)/ `all`(跑上游 `download_weights.sh` 含 V1.0);`SKIP_MODEL=1` 行为不变。
  - `start.sh`:新增 `MUSE_VERSION`(默认 `v15`,grep 检测 `lipsync_server.py` 支持 `--version` 时才传入,旧版脚本自动跳过)与 `MUSE_MAX_AVATAR_SECONDS`(默认 15,与服务端原默认值一致)。
  - `README.md`:新增「MuseTalk 1.5(v15)说明」章节(`--version v15` / preparation 缓存(=服务端 `avatar_cache/`)/ `--skip_save_images` 上游参数对照表)。
  - `USAGE.md`:参数表后补 v15 说明段。
- `third_servers/echomimic-avatar/`(新建,EchoMimicV3-Flash 半身虚拟讲师):
  - `server.py`:FastAPI 脚手架。`GET /health`(权重缺失 503)、`POST /avatar`(multipart:`image`+`audio`+可选 `fps/seed/prompt/steps/audio_guidance_scale` → 768×768 无音轨 mp4);子进程包装上游 `infer_flash.py`,帧数按 Wan 约定 4n+1 从音频时长推导,`--max-seconds`(默认 30)封顶;全局锁串行。
  - `install.sh`:clone antgroup/echomimic_v3 + conda 环境 `echomimic_v3` + 权重(flash transformer、Wan2.1-Fun-V1.1-1.3B-InP、chinese-wav2vec2-base)→ `repo/flash/`;`SKIP_MODEL=1` 支持;12GB 显存标注。
  - `start.sh`:端口 `ECHO_PORT`(默认 8006)、`ECHO_HOST`、`ECHOMIMIC_REPO_DIR`、`ECHO_CONDA_ENV`。
  - `README.md`:API 表、与 musetalk 的接口差异表、lipsync.ts 适配点、显存互斥排程(stop.sh 串行切换)。
- `src/render/lipsync.ts`(最小、向后兼容):新增 `LipsyncBackend` 类型与 `LipsyncOptions.backend?` 字段;`backend: "echomimic"` 时表单字段 `video`→`image`、端点 `/lipsync`→`/avatar`、Content-Type 按图片后缀。**默认 musetalk 行为逐字节不变**,现有调用方零改动。

## 需要集成 Agent 做的共享文件改动

### 1. `third_servers/stop.sh`(禁止我自改)

```bash
# 顶部端口区追加:
ECHOMIMIC_PORT="${ECHOMIMIC_PORT:-8006}"
# 用法注释里 tts + t2i + lipsync + cosy 后补 avatar;可选列表补 avatar | echomimic
# 默认 targets 行改为:
[ ${#targets[@]} -eq 0 ] && targets=(tts t2i lipsync cosy avatar)
# case 追加:
    avatar|echomimic)  stop_one "EchoMimic Avatar" "$ECHOMIMIC_PORT" || rc=1 ;;
```

### 2. `third_servers/README.md`(禁止我自改)

- 服务依赖矩阵追加一行:
  `| **EchoMimicV3-Flash** | 半身数字人(图片 avatar 模式) | \`8006\` | ⬜ 可选 | \`echomimic.url\` |`
- 目录表追加:
  `| [\`echomimic-avatar/\`](echomimic-avatar/) | EchoMimicV3-Flash 数字人 | 服务源码 \`server.py\` + 启动/安装脚本(引擎代码需 clone 上游) |`
- 健康检查表追加:
  `| EchoMimicV3-Flash | \`GET http://127.0.0.1:8006/health\` → \`{ "status": "ok" }\`(未就绪 503) |`
- 快速启动段补一行 `bash third_servers/echomimic-avatar/install.sh && bash third_servers/echomimic-avatar/start.sh &`,并注明:**EchoMimic 常驻约 12GB 显存,与 MuseTalk 二选一,用 stop.sh 串行切换**。
- `stop.sh` 用法注释里的可选列表补 `avatar`。
- 根 `README.md` 若有服务表,同样补一行(端口 8006、配置 `echomimic.url`)。

### 3. `src/config/`(禁止我自改)— 可选配置草案

镜像现有 `musetalk?: { url?: string }` 声明,追加:

```ts
echomimic?: {
  /** EchoMimicV3-Flash avatar 服务地址,默认 http://localhost:8006 */
  url?: string;
};
```

纯可选字段,不破坏现有类型与 web 端。doctor 连通性检查可加 `http://localhost:8006/health`(可选)。

### 4. `schemas/script.schema.json`(禁止我自改)— meta 可选字段草案

```json
"avatarBackend": {
  "type": "string",
  "enum": ["musetalk", "echomimic"],
  "description": "数字人后端。缺省时按 avatarRef 扩展名推断:图片(png/jpg/jpeg/webp)→ echomimic,视频(mp4)→ musetalk。echomimic 输出固定 768×768 半身片段。"
}
```

### 5. `src/cli/render.ts` 路由(较大适配,本任务未动)

两处 lipsync 分支(concatOnly 与主流程,当前各为 `config.musetalk?.url ?? "http://localhost:8001"`)建议改为:

```ts
import type { LipsyncBackend } from "../render/lipsync.js";

const avatarBackend: LipsyncBackend =
  (meta as any).avatarBackend ??
  (/\.(png|jpe?g|webp)$/i.test(meta.avatarRef!) ? "echomimic" : "musetalk");
const avatarServiceUrl = avatarBackend === "echomimic"
  ? (config as any).echomimic?.url ?? "http://localhost:8006"
  : config.musetalk?.url ?? "http://localhost:8001";
// generateLipsync({ ..., serviceUrl: avatarServiceUrl, backend: avatarBackend })
```

画中画尺寸:echomimic 输出固定 768×768 而 avatarRef 是图片,`probeVideoSize(meta.avatarRef)` 不再适用。建议两处统一改为探测生成结果:

```ts
const pipSize = await probeVideoSize(lipsyncFullPath); // musetalk 输出尺寸本就等于 avatar 尺寸,行为不变
// overlayLipsync(..., { width: pipSize.width, height: pipSize.height, ... })
```

`skipLipsync: true` 的原始 loop 叠加路径仍要求视频 avatar;图片 avatar + skipLipsync 建议直接报错提示(或后续用 ffmpeg `-loop 1` 转静态视频,属后续增强)。

### 6. web 设置面板(可选)

设置面板补 EchoMimic endpoint 输入框(默认 `http://localhost:8006`),落 `echomimic.url`。

### 7. 仓库外运维项(不需改代码)

`third_servers/musetalk-lipsync/repo` 是指向 `/home/xsl/work/MuseTalk` 的符号链接,其 `lipsync_server.py` 目前不接受 `--version`(内部已固定 v15)。`start.sh` 已做 grep 自动检测,**不升级也能正常启动**;若日后给该脚本加 `--version` 参数,`MUSE_VERSION` 即自动生效。

## 验证状态

- `npm run build`(tsc):通过。
- `python3 -m py_compile third_servers/echomimic-avatar/server.py`:通过。
- `bash -n` 四个 shell 脚本(install/start × 两个服务):通过。
- 未做真机推理验证:权重未下载(任务约定不真下载模型),EchoMimic `/avatar` 端到端需在 GPU 机器上 install 后自测;`infer_flash.py` 输出文件命名以 `find_output_mp4()`(取调用后最新 mp4)兜底,若上游命名规则变化只需调整该函数。
