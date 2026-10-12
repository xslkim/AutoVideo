# 集成事项 — skills-research-doc（Agent 技能与调研沉淀）

> 本任务产出：`.agents/skills/remotion-motion/SKILL.md`、`.agents/skills/remotion-captions/SKILL.md`、`.claude/skills/` 下 2 个 symlink、`docs/architecture/UPGRADE-2026-RESEARCH.md`。
> 以下是需要集成 Agent 统一处理的共享文件改动；本任务**未触碰**任何共享文件。

## 1. package.json —— 补一个可选依赖（手绘涂鸦批注手法）

设计基准要求「手绘涂鸦批注」，官方实现包 `@remotion/rough-notation` 未安装。在 `dependencies` 中加一行（与其他 @remotion 包同版本）：

```json
    "@remotion/rough-notation": "^4.0.534",
```

注意：`remotion-motion` skill 里已写明该包「未安装、装好后才可用」，当前 skill 给出的替代方案（SVG path + `@remotion/noise` 扰动 + `evolvePath`）不依赖它。若不装，skill 文本无需改。

## 2. remotion/library/DESIGN.md —— 追加 skill 指针（visuals prompt 注入点）

`src/ai/component-gen.ts` 的 `withDesignGuidelines()` 会把 `remotion/library/DESIGN.md` 全文注入每条生成/组装 system prompt——这是 visuals 阶段 CLI agent 的规则入口。建议在文件末尾追加（引导 agent 先读 skill 再写 TSX）：

```markdown
## Remotion best-practice skills（写 TSX 前必读）

- `.agents/skills/remotion-motion/SKILL.md` —— 帧驱动动画时序与缓动、spring 预设、交错/旁白节拍、图表生长、路径光点/morph、转场、反 AI 默认美学红线。
- `.agents/skills/remotion-captions/SKILL.md` —— Caption 数据结构、逐字卡拉OK 高亮、CJK 字幕分页、底部安全区规范。
两文件与本 DESIGN.md 冲突时，以 DESIGN.md + tokens.ts/motion.ts 代码为准。
```

## 3. docs/AGENTS.md —— 开发者备注加一行

在「开发者备注」列表末尾加：

```markdown
- visuals 阶段的 Remotion 最佳实践以 agent skills 形式维护在 `.agents/skills/remotion-motion` 与 `.agents/skills/remotion-captions`（`.claude/skills/` 下有同名 symlink 供 claude 后端发现）；技术选型依据见 `docs/architecture/UPGRADE-2026-RESEARCH.md`
```

## 4. .claude/skills/ symlink 说明（无需动作，仅知情）

已创建：
- `.claude/skills/remotion-motion` → `../../.agents/skills/remotion-motion`
- `.claude/skills/remotion-captions` → `../../.agents/skills/remotion-captions`

与 `npx skills add` 的默认 symlink 安装方式一致；git 能正常记录 symlink。若将来有 Windows 开发者或工具链不认 symlink，把这两个目录换成实体拷贝即可（内容就是 `.agents/skills/` 下的同名目录）。

## 5. 本任务不需要的共享改动

- `remotion/library/index.ts` / `src/ai/visual-registry.ts`：无新组件，无需导出/注册。
- `schemas/script.schema.json` / `src/config/`：无新字段；调研报告建议的 FunASR 字级时间戳、CosyVoice3 instruct 参数均按「可选字段/环境变量」设计，由对应任务 Agent 各自申报。
- README.md / third_servers/README.md：无服务变更。

## 6. 遗留问题

1. **「SGA 几何 QA」定义未在公开资料查实**（调研报告 §9 已标注）。当前按 Code2Video Critic 方法论解释为「渲染帧空间几何质检」。若任务书另有所指，需任务发起方澄清后修订 `UPGRADE-2026-RESEARCH.md` §9。
2. `npx skills add remotion-dev/skills` 未实际执行（硬性规则禁止 npm install）；机制已调研并记录在调研报告 §2，两个 skill 是按官方 v4.0.534 原文手工裁剪的等效落地。将来若要追平官方更新，可人工 diff `https://github.com/remotion-dev/skills` 的 `skills/remotion-markup/` 与 `skills/remotion-captions/`。
3. `@remotion/effects`（vignette/lightLeak/glow 等）同样未安装；官方转场 Overlay 示例依赖 `lightLeak()`。若组件库任务需要光效 Overlay，需再补 `@remotion/effects@^4.0.534`——本任务未替他们申报，由转场/组件任务 Agent 自行评估。
