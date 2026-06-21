# AutoVideo — MuseTalk 口型同步功能任务文档

> **目标**：在视频左下角叠加一个数字人口型同步画中画，嘴型与旁白音频匹配。
>
> **核心流程**：render 拼接后 → 提取音频 → 调用 MuseTalk → 圆角叠加 → 继续后续步骤

---

## 0. 概述

### 0.1 功能描述

用户在项目中上传一个首尾相接的人物头像 loop 视频（192x192, 30fps, mp4），在 `meta.md` 中通过 `avatarRef` 字段引用。编译构建时，引擎在视频拼接完成后：

1. 从拼接后的 `final.mp4` 提取完整音频轨
2. 将 avatar 视频 + 完整音频发送给本机 MuseTalk 服务
3. 获得口型匹配的视频（不含音频，时长与总视频一致）
4. 将口型视频以圆角矩形叠加到主视频左下角（边距 5px）
5. 继续执行响度归一化和 QA 检查

### 0.2 输入/输出

| 项 | 说明 |
|----|------|
| **输入 1** | `avatarRef` 指定的 loop 视频（192x192, 30fps, mp4, 首尾帧可无缝循环） |
| **输入 2** | 从 `final.mp4` 提取的完整音频轨（WAV） |
| **输出** | 含口型画中画的最终视频（叠加后继续走 loudnorm + QA） |

### 0.3 前置条件

- MuseTalk 服务已部署并运行在 `http://localhost:8001`
- GPU 环境就绪（RTX 5090）
- avatar 视频已上传到项目目录

---

## 1. MuseTalk 服务 API 契约

### 1.1 端点

```
POST http://localhost:8001/lipsync
Content-Type: multipart/form-data
```

### 1.2 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `video` | File (mp4) | 是 | 人物头像 loop 视频（192x192, 30fps） |
| `audio` | File (wav) | 是 | 完整旁白音频 |
| `fps` | int | 否 | 输出帧率，默认 30 |

### 1.3 响应

| 状态码 | Body | 说明 |
|--------|------|------|
| 200 | `video/mp4` binary | 口型同步视频（无音频轨，时长与输入音频一致） |
| 400 | JSON `{"error": "..."}` | 参数错误 |
| 500 | JSON `{"error": "..."}` | 推理失败 |

### 1.4 行为说明

- 服务端自行处理 avatar 视频循环（输入可能只有 3-5 秒，输出可能 6 分钟）
- 输出视频分辨率与输入 avatar 一致（192x192）
- 输出视频帧率与 `fps` 参数一致（默认 30）
- 输出视频不包含音频轨

### 1.5 超时

客户端 HTTP 超时设置为 **10 分钟**（600,000ms）。

---

## 2. 在 AutoVideo 引擎中的集成位置

### 2.1 现有 render 流程

```
Step 6: 渲染各块 partial → output/partials/{blockId}.mp4
Step 7: 拼接 partials → output/final.mp4
Step 8: 响度归一化 → output/final_normalized.mp4
Step 9: QA 检查
```

### 2.2 新增步骤（插入 Step 7 和 Step 8 之间）

```
Step 6:   渲染各块 partial → output/partials/{blockId}.mp4
Step 7:   拼接 partials → output/final.mp4
Step 7.5: 【新增】口型同步叠加
          a. 从 final.mp4 提取音频 → output/full_audio.wav
          b. 调用 MuseTalk API (avatar.mp4 + full_audio.wav) → output/lipsync_raw.mp4
          c. 圆角叠加 lipsync_raw.mp4 到 final.mp4 左下角 → 覆盖 final.mp4
Step 8:   响度归一化 → output/final_normalized.mp4
Step 9:   QA 检查
```

### 2.3 跳过条件

如果 `meta.md` 中没有 `avatarRef` 字段或字段为空，**跳过 Step 7.5**，流程与原来一致。

---

## 3. 详细任务分解

### Task L1: meta.md 解析 — 添加 avatarRef 字段

**文件**：`src/parser/meta.ts`

**做什么**：
1. 在 `DEFAULTS` 中添加 `avatarRef: undefined`（可选字段）
2. 从 meta segment 解析 `avatarRef` 值
3. 如果提供了 `avatarRef`，resolve 为绝对路径（相对于 meta.md 所在目录）
4. 验证文件存在且为 `.mp4` 后缀
5. 如果未提供，值为 `undefined`，后续流程跳过口型同步

**类型变更**：
```typescript
// src/parser/meta.ts
interface ParsedMeta {
  // ... existing fields ...
  avatarRef?: string;  // absolute path to avatar mp4, or undefined
}
```

**验收**：
- `meta.md` 中写 `avatarRef: ./avatar.mp4` 时能正确解析为绝对路径
- 文件不存在时抛出 CompileError
- 不写 `avatarRef` 时值为 undefined，不报错

---

### Task L2: Script 类型和 Schema — 传递 avatarRef

**文件**：
- `src/types/script.ts`
- `schemas/script.schema.json`

**做什么**：
1. 在 `Script.meta` 接口中添加可选字段 `avatarRef?: string`
2. 在 schema 的 `meta.properties` 中添加：
   ```json
   "avatarRef": {
     "type": "string",
     "description": "Absolute path to avatar loop video for lip-sync overlay"
   }
   ```
3. 注意：schema 的 `meta.required` 不需要改（avatarRef 是可选的）

**验收**：
- `npx tsc -p tsconfig.server.json --noEmit` 无错误
- 编译含 `avatarRef` 的项目时 schema 验证通过
- 编译不含 `avatarRef` 的项目时 schema 验证也通过

---

### Task L3: compile.ts — 将 avatarRef 写入 script.json

**文件**：`src/cli/compile.ts`

**做什么**：
1. 在组装 `Script.meta` 对象时，如果 `meta.avatarRef` 存在，写入 `avatarRef` 字段
2. 值为绝对路径字符串

**验收**：
- 编译后 `script.json` 的 `meta` 中包含 `avatarRef`（当 meta.md 中配置了时）
- 未配置时 `script.json` 中无此字段

---

### Task L4: Snapshot — 复制 avatar 视频到 _snapshot

**文件**：`server/services/taskRunner.ts`

**做什么**：
1. 在 `snapshotSourceFiles` 函数中，检测 `meta.md` 中的 `avatarRef`
2. 如果存在，将 avatar 视频复制到 `_snapshot/` 目录
3. 更新 snapshot 中 `meta.md` 的 `avatarRef` 路径指向 snapshot 内的副本

**验收**：
- 上传 avatar.mp4 后，build 时 `_snapshot/` 中有 avatar.mp4 副本
- snapshot 内 meta.md 的 avatarRef 路径正确

---

### Task L5: MuseTalk 客户端模块

**新文件**：`src/render/lipsync.ts`

**做什么**：
1. 实现 `callMuseTalk(avatarPath, audioPath, fps, signal?)` 函数
2. 使用 `fetch` 发送 multipart/form-data 请求到 MuseTalk 服务
3. 接收返回的 mp4 binary，写入指定输出路径
4. 处理超时（10 分钟）和错误响应
5. 支持 AbortSignal 取消

**接口**：
```typescript
export interface LipsyncOptions {
  /** 绝对路径：avatar loop 视频 */
  avatarPath: string;
  /** 绝对路径：完整音频 WAV */
  audioPath: string;
  /** 输出路径：口型视频 mp4 */
  outputPath: string;
  /** 帧率 */
  fps: number;
  /** MuseTalk 服务地址 */
  serviceUrl: string;
  /** 取消信号 */
  signal?: AbortSignal;
}

export async function generateLipsync(options: LipsyncOptions): Promise<void>;
```

**错误处理**：
- 服务不可用（ECONNREFUSED）→ 抛出 `RenderError("MuseTalk service unavailable at {url}")`
- 服务返回 4xx/5xx → 抛出 `RenderError("MuseTalk failed: {error message}")`
- 超时 → 抛出 `RenderError("MuseTalk request timed out (10min)")`
- 任何错误导致 **build 失败**（不降级）

**验收**：
- Mock 测试：正确构造 multipart 请求
- 错误处理：各种失败情况都有明确错误信息

---

### Task L6: 音频提取 + 圆角叠加 — FFmpeg 命令封装

**新文件**：`src/render/lipsync.ts`（同 L5 文件，追加）

**做什么**：

#### 6a. 音频提取函数

```typescript
/**
 * 从视频中提取完整音频轨为 WAV
 * ffmpeg -i final.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 full_audio.wav
 */
export async function extractAudio(
  videoPath: string,
  outputWavPath: string,
  signal?: AbortSignal
): Promise<void>;
```

注意：MuseTalk 通常需要 16kHz 单声道 WAV，所以提取时重采样。

#### 6b. 圆角叠加函数

```typescript
/**
 * 将口型视频以圆角矩形叠加到主视频左下角
 *
 * FFmpeg filter 思路：
 * 1. 用 format=yuva420p 给 lipsync 视频添加 alpha 通道
 * 2. 用 geq 创建圆角矩形 alpha mask（圆角半径 16px）
 * 3. overlay 到主视频的 (5, H-192-5) 位置
 */
export async function overlayLipsync(
  mainVideoPath: string,
  lipsyncVideoPath: string,
  outputPath: string,
  options: {
    size: number;       // 192
    margin: number;     // 5
    radius: number;     // 16 (圆角半径)
    position: 'bottom-left';
  },
  signal?: AbortSignal
): Promise<void>;
```

**FFmpeg 命令参考**：
```bash
ffmpeg -y -i final.mp4 -i lipsync_raw.mp4 -filter_complex \
  "[1:v]format=yuva420p,geq=\
    lum='lum(X,Y)':\
    cb='cb(X,Y)':\
    cr='cr(X,Y)':\
    a='if(\
      lt(X,R)*lt(Y,R)*gt(pow(X-R,2)+pow(Y-R,2),pow(R,2))\
      +gt(X,W-R)*lt(Y,R)*gt(pow(X-W+R,2)+pow(Y-R,2),pow(R,2))\
      +lt(X,R)*gt(Y,H-R)*gt(pow(X-R,2)+pow(Y-H+R,2),pow(R,2))\
      +gt(X,W-R)*gt(Y,H-R)*gt(pow(X-W+R,2)+pow(Y-H+R,2),pow(R,2)),\
      0,255)'\
  [avatar];\
  [0:v][avatar]overlay=5:main_h-192-5:shortest=1" \
  -c:a copy \
  output.mp4
```

其中 `R=16`（圆角半径），`W=192`，`H=192`。

**验收**：
- 提取的音频为 16kHz 单声道 WAV
- 叠加后的视频左下角有 192x192 圆角矩形画中画
- 边距为 5px
- 主视频音频轨保持不变

---

### Task L7: 集成到 render.ts

**文件**：`src/cli/render.ts`

**做什么**：

在 concat 完成后、loudnorm 之前插入口型同步流程：

```typescript
// Step 7: Concat → final.mp4
// ...existing concat code...

// Step 7.5: Lip-sync overlay (only if avatarRef is configured)
if (meta.avatarRef) {
  emit(85, "生成口型同步");
  
  const fullAudioPath = path.join(outputDir, 'full_audio.wav');
  const lipsyncRawPath = path.join(outputDir, 'lipsync_raw.mp4');
  const finalWithLipsyncPath = path.join(outputDir, 'final_lipsync.mp4');
  
  // a. 提取音频
  await extractAudio(finalPath, fullAudioPath, signal);
  
  // b. 调用 MuseTalk
  await generateLipsync({
    avatarPath: meta.avatarRef,
    audioPath: fullAudioPath,
    outputPath: lipsyncRawPath,
    fps: meta.fps,
    serviceUrl: config.musetalk?.url ?? 'http://localhost:8001',
    signal,
  });
  
  // c. 圆角叠加
  await overlayLipsync(
    finalPath,
    lipsyncRawPath,
    finalWithLipsyncPath,
    { size: 192, margin: 5, radius: 16, position: 'bottom-left' },
    signal,
  );
  
  // d. 替换 final.mp4
  fs.renameSync(finalWithLipsyncPath, finalPath);
  
  // 清理临时文件
  fs.unlinkSync(fullAudioPath);
  fs.unlinkSync(lipsyncRawPath);
}

// Step 8: Loudness normalization → final_normalized.mp4
// ...existing loudnorm code...
```

**进度分配调整**：
```
render 阶段（65%-95%）:
  - 渲染 partials: 65%-80%
  - 拼接: 80%-83%
  - 口型同步: 83%-88%（新增）
  - 响度归一化: 88%-92%
  - QA 检查: 92%-95%
```

**验收**：
- 配置了 `avatarRef` 时，最终视频左下角有口型画中画
- 未配置时，流程与原来完全一致
- MuseTalk 失败时，build 报错并显示明确错误信息
- 取消任务时，MuseTalk 请求被中断

---

### Task L8: 配置项 — MuseTalk 服务地址

**文件**：
- `server/types/api.ts`（AppConfig 类型）
- `server/routes/settings.ts`（设置面板 API）
- `web/src/views/SettingsView.vue`（前端设置面板）

**做什么**：
1. 在 AppConfig 中添加 `musetalk` 配置组：
   ```typescript
   musetalk?: {
     url: string;  // 默认 "http://localhost:8001"
   }
   ```
2. 支持环境变量覆盖：`MUSETALK_URL`
3. 在 Web 设置面板中添加 MuseTalk 服务地址输入框
4. 优先级：环境变量 > 设置面板 > 默认值

**验收**：
- 设置面板中可以配置 MuseTalk URL
- 环境变量 `MUSETALK_URL=http://xxx:8001` 能覆盖设置
- 默认值 `http://localhost:8001` 可以直接使用

---

### Task L9: AUTHORING.md 更新

**文件**：`AUTHORING.md`

**做什么**：
在 `meta.md` 字段说明表中添加 `avatarRef` 字段：

```markdown
| `avatarRef` | string | — | 口型同步 avatar 视频路径（192x192, 30fps, mp4, 首尾帧循环） |
```

添加一个新的小节说明：
```markdown
### 口型同步（可选）

在 `meta.md` 中指定 `avatarRef` 可启用数字人口型同步功能：

\`\`\`yaml
avatarRef: ./avatar.mp4
\`\`\`

要求：
- 视频分辨率 192x192，帧率 30fps，格式 mp4
- 视频首尾帧相接（可无缝循环）
- 人物头像居中，面部清晰

效果：最终视频左下角会出现一个小型圆角矩形画中画，
人物嘴型与旁白音频同步。如不需要此功能，不写该字段即可。
```

**验收**：
- 文档准确描述了格式要求和效果

---

### Task L10: Web 前端 — avatar 上传支持

**文件**：
- `web/src/components/project/MetaEditor.vue`（或相关组件）

**做什么**：
1. 在 MetaEditor 中添加 `avatarRef` 字段的编辑/上传 UI
2. 支持上传 mp4 文件到项目根目录
3. 上传后自动设置 `avatarRef: ./avatar.mp4`
4. 显示当前 avatar 视频预览（小缩略图）
5. 支持删除/替换

**验收**：
- 可以通过 UI 上传 avatar 视频
- 上传后 meta.md 中自动添加 avatarRef 字段
- 可以预览已上传的 avatar

---

## 4. 任务依赖关系

```
L1 (meta 解析)
  └→ L2 (类型 + Schema)
       └→ L3 (compile 传递)
            └→ L4 (snapshot 复制)
                 └→ L7 (render 集成)

L5 (MuseTalk 客户端) ─┐
L6 (FFmpeg 封装)    ─┤
                      └→ L7 (render 集成)

L8 (配置项) ──────────→ L7 (render 集成)

L9 (文档) — 独立，随时可做
L10 (前端 UI) — 依赖 L1-L3
```

**建议执行顺序**：
```
L1 → L2 → L3 → L4 → L5 → L6 → L8 → L7 → L10 → L9
```

---

## 5. 技术细节备忘

### 5.1 FFmpeg 命令速查

**提取音频（16kHz 单声道 WAV）**：
```bash
ffmpeg -y -i final.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 full_audio.wav
```

**圆角叠加（R=16, 左下角, 边距 5px）**：
```bash
ffmpeg -y -i final.mp4 -i lipsync_raw.mp4 -filter_complex \
  "[1:v]format=yuva420p,geq=\
    lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':\
    a='if(\
      lt(X,16)*lt(Y,16)*gt(pow(X-16,2)+pow(Y-16,2),pow(16,2))\
      +gt(X,176)*lt(Y,16)*gt(pow(X-176,2)+pow(Y-16,2),pow(16,2))\
      +lt(X,16)*gt(Y,176)*gt(pow(X-16,2)+pow(Y-176,2),pow(16,2))\
      +gt(X,176)*gt(Y,176)*gt(pow(X-176,2)+pow(Y-176,2),pow(16,2)),\
      0,255)'\
  [avatar];[0:v][avatar]overlay=5:main_h-192-5:shortest=1" \
  -c:a copy output.mp4
```

### 5.2 配置默认值

| 配置项 | 默认值 | 环境变量 |
|--------|--------|----------|
| MuseTalk URL | `http://localhost:8001` | `MUSETALK_URL` |
| 请求超时 | 600000ms (10min) | — |
| 圆角半径 | 16px | — |
| 画中画大小 | 192x192 | — |
| 边距 | 5px | — |

### 5.3 错误处理策略

| 错误场景 | 处理 |
|----------|------|
| MuseTalk 服务不可用 | Build 失败，报错 "MuseTalk service unavailable" |
| MuseTalk 推理失败 | Build 失败，报错含服务端错误信息 |
| 请求超时 | Build 失败，报错 "MuseTalk request timed out" |
| avatar 文件不存在 | Compile 阶段失败（meta 解析时检查） |
| avatar 格式错误 | Compile 阶段失败 |
| 未配置 avatarRef | 跳过口型同步步骤，流程正常 |

### 5.4 文件产物

Build 完成后，`output/` 目录中的文件：
```
output/
├── partials/
│   ├── B01.mp4
│   ├── B02.mp4
│   └── ...
├── concat.txt
├── final.mp4              ← 含口型叠加（如果配置了 avatarRef）
├── final_normalized.mp4   ← 最终输出
├── full_audio.wav         ← 临时文件，处理完删除
└── lipsync_raw.mp4        ← 临时文件，处理完删除
```

---

## 6. 测试计划

### 6.1 单元测试

- [ ] `avatarRef` meta 解析（有/无/文件不存在）
- [ ] Schema 验证（有/无 avatarRef）
- [ ] MuseTalk 客户端 mock 测试（成功/失败/超时）
- [ ] 音频提取命令正确性
- [ ] FFmpeg overlay 命令正确性

### 6.2 集成测试

- [ ] 完整 build（含 avatarRef）→ 视频左下角有画中画
- [ ] 完整 build（无 avatarRef）→ 流程正常，无画中画
- [ ] MuseTalk 服务宕机时 build 报错信息清晰
- [ ] 取消任务时 MuseTalk 请求中断

### 6.3 验收标准

- [ ] 口型视频与旁白音频同步
- [ ] 画中画位置正确（左下角，边距 5px）
- [ ] 圆角矩形显示正确（半径 ~16px）
- [ ] 不影响主视频内容和质量
- [ ] 不影响音频质量（loudnorm 正常工作）
- [ ] QA 检查通过
