# 集成事项 — design-system（设计系统约束）

任务 slug：`design-system`。本任务完成内容：

- 新建 `remotion/library/DESIGN.md`：设计系统规范（字体阶梯/字重、留白节奏、色彩语义、信息密度上限、signature 视觉元素、动效节奏、背景质感、禁用「AI 默认美学」清单、每屏自检清单）。
- `remotion/library/tokens.ts`（只增不改）：新增 `ELEVATION` + `elevation()`、`GRADIENTS` + `gradient()`、`STAGGER` 预设及对应类型导出；现有导出零改动。
- `src/ai/component-gen.ts`：新增 `loadDesignGuidelines()`（进程级缓存，读 `remotion/library/DESIGN.md`，文件缺失时优雅降级为空串）、`buildDesignGuidelinesSection()`、`withDesignGuidelines()`；`generateComponent` 现在把设计规范附加到 system prompt 尾部。
- `src/ai/assembly-gen.ts`：`buildAssemblySystemPrompt()` 在「组件注册表」与「Output contract」之间注入同一设计规范段落。

## 需要集成 Agent 做的共享文件改动

### 1. `remotion/library/index.ts`（禁止我自改，需集成 Agent 加导出）

在 tokens 导出块追加（value 导出保持无扩展名，type 导出带 `.js`，与现有风格一致）：

```ts
export {
  TYPE, LAYOUT, DUR, typeSize, space, gridUnit, availHeight, frames,
  ELEVATION, elevation, GRADIENTS, gradient, STAGGER,
} from "./tokens";
export type { TypeToken, ElevationLevel, GradientToken, StaggerToken } from "./tokens.js";
```

（即把现有两行替换为上面四行；不改其他任何导出。）

### 2. `src/cli/visuals.ts`（可选加固，非必须）

现状无需改动即可正确失效缓存：`promptVersion` 哈希的材料是 `systemPrompt + buildAssemblySystemPrompt(registryDocs) + registryDocs`，而 `buildAssemblySystemPrompt` 的输出现在内嵌 DESIGN.md 全文，因此 **DESIGN.md 的任何编辑都会改变 promptVersion**，组件缓存自动失效。

仅当未来有人把注入从 `buildAssemblySystemPrompt` 移走时，才需要在 `computePromptVersion` 材料里显式追加 `loadDesignGuidelines()`（已从 `src/ai/component-gen.js` 导出）。

### 3. `src/render/sync-runtime.ts` —— 无需改动

`syncRemotionRuntime` 用 `copyDirRecursive` 整目录拷贝 `remotion/library/`，DESIGN.md 会随之同步进 build 目录（无副作用，只是多一个 md 文件）。prompt 注入读的是**仓库根**的 DESIGN.md（`component-gen.ts` 内 `resolveDesignDocPath()`，probe 逻辑与 sync-runtime 的 `resolveRepoRoot()` 相同：`import.meta.url` 上溯两级、找不到再上溯一级），不依赖 build 目录拷贝。npm 全局安装、找不到文件时注入静默跳过（降级为空）。

### 4. 新增环境变量（可选，无需改配置文件类型）

- `AUTOVIDEO_DESIGN_DOC`：覆盖 DESIGN.md 路径；指向不存在的路径即可关闭注入。纯环境变量，未触碰 `autovideo.config*.json` / `src/config/`。如需对外文档化，由集成 Agent 在共享 README 中加一行。

### 5. 文档

- `docs/AGENTS.md` 开发者备注里「`remotion/library/` 预制组件库」一条可补一句「设计规范见 `remotion/library/DESIGN.md`（注入 visuals 阶段 LLM prompt）」——共享文档由集成 Agent 统一处理。

## 验证状态

- `npm run build`（tsc）：通过。
- `npx tsc -p tsconfig.remotion.json`：通过。
- `HOME=/tmp/fakehome npx vitest run tests/ai/component-gen.test.ts tests/ai/assembly-gen.test.ts`：全部通过（现有断言不含 system prompt 全等匹配，注入不破坏测试）。
