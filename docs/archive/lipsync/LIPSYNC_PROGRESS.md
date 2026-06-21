# AutoVideo — MuseTalk 口型同步功能开发进度

> 执行顺序：L1 → L2 → L3 → L4 → L5 → L6 → L8 → L7 → L10 → L9

---

## 当前状态

- **active_task**: `—`
- **next_action**: `所有任务已完成`
- **completed**: `10 / 10`
- **last_updated**: `2026-05-04`

---

## 任务表

| ID | 标题 | 状态 | 修改文件 | Commit | 备注 |
|----|------|------|----------|--------|------|
| L1 | meta.md 解析 — 添加 avatarRef 字段 | done | `src/parser/meta.ts` | — | 添加 avatarRef 可选字段解析和验证 |
| L2 | Script 类型和 Schema — 传递 avatarRef | done | `src/types/script.ts`, `schemas/script.schema.json` | — | 类型+Schema 已更新 |
| L3 | compile.ts — 将 avatarRef 写入 script.json | done | `src/cli/compile.ts` | — | 条件传递 avatarRef |
| L4 | Snapshot — 复制 avatar 视频到 _snapshot | done | `server/services/taskRunner.ts` | — | avatar 复制+meta.md 路径重写 |
| L5 | MuseTalk 客户端模块 | done | `src/render/lipsync.ts`（新建） | — | generateLipsync 实现 |
| L6 | 音频提取 + 圆角叠加 FFmpeg 封装 | done | `src/render/lipsync.ts`（追加） | — | extractAudio + overlayLipsync |
| L8 | 配置项 — MuseTalk 服务地址 | done | `server/types/api.ts`, `server/routes/system.ts`, `web/src/components/SettingsModal.vue` | — | musetalk 配置+连通性测试+doctor |
| L7 | 集成到 render.ts | done | `src/cli/render.ts` | — | concat 后 lipsync → loudnorm 流程 |
| L10 | Web 前端 — avatar 上传支持 | done | `web/src/components/editors/MetaEditor.vue`, `server/routes/assets.ts` | — | 上传/预览/删除+avatar API |
| L9 | AUTHORING.md 更新 | done | `AUTHORING.md` | — | avatarRef 字段说明+口型同步文档 |
