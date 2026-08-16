# Graph Report - AutoVideo  (2026-08-16)

## Corpus Check
- 217 files · ~192,277 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1982 nodes · 3382 edges · 134 communities (114 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9a3016c1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- build.ts
- BlockOutputs.vue
- MetaEditor.vue
- dict.global.md
- dependencies
- properties
- VideoComposition.tsx
- image-gen.ts
- agent/index.ts
- TopBar.vue
- script.md Markdown DSL
- render.ts
- MuseTalk /lipsync REST API
- TaskQueue
- BlockScriptEditor.vue
- puppeteer-core
- validate.ts
- tts.ts
- HomePage.vue
- AssetManager.vue
- dict.md
- compilerOptions
- pronounce.ts
- ProjectPage.vue
- server.py
- utils/api.ts
- meta.ts
- doctor.ts
- BlockSidebar.vue
- devDependencies
- dependencies
- TaskBar.vue
- compilerOptions
- ScriptEditor.vue
- store.ts
- provider.ts
- routes/blocks.ts
- server/index.ts
- AutoVideo Web UI
- lint.ts
- start.sh
- SettingsModal.vue
- HTML 视觉模式 PRD（@visual: html）
- parser/blocks.ts
- parser/assets.ts
- script.ts
- qa.ts
- remotion
- properties
- projectService.ts
- compile.ts
- BlockPanel.vue
- tsconfig.server.json
- 6. 管线集成（逐文件改动）
- src/remotion/slides/CameraTransform.tsx
- routes/assets.ts
- AssetUploadDialog.vue
- 13. 分阶段实施计划
- properties
- 1. 背景与目标
- visual-review.ts
- install.sh script
- audio
- enum
- 4. 架构决策（技术选型）
- 10. 编码一致性（partial mp4 格式对齐）
- 11. 入退场动画与字幕层（框架注入层）
- 12. Web UI 与配置
- script.schema.json
- system.ts
- 2. 用户故事
- 3. 语法设计
- 5. seek-hook 约定（动画档）
- 7. 资产处理
- 8. 安全沙箱
- output.ts
- AGENTS.md
- proper-lockfile
- render.test.ts
- Deepread Priority Tiers
- render
- properties
- visual-metrics.ts
- preview.ts
- load.ts
- slides/PipelineFlow.tsx
- TitleCards.tsx
- taskRunner.ts
- LLMProbabilityProgram.tsx
- defaults.ts
- package.json
- required
- RenderPipelineSlide.tsx
- visuals.ts
- dict.ts
- RenderPipelineTimeline.tsx
- types/api.ts
- components/SoftRendererIntro.tsx
- scripts
- visualMode
- narration
- sandbox.ts
- TaskItem.vue
- MyRenderModules.tsx
- taskStore.ts
- required
- Block
- resolveClaudeCredentials
- deepseek.bash
- required
- id
- properties
- remotion
- TotalInternalReflection.tsx
- LocalDeployHero.tsx
- properties
- items
- comp.tsx
- sensenova-t2i/start.sh
- web/src/remotion/slides/CameraTransform.tsx
- MuseTalk Integration Pipeline
- ShaderComparison.tsx
- Solid Blue Square Hero Image
- stop.sh
- ViewTransformSlide.tsx
- Compile-Test Diagram Fixture Asset
- musetalk-lipsync/start.sh
- voxcpm-tts/start.sh
- env.d.ts

## God Nodes (most connected - your core abstractions)
1. `Script` - 31 edges
2. `visuals()` - 29 edges
3. `TaskQueue` - 25 edges
4. `remotion` - 25 edges
5. `render()` - 24 edges
6. `compile()` - 22 edges
7. `AutoVideoConfig` - 22 edges
8. `CacheStore` - 19 edges
9. `loadConfig()` - 18 edges
10. `HTML 视觉模式 PRD（@visual: html）` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Build Output Path Constraint` --semantically_similar_to--> `Build --out Directory Rule`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/BUILD.md
- `Markdown to MP4 Pipeline` --semantically_similar_to--> `Four-Stage Pipeline`  [INFERRED] [semantically similar]
  README.md → docs/AGENTS.md
- `Compile Fixture Block B01` --semantically_similar_to--> `Starter Welcome Block B01`  [INFERRED] [semantically similar]
  tests/fixtures/compile-test/block1.md → templates/starter/script.md
- `AutoVideo Web UI` --references--> `ETag Optimistic Concurrency`  [INFERRED]
  docs/architecture/WEB_PRD.md → CLAUDE.md
- `AutoVideo Web UI` --references--> `Single-Thread FIFO Task Queue`  [INFERRED]
  docs/architecture/WEB_PRD.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Compile TTS Visuals Render Pipeline** — docs_agents_compile_stage, docs_agents_tts_stage, docs_agents_visuals_stage, docs_agents_render_stage, docs_agents_script_json_ir [EXTRACTED 1.00]
- **External AI Service Dependencies** — readme_claude_api, readme_voxcpm2, readme_sensenova_u1, readme_musetalk, readme_remotion [EXTRACTED 1.00]
- **Authoring Then Build Agent Flow** — docs_authoring_meta_md, docs_authoring_script_md, docs_architecture_prd_project_json, docs_build_final_normalized_mp4 [INFERRED 0.85]
- **AutoVideo third-party service dependency matrix** — third_servers_readme_voxcpm2, third_servers_readme_sensenova_u1, third_servers_readme_musetalk [EXTRACTED 1.00]
- **MuseTalk lipsync HTTP API surface** — third_servers_musetalk_lipsync_usage_post_lipsync, third_servers_musetalk_lipsync_usage_get_health, third_servers_musetalk_lipsync_deploy_lipsync_server [EXTRACTED 1.00]
- **VoxCPM2 TTS HTTP API surface** — third_servers_voxcpm_tts_readme_get_health, third_servers_voxcpm_tts_readme_post_v1_voices, third_servers_voxcpm_tts_readme_post_v1_speech [EXTRACTED 1.00]
- **Starter Hero Placeholder Composition** — templates_starter_hero_solid_blue_square, templates_starter_hero_placeholder_hero_asset, templates_starter_hero_uniform_saturated_blue, templates_starter_hero_starter_template_visual [INFERRED 0.75]
- **Minimal PNG stub used as diagram asset in compile-test fixtures** — tests_fixtures_compile_test_assets_diagram_placeholder_png, tests_fixtures_compile_test_assets_diagram_compile_test_fixture, tests_fixtures_compile_test_assets_diagram_stub_diagram [INFERRED 0.75]

## Communities (134 total, 20 thin omitted)

### Community 0 - "build.ts"
Cohesion: 0.14
Nodes (19): BuildError, BuildOptions, BuildResult, CompileOptions, CompileResult, RenderOptions, RenderResult, TtsOptions (+11 more)

### Community 1 - "BlockOutputs.vue"
Cohesion: 0.06
Nodes (31): actionLoading, audioDurationSec, audioEl, audioExists, audioMenuOpts, audioUrl, base, cmEl (+23 more)

### Community 2 - "MetaEditor.vue"
Cohesion: 0.07
Nodes (38): applyAvatarRadiusToMeta(), applyLipsyncToMeta(), avatarDeleting, avatarExists, avatarRadius, avatarRadiusChoices, avatarRadiusOptions, avatarUploading (+30 more)

### Community 3 - "dict.global.md"
Cohesion: 0.12
Nodes (16): ── AI / 模型 ───────────────────────────────────────────────────, ASCII 字面量整词匹配，长词优先。, AutoVideo — 全局发音词典（仓库级）, /<regex>/i   => <读法>      # 支持 $1 反向引用, <term>       => <读法>, X.cpp / X.ts / X.vue 这类文件名，点号不要读成「点」, ── 协议 / 格式 ─────────────────────────────────────────────────, 单位 (+8 more)

### Community 4 - "dependencies"
Cohesion: 0.05
Nodes (38): @codemirror/commands, @codemirror/lang-javascript, @codemirror/lang-yaml, @codemirror/state, @codemirror/theme-one-dark, @codemirror/view, naive-ui, pinia (+30 more)

### Community 5 - "properties"
Cohesion: 0.05
Nodes (39): 16:9, 1:1, 9:16, enum, type, description, maximum, minimum (+31 more)

### Community 6 - "VideoComposition.tsx"
Cohesion: 0.08
Nodes (34): estimateWidthEm(), findCurrentLine(), fitFontSize(), renderHighlightedText(), SubtitleOverlay(), BlockFrame(), ENTER_EASING, EXIT_EASING (+26 more)

### Community 7 - "image-gen.ts"
Cohesion: 0.16
Nodes (23): ASPECT_TO_SIZE, buildImageKey(), buildWrapperComponent(), cacheModel(), createFetchController(), fetchOpenAIImage(), fetchRemoteImage(), fetchSenseNovaImage() (+15 more)

### Community 8 - "agent/index.ts"
Cohesion: 0.10
Nodes (27): AnthropicApiDriver, createClient(), resolveCredentials(), ResolvedCredentials, toAgentResult(), BASE_ARGS, ClaudeCliDriver, parseCliOutput() (+19 more)

### Community 9 - "TopBar.vue"
Cohesion: 0.07
Nodes (30): buildDisabled, buildLoading, clampVisualConcurrency(), compileDisabled, compileLoading, concurrencySaving, confirmNoAvatar(), doctorItems (+22 more)

### Community 10 - "script.md Markdown DSL"
Cohesion: 0.07
Nodes (33): Build Output Path Constraint, Branded Stage Readiness Types, compile Stage, Content-Hash Cache, Four-Stage Pipeline, render Stage, script.json Canonical IR, tts Stage (+25 more)

### Community 11 - "render.ts"
Cohesion: 0.15
Nodes (22): computeBlockTimingWithFps(), computeSubtitleQuietWindows(), render(), RenderError, resolveAvatarRadius(), resolveOverlayEncode(), shouldGenerateMuseTalkLipsync(), shouldOverlayRawAvatarLoop() (+14 more)

### Community 12 - "MuseTalk /lipsync REST API"
Cohesion: 0.08
Nodes (33): Test Video meta fixture, float16 VRAM savings, MuseTalk /lipsync REST API, lipsync_server.py FastAPI wrapper, max-avatar-seconds avatar trim, Serial inference lock, torch.load weights_only=False patch, Avatar PiP lipsync mode (+25 more)

### Community 14 - "BlockScriptEditor.vue"
Cohesion: 0.10
Nodes (26): assetPaths, buildExtensions(), conflictEtag, conflictVisible, editorEl, emit, handleColorSchemeChange(), isDirty (+18 more)

### Community 16 - "validate.ts"
Cohesion: 0.10
Nodes (30): analyzeByFileSize(), analyzeImage(), ASTScanResult, astStaticScan(), classifyRenderError(), cleanupStill(), ensureNodeModules(), execFileAsync (+22 more)

### Community 17 - "tts.ts"
Cohesion: 0.10
Nodes (21): dict, program, build(), buildCommand(), md5File(), tts(), TtsError, concatenateWavsWithGaps() (+13 more)

### Community 18 - "HomePage.vue"
Cohesion: 0.08
Nodes (19): app, createForm, createRules, creating, deleting, deletingProject, demoCreating, doDelete() (+11 more)

### Community 19 - "AssetManager.vue"
Cohesion: 0.09
Nodes (21): AssetFile, assets, dialog, errorMsg, fetchAssets(), fileInputRef, isDragOver, loading (+13 more)

### Community 20 - "dict.md"
Cohesion: 0.10
Nodes (20): 1. <repo>/dict.global.md        shared via git, covers common tech terms, 2. ~/.config/autovideo/dict.md  machine-level additions, 3. this file                    project-specific, overrides the above, A cloned Chinese voice reads Latin terms inconsistently: the same acronym can, `#` are comments., `autovideo dict suggest` asks an LLM for the ones heuristics can't guess., cam0       => cam 零, come out spelled, transliterated, or mangled depending on its context. Pin the (+12 more)

### Community 21 - "compilerOptions"
Cohesion: 0.08
Nodes (24): DOM, DOM.Iterable, env.d.ts, ES2022, src/**/*.vue, compilerOptions, baseUrl, esModuleInterop (+16 more)

### Community 22 - "pronounce.ts"
Cohesion: 0.17
Nodes (15): copyDirRecursive(), initCommand(), applyPronunciation(), escapeRegex(), findUp(), isAsciiWordChar(), loadDictFile(), loadPronunciationDict() (+7 more)

### Community 23 - "ProjectPage.vue"
Cohesion: 0.08
Nodes (18): activeTab, nonStandard, pageLoadTime, parsedBlocks, projectName, rightCollapsed, route, scriptEditorKey (+10 more)

### Community 24 - "server.py"
Cohesion: 0.14
Nodes (23): BaseModel, get, ndarray, on_event, post, Response, build_styled_text(), cleanup() (+15 more)

### Community 25 - "utils/api.ts"
Cohesion: 0.22
Nodes (12): ProjectSummary, useProjectStore, apiDelete(), ApiError, apiFetch(), apiGet(), apiPost(), apiPut() (+4 more)

### Community 26 - "meta.ts"
Cohesion: 0.22
Nodes (14): ASPECT_TO_DIMS, aspectToDimensions(), DEFAULTS, extractMetaSegment(), MetaError, MetaOverrides, ParsedMeta, parseMetaKvLines() (+6 more)

### Community 27 - "doctor.ts"
Cohesion: 0.19
Nodes (20): resolveAgentProvider(), checkCacheDirWritable(), checkCJKFonts(), checkClaudeApiConnectivity(), checkClaudeCredentials(), checkDiskSpace(), checkFfmpeg(), checkNode() (+12 more)

### Community 28 - "BlockSidebar.vue"
Cohesion: 0.11
Nodes (22): addBlock(), addingBlock, apiBlocks, batchClearCache(), batchCreate(), batchForce, batchLoading, checkedIds (+14 more)

### Community 29 - "devDependencies"
Cohesion: 0.08
Nodes (25): ajv, @babel/types, concurrently, devDependencies, ajv, @babel/types, concurrently, @remotion/cli (+17 more)

### Community 30 - "dependencies"
Cohesion: 0.09
Nodes (23): @anthropic-ai/sdk, @babel/parser, commander, @hono/node-server, ms, p-limit, dependencies, @anthropic-ai/sdk (+15 more)

### Community 31 - "TaskBar.vue"
Cohesion: 0.13
Nodes (12): allTasks, expanded, logContent, logLoading, { message }, props, runningLabel, runningPercent (+4 more)

### Community 32 - "compilerOptions"
Cohesion: 0.09
Nodes (21): bin/**/*.ts, remotion/**/*.ts, remotion/**/*.tsx, compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, jsx (+13 more)

### Community 33 - "ScriptEditor.vue"
Cohesion: 0.12
Nodes (23): overwrite(), buildExtensions(), conflictData, ConflictInfo, conflictVisible, editorEl, emit, handleColorSchemeChange() (+15 more)

### Community 34 - "store.ts"
Cohesion: 0.10
Nodes (24): AudioKey, CacheKey, CacheStats, CacheStore, CacheStoreOptions, CacheType, CleanOptions, ComponentKey (+16 more)

### Community 35 - "provider.ts"
Cohesion: 0.10
Nodes (11): computeVoxcpmModelVersion(), createTtsProvider(), TtsProvider, TtsProviderError, TtsProviderName, VoxcpmProvider, SpeakOptions, VoxcpmClient (+3 more)

### Community 36 - "routes/blocks.ts"
Cohesion: 0.14
Nodes (19): ANIMATION_PRESETS, CACHE_CLEAR_KINDS, createBlockRoutes(), isCacheClearKind(), patchDirective(), patchVisualMode(), VISUAL_MODES, extractBlock() (+11 more)

### Community 37 - "server/index.ts"
Cohesion: 0.22
Nodes (7): app, __dirname, DIST_SEGMENTS, gitignorePath, port, server, taskQueue

### Community 38 - "AutoVideo Web UI"
Cohesion: 0.15
Nodes (15): AutoVideo, ETag Optimistic Concurrency, Single-Thread FIFO Task Queue, Web UI Agent Workflow, .autovideo-web Config Store, AutoVideo Web Deployment, Homepage Flagship Six, Four Theme Domains (+7 more)

### Community 39 - "lint.ts"
Cohesion: 0.32
Nodes (8): expandCompound(), formatPronunciationLint(), lintPronunciation(), ruleMatchesTerm(), spellOut(), splitCamel(), suggestReading(), PronunciationRule

### Community 40 - "start.sh"
Cohesion: 0.31
Nodes (15): build_all(), check_env(), err(), info(), install_deps(), ok(), port_busy(), section() (+7 more)

### Community 41 - "SettingsModal.vue"
Cohesion: 0.09
Nodes (22): activeTab, agentBaseUrlOptions, agentModelOptions, agentProviderOptions, anthropicConcurrencyOptions, clampAnthropicConcurrency(), cliPathPlaceholder, codexBaseUrlOptions (+14 more)

### Community 42 - "HTML 视觉模式 PRD（@visual: html）"
Cohesion: 0.18
Nodes (10): 14. 验收标准, 15.1 风险, 15.2 未决问题（评审已拍板）, 15. 风险与未决问题, 16. 参考资料, 9.1 partial 缓存 key（html 块）, 9.2 html 源码缓存, 9. 缓存策略 (+2 more)

### Community 43 - "parser/blocks.ts"
Cohesion: 0.15
Nodes (18): BlockError, extractSection(), parseBlockFile(), parseTitleLine(), RawBlock, splitIntoSegments(), DirectiveError, ParsedDirectives (+10 more)

### Community 44 - "parser/assets.ts"
Cohesion: 0.24
Nodes (14): AssetError, BlockForAssets, CODE_EXTENSIONS, computeFileHash(), ensureDirForFile(), FileRef, inlineCodeSnippet(), isCodeFile() (+6 more)

### Community 45 - "script.ts"
Cohesion: 0.14
Nodes (20): RootRenderOptions, AnimationProps, ASPECT_RATIOS, assertCompiledScript(), assertVisualsReady(), AudioReadyScript, BlockFrameProps, CompiledScript (+12 more)

### Community 46 - "qa.ts"
Cohesion: 0.17
Nodes (20): checkNonBlackFrames(), checkSubtitleSafeArea(), execBuffer(), execCapture(), execCaptureAll(), frameEdgeMean(), isFrameBlack(), probeDuration() (+12 more)

### Community 47 - "remotion"
Cohesion: 0.12
Nodes (6): AnimationProps, AnimationProps, remotion, AnimationProps, CODE_LINES, AnimationProps

### Community 48 - "properties"
Cohesion: 0.13
Nodes (15): type, description, type, description, type, properties, enter, htmlSource (+7 more)

### Community 49 - "projectService.ts"
Cohesion: 0.19
Nodes (18): copyDir(), createProjectRoutes(), removeDir(), TEMPLATES_DIR, computeEtag(), ConflictResult, countBlocks(), FileWithEtag (+10 more)

### Community 50 - "compile.ts"
Cohesion: 0.15
Nodes (14): assertNoHtmlMarkerLines(), compile(), CompileError, loadSchema(), parseMetaArgs(), FontScaleResult, MIN_FONT_COEFF, scaleFontMentions() (+6 more)

### Community 51 - "BlockPanel.vue"
Cohesion: 0.18
Nodes (15): activeTab, ANIM_OPTIONS, currentEnter, currentExit, currentMode, editorKey, emit, { message } (+7 more)

### Community 52 - "tsconfig.server.json"
Cohesion: 0.14
Nodes (13): schemas/**/*.json, server/**/*.ts, ./tsconfig.json, web, compilerOptions, outDir, rootDir, exclude (+5 more)

### Community 53 - "6. 管线集成（逐文件改动）"
Cohesion: 0.25
Nodes (8): 6.1 类型层 — [src/types/script.ts](../../src/types/script.ts), 6.2 解析层 — [src/parser/directives.ts](../../src/parser/directives.ts), 6.3 compile 层 — [src/cli/compile.ts](../../src/cli/compile.ts), 6.4 visuals 层 — [src/cli/visuals.ts](../../src/cli/visuals.ts), 6.5 render 层 — [src/render/render-blocks.ts](../../src/render/render-blocks.ts), 6.6 新增 html 渲染器 — `src/render/html-render.ts`（新文件）, 6.7 改动文件清单, 6. 管线集成（逐文件改动）

### Community 54 - "src/remotion/slides/CameraTransform.tsx"
Cohesion: 0.22
Nodes (10): add(), AnimationProps, CameraTransform(), cross(), isoProj(), norm(), rotY(), scale() (+2 more)

### Community 55 - "routes/assets.ts"
Cohesion: 0.31
Nodes (11): fileGuard(), projectGuard(), createAssetRoutes(), getMime(), MIME_TYPES, isAllowedRootUploadBasename(), isSafeRelativePathSegment(), maxRootUploadBytes() (+3 more)

### Community 56 - "AssetUploadDialog.vue"
Cohesion: 0.18
Nodes (11): accept, blockId, emit, fileName, handleCancel(), handleUpload(), maxUploadBytes, message (+3 more)

### Community 57 - "13. 分阶段实施计划"
Cohesion: 0.33
Nodes (6): 13. 分阶段实施计划, Phase 1：MVP — 静态 HTML 块（最小可用）, Phase 2：动画档 + 字幕层 + 入退场, Phase 3：外部文件与资产, Phase 4：Web UI 与文档, Phase 5（可选，v2）：兼容档

### Community 58 - "properties"
Cohesion: 0.15
Nodes (13): properties, format, type, format, type, audioGeneratedAt, compiledAt, renderedAt (+5 more)

### Community 59 - "1. 背景与目标"
Cohesion: 0.33
Nodes (6): 1.1 现状, 1.2 用户诉求, 1.3 为什么现有模式满足不了, 1.4 目标, 1.5 非目标, 1. 背景与目标

### Community 60 - "visual-review.ts"
Cohesion: 0.14
Nodes (22): createAgentDriver(), AnthropicConfig, buildUserContent(), ComponentGenInput, ComponentGenResult, extractTsxFromOutput(), generateComponent(), RetryContext (+14 more)

### Community 61 - "install.sh script"
Cohesion: 0.21
Nodes (7): info(), install.sh script, step(), warn(), install.sh script, install.sh script, install.sh script

### Community 62 - "audio"
Cohesion: 0.17
Nodes (12): durationSec, lineTimings, wavPath, additionalProperties, description, properties, required, type (+4 more)

### Community 63 - "enum"
Cohesion: 0.27
Nodes (12): fade, fade-down, fade-up, none, slide-left, slide-right, zoom-in, zoom-out (+4 more)

### Community 64 - "4. 架构决策（技术选型）"
Cohesion: 0.33
Nodes (6): 4.1 选定方案：路线 A — Headless Chrome 逐帧截图 + ffmpeg 合 partial mp4, 4.2 渲染流程（html 块）, 4.3 Chrome 复用策略, 4.4 为什么不用 `HeadlessExperimental.beginFrame`, 4.5 与现有管线的关系, 4. 架构决策（技术选型）

### Community 65 - "10. 编码一致性（partial mp4 格式对齐）"
Cohesion: 0.40
Nodes (5): 10.1 Remotion 输出参数（[render-blocks.ts:236-261](../../src/render/render-blocks.ts)）, 10.2 html 渲染器 ffmpeg 命令, 10.3 SAR 对齐, 10.4 验证, 10. 编码一致性（partial mp4 格式对齐）

### Community 66 - "11. 入退场动画与字幕层（框架注入层）"
Cohesion: 0.40
Nodes (5): 11.1 现状, 11.2 方案：注入 wrapper，CSS 变换, 11.3 enter/exit 预设映射（必须与 block-frame.tsx 逐帧一致）, 11.4 字幕层（评审新增，替代原 Q3 的待定方案）, 11. 入退场动画与字幕层（框架注入层）

### Community 67 - "12. Web UI 与配置"
Cohesion: 0.40
Nodes (5): 12.1 配置 — `autovideo.config.json`, 12.2 Web 后端, 12.3 Web 前端, 12.4 doctor 检查, 12. Web UI 与配置

### Community 68 - "script.schema.json"
Cohesion: 0.18
Nodes (10): artifacts, assets, blocks, meta, additionalProperties, description, required, $schema (+2 more)

### Community 69 - "system.ts"
Cohesion: 0.25
Nodes (17): createSystemRoutes(), publicConfig(), applyDefined(), configFilePath(), loadStoredConfig(), mergeFields(), mergeStoredConfig(), resolveTaskConfig() (+9 more)

### Community 70 - "2. 用户故事"
Cohesion: 0.40
Nodes (5): 2. 用户故事, US-1：静态布局块（最简）, US-2：带 CSS 动画的块, US-3：带 JS 动画的块（数字滚动）, US-4：引用外部 HTML 文件

### Community 71 - "3. 语法设计"
Cohesion: 0.40
Nodes (5): 3.1 指令语法, 3.2 `--- visual ---` 内容语义, 3.3 HTML 源码约定, 3.4 内联模式的解析约束（重要）, 3. 语法设计

### Community 72 - "5. seek-hook 约定（动画档）"
Cohesion: 0.40
Nodes (5): 5.1 框架侧行为, 5.2 用户侧约定, 5.3 `window.__av` 上下文对象, 5.4 模板支持, 5. seek-hook 约定（动画档）

### Community 73 - "7. 资产处理"
Cohesion: 0.50
Nodes (4): 7.1 HTML 引用本地资产, 7.2 字体, 7.3 内联 vs 外部资产, 7. 资产处理

### Community 74 - "8. 安全沙箱"
Cohesion: 0.50
Nodes (4): 8.1 风险, 8.2 防护措施, 8.3 v1 限制（明示给用户）, 8. 安全沙箱

### Community 75 - "output.ts"
Cohesion: 0.29
Nodes (10): hono, hono, parseRange(), serveFileWithRange(), resolveSlug(), createOutputRoutes(), resolveSlug(), computeSlug() (+2 more)

### Community 78 - "render.test.ts"
Cohesion: 0.12
Nodes (13): ConcatOptions, concatPartials(), ConcatResult, probeVideoStreams(), StreamInfo, validatePartials(), applyLoudnorm(), execAsync() (+5 more)

### Community 80 - "render"
Cohesion: 0.20
Nodes (10): cacheHit, partialPath, cacheHit, partialPath, render, additionalProperties, description, properties (+2 more)

### Community 81 - "properties"
Cohesion: 0.18
Nodes (11): description, componentPath, description, htmlPath, imagePath, videoPath, visual, additionalProperties (+3 more)

### Community 82 - "visual-metrics.ts"
Cohesion: 0.16
Nodes (17): assessVisualMetrics(), cellEdgeMean(), checkNarrationSyncContract(), computeImageMetrics(), computeStaticMetrics(), evalPx(), execFileAsync, ImageMetrics (+9 more)

### Community 83 - "preview.ts"
Cohesion: 0.12
Nodes (11): copyRemotionFiles(), ensurePublicScript(), findAvailablePort(), generatePreviewRootForBuild(), preview(), PreviewError, PreviewOptions, PreviewResult (+3 more)

### Community 84 - "load.ts"
Cohesion: 0.22
Nodes (14): getConfig(), DEFAULT_CONFIG, deepMerge(), expandConfigPaths(), expandPath(), getDefaultConfig(), inferType(), loadConfig() (+6 more)

### Community 85 - "slides/PipelineFlow.tsx"
Cohesion: 0.40
Nodes (4): AnimationProps, NODES, PipelineFlow(), PipelineFlow()

### Community 86 - "TitleCards.tsx"
Cohesion: 0.40
Nodes (3): AnimationProps, CARDS, COLORS

### Community 87 - "taskRunner.ts"
Cohesion: 0.33
Nodes (8): copyDir(), createTaskRunner(), getTaskConfig(), snapshotSourceFiles(), syncAvatarMetaToScript(), wrapProgress(), extractScriptAssetRefs(), SCRIPT_ASSET_REF_REGEX

### Community 89 - "defaults.ts"
Cohesion: 0.09
Nodes (31): AgentProviderName, AgentReviewConfig, AnthropicConfig, CacheConfig, DEFAULT_HTML_RENDER, DEFAULT_QUALITY, HtmlRenderConfig, ImageGenConfig (+23 more)

### Community 90 - "package.json"
Cohesion: 0.22
Nodes (8): bin, autovideo, description, engines, node, name, type, version

### Community 91 - "required"
Cohesion: 0.17
Nodes (12): aspect, fps, height, schemaVersion, subtitleSafeBottom, theme, voiceRef, width (+4 more)

### Community 93 - "visuals.ts"
Cohesion: 0.16
Nodes (17): blockTimingContext(), buildComponentKey(), buildDefaultSystemPrompt(), buildNarrationContext(), computePromptVersion(), getAssetHashesForBlock(), is429(), NarrationLineSec (+9 more)

### Community 94 - "dict.ts"
Cohesion: 0.22
Nodes (9): dictSuggestCommand(), DictSuggestOptions, parseAndMergeBlocks(), ProjectError, RawProjectJson, readProject(), ResolvedProject, LintFinding (+1 more)

### Community 96 - "types/api.ts"
Cohesion: 0.16
Nodes (15): createTaskRoutes(), STAGES_WITH_BLOCK_IDS, VALID_STAGES, CreateTaskInput, generateId(), TaskRunFn, AgentProviderName, ApiError (+7 more)

### Community 98 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, build:client, build:server, build:web, dev, dev:web, start:web

### Community 99 - "visualMode"
Cohesion: 0.22
Nodes (9): animation, html, image, video, visualMode, default, description, enum (+1 more)

### Community 100 - "narration"
Cohesion: 0.25
Nodes (8): lines, additionalProperties, properties, required, type, explicitDurationSec, lines, narration

### Community 101 - "sandbox.ts"
Cohesion: 0.36
Nodes (6): buildWhitelistedEnv(), ENV_WHITELIST, runIsolated(), SandboxOptions, SandboxResult, wrapWithIsolation()

### Community 102 - "TaskItem.vue"
Cohesion: 0.12
Nodes (14): TaskStatus, durationText, etaText, isActive, lastPercent, props, stageLabel, STATUS_BADGE (+6 more)

### Community 104 - "taskStore.ts"
Cohesion: 0.33
Nodes (6): cleanup(), formatStage(), getStageLabel(), STAGE_LABEL, useTaskStore, connectSSE()

### Community 105 - "required"
Cohesion: 0.29
Nodes (7): enterFrames, enterSec, exitSec, frames, holdSec, totalSec, required

### Community 106 - "Block"
Cohesion: 0.46
Nodes (5): declaresSyncIntent(), enumeratesNarration(), lintNarrationSync(), SyncLintWarning, Block

### Community 107 - "resolveClaudeCredentials"
Cohesion: 0.38
Nodes (6): ClaudeSettings, CREDENTIALS_PATH, readClaudeOAuthCredentials(), readClaudeSettings(), resolveClaudeCredentials(), SETTINGS_PATH

### Community 109 - "required"
Cohesion: 0.29
Nodes (7): enter, exit, id, narration, title, visual, required

### Community 110 - "id"
Cohesion: 0.50
Nodes (4): description, pattern, type, id

### Community 111 - "properties"
Cohesion: 0.18
Nodes (11): enterFrames, enterSec, exitSec, frames, holdSec, timing, totalSec, additionalProperties (+3 more)

### Community 114 - "TotalInternalReflection.tsx"
Cohesion: 0.38
Nodes (6): AnimationProps, describeArc(), polarToCartesian(), RAY_GROUPS, RayGroup, TOTAL_REFLECTION()

### Community 116 - "properties"
Cohesion: 0.20
Nodes (10): pattern, type, additionalProperties, type, additionalProperties, description, type, properties (+2 more)

### Community 117 - "items"
Cohesion: 0.33
Nodes (6): items, minItems, type, additionalProperties, type, blocks

### Community 119 - "sensenova-t2i/start.sh"
Cohesion: 0.40
Nodes (4): HF_ENDPOINT, SENSENOVA_DEVICE_MAP, SENSENOVA_MODEL_PATH, start.sh script

### Community 121 - "MuseTalk Integration Pipeline"
Cohesion: 0.67
Nodes (4): Lipsync Feature Complete, MuseTalk Integration Pipeline, avatarRef Lipsync Field, MuseTalk Lipsync

### Community 125 - "ShaderComparison.tsx"
Cohesion: 0.67
Nodes (3): AnimationProps, easeOut(), SlideComparison()

### Community 126 - "Solid Blue Square Hero Image"
Cohesion: 0.67
Nodes (4): Placeholder Hero Asset, Solid Blue Square Hero Image, Starter Template Visual Slot, Uniform Saturated Blue Field

### Community 132 - "Compile-Test Diagram Fixture Asset"
Cohesion: 1.00
Nodes (3): Compile-Test Diagram Fixture Asset, 1x1 Placeholder PNG Diagram, Stub Diagram (No Visual Content)

## Ambiguous Edges - Review These
- `Test Video meta fixture` → `Avatar PiP lipsync mode`  [AMBIGUOUS]
  tests/fixtures/compile-test/meta.md · relation: conceptually_related_to

## Knowledge Gaps
- **761 isolated node(s):** `AnimationProps`, `program`, `dict`, `deepseek.bash script`, `AnimationProps` (+756 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Test Video meta fixture` and `Avatar PiP lipsync mode`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `remotion` connect `remotion` to `components/SoftRendererIntro.tsx`, `ViewTransformSlide.tsx`, `VideoComposition.tsx`, `MyRenderModules.tsx`, `web/src/remotion/slides/CameraTransform.tsx`, `TotalInternalReflection.tsx`, `LocalDeployHero.tsx`, `tsconfig.server.json`, `slides/PipelineFlow.tsx`, `TitleCards.tsx`, `comp.tsx`, `src/remotion/slides/CameraTransform.tsx`, `LLMProbabilityProgram.tsx`, `RenderPipelineSlide.tsx`, `ShaderComparison.tsx`, `RenderPipelineTimeline.tsx`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `properties` connect `properties` to `required`, `script.schema.json`, `items`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `output.ts`, `proper-lockfile`, `puppeteer-core`, `remotion`, `package.json`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **What connects `AnimationProps`, `program`, `dict` to the rest of the system?**
  _761 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `build.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `BlockOutputs.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.05537098560354374 - nodes in this community are weakly interconnected._