# Graph Report - .  (2026-08-05)

## Corpus Check
- Large corpus: 277 files · ~641,285 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 2059 nodes · 3236 edges · 149 communities (132 shown, 17 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 169 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- CLI Build Pipeline
- Block Outputs UI
- Meta Editor UI
- Site Project Meta Sync
- Web Editor Dependencies
- Cursor Tool Schemas
- Remotion Subtitle Overlay
- Cache Store Layer
- Remotion Root Preview
- Project TopBar Actions
- Four-Stage Pipeline Docs
- CLI Render Engine
- MuseTalk Lipsync Server
- Task Status Bar UI
- Block Script Editor
- Astro Site Package
- Visual Validation Scan
- TTS Generation Engine
- Web App Shell
- Asset Manager UI
- Astro Content Types
- Web TypeScript Config
- Image Generation Module
- Project Page Shell
- MuseTalk FastAPI Server
- Pinia Project Task Stores
- Config Defaults Types
- Markdown Block Parser
- Block Sidebar UI
- Root DevDependencies
- Root Runtime Dependencies
- Server Task Queue
- Remotion TS Config
- Script Editor UI
- CLI Entry Commands
- Hono Server Entry
- Project Service Routes
- Doctor Health Checks
- Web PRD Architecture
- Block API Routes
- Service Start Scripts
- Settings Panel UI
- VoxCPM Numerics Ops
- Visual Metrics Module
- Assets API Routes
- Meta YAML Types
- QA Validation Module
- Batch Optimization
- JSON Schema Types
- Visual Review Pipeline
- Compile Stage Core
- Block Panel UI
- Compile Stage Helpers
- Script Parser Module
- Camera Transform Remotion
- Loudnorm Audio Processing
- Asset Upload Dialog
- Blocks JSON Schema
- Compile Stage Utils
- File Guard Utils
- Task Runner Service
- Install Scripts
- Duration Timing Helpers
- Fade Animation Helpers
- Component Generation
- CARLA Demo Content
- Attention QKV Lesson
- Marketing Thumbnails A
- Build Artifacts Layout
- Enter Frames Animation
- Path Guard Middleware
- System Utils
- CARLA Demo Content B
- Marketing Thumbnails B
- Camera Lesson Content
- Autonomy Perception Lesson
- Marketing Thumbnails C
- Marketing Thumbnails D
- Batched GPU Rendering
- Marketing Thumbnails E
- Cache Hit Tracking
- Schema Descriptions
- AI Brain Icon Asset
- MicroGPT Agent Lesson
- CARLA Demo Content C
- Marketing Thumbnails F
- Marketing Thumbnails G
- Marketing Thumbnails H
- WebRTC Encoding Lesson
- Prepare Assets Stage
- Package Manifests
- Aspect Ratio Helpers
- Camera Sensors Lesson
- Candidate Pool Logic
- Marketing Thumbnails I
- Lesson Comparison Content
- Marketing Thumbnails J
- Cornell Box Lesson
- NPM Scripts
- Animation Presets
- Subtitle Lines Model
- Sandbox Isolation
- Partial Cache Keys
- Marketing Thumbnails K
- Marketing Thumbnails L
- CARLA Simulator Asset
- Sky Backdrop Visual
- Ocean Surface Visual
- Marketing Thumbnails M
- Enter Animation Props
- Schema Additional Props
- Enter Frames Helpers
- Test Fixtures
- Test Fixtures 2
- Total Internal Reflection
- Pipeline Flow Diagram
- Pattern Matching
- Schema Items
- Remotion Comp Root
- SenseNova T2I Service
- Title Cards Remotion
- Lipsync Feature Docs
- Render Pipeline Slide
- Render Pipeline Timeline
- Shader Code Slide
- Shader Comparison
- Marketing Thumbnails N
- Service Stop Scripts
- E2E Tests
- Astro Content Config
- View Transform Slide
- Test Fixtures 3
- Camera Transform Helpers
- Matrix Math Slide
- Babel Parser Dep
- Pinyin Pro Dep
- Unit Test Suite
- MuseTalk Start Script
- VoxCPM Start Script
- Env Type Declarations

## God Nodes (most connected - your core abstractions)
1. `Script` - 29 edges
2. `TaskQueue` - 25 edges
3. `visuals()` - 24 edges
4. `remotion` - 23 edges
5. `render()` - 22 edges
6. `CacheStore` - 19 edges
7. `loadConfig()` - 19 edges
8. `createBlockRoutes()` - 16 edges
9. `tts()` - 16 edges
10. `AutoVideoConfig` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Build Output Path Constraint` --semantically_similar_to--> `Build --out Directory Rule`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/BUILD.md
- `Markdown to MP4 Pipeline` --semantically_similar_to--> `Four-Stage Pipeline`  [INFERRED] [semantically similar]
  README.md → docs/AGENTS.md
- `Compile Fixture Block B01` --semantically_similar_to--> `Starter Welcome Block B01`  [INFERRED] [semantically similar]
  tests/fixtures/compile-test/block1.md → templates/starter/script.md
- `getConfig()` --calls--> `loadConfig()`  [EXTRACTED]
  bin/autovideo.ts → src/config/load.ts
- `AutoVideo Web UI` --references--> `ETag Optimistic Concurrency`  [INFERRED]
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
- **BuildUnreal Thumbnail Visual Composition** — autovideo_site_public_thumbs_buildunreal_crystalline_core, autovideo_site_public_thumbs_buildunreal_data_stream, autovideo_site_public_thumbs_buildunreal_vertical_light_beam, autovideo_site_public_thumbs_buildunreal_presenter_inset [INFERRED 0.85]
- **EP03 simulation tick and sync control flow** — autovideo_site_public_thumbs_calrla3_ep03_sim_engine_api, autovideo_site_public_thumbs_calrla3_tick_loop, autovideo_site_public_thumbs_calrla3_sync_control_loop, autovideo_site_public_thumbs_calrla3_feed_data_to_algorithm [INFERRED 0.85]
- **Run E2E Agent in CARLA with Ego Vehicle** — autovideo_site_public_thumbs_carla1_carla, autovideo_site_public_thumbs_carla1_sparsedrivev2, autovideo_site_public_thumbs_carla1_e2e_agent, autovideo_site_public_thumbs_carla1_ego_vehicle [EXTRACTED 1.00]
- **EP02 Ego Sensor Installation Flow** — autovideo_site_public_thumbs_carla2_ep02, autovideo_site_public_thumbs_carla2_ego_vehicle, autovideo_site_public_thumbs_carla2_install_sensors_task, autovideo_site_public_thumbs_carla2_camera_sensors [INFERRED 0.85]
- **EP04 Episode Focus Bundle** — autovideo_site_public_thumbs_carla4_ep04, autovideo_site_public_thumbs_carla4_e2e_paradigm_evolution, autovideo_site_public_thumbs_carla4_why_sparse, autovideo_site_public_thumbs_carla4_model_inference [EXTRACTED 1.00]
- **EP05 Architecture Analysis Theme** — autovideo_site_public_thumbs_carla5_ep05_architecture_analysis, autovideo_site_public_thumbs_carla5_sparsedrivev2, autovideo_site_public_thumbs_carla5_scoring_is_all_you_need, autovideo_site_public_thumbs_carla5_candidate_pool [EXTRACTED 1.00]
- **Closed-loop Pipeline Tutorial Steps** — autovideo_site_public_thumbs_carla6_carla_environment, autovideo_site_public_thumbs_carla6_sensors, autovideo_site_public_thumbs_carla6_tick_loop, autovideo_site_public_thumbs_carla6_sparsedrivev2, autovideo_site_public_thumbs_carla6_closed_loop_evaluation [EXTRACTED 1.00]
- **EP07 Scenario Library Score Improvement 8→9** — autovideo_site_public_thumbs_carla7_epic_v2, autovideo_site_public_thumbs_carla7_epic_v3, autovideo_site_public_thumbs_carla7_scenario_library, autovideo_site_public_thumbs_carla7_multi_agent, autovideo_site_public_thumbs_carla7_cursor_agent [INFERRED 0.85]
- **MyRender Car Scene Composition** — autovideo_site_public_thumbs_myrender1_3_compact_car_render, autovideo_site_public_thumbs_myrender1_3_road_ground_plane, autovideo_site_public_thumbs_myrender1_3_blue_sky_backdrop [EXTRACTED 1.00]
- **顶点到像素四步管线** — autovideo_site_public_thumbs_myrender2_coordinate_transform, autovideo_site_public_thumbs_myrender2_clipping, autovideo_site_public_thumbs_myrender2_rasterization, autovideo_site_public_thumbs_myrender2_depth_testing [EXTRACTED 1.00]
- **Raymarching Demo Thumbnail Composition** — autovideo_site_public_thumbs_raymarching_scene, autovideo_site_public_thumbs_raymarching_geometric_primitives, autovideo_site_public_thumbs_raymarching_checkered_floor, autovideo_site_public_thumbs_raymarching_directional_lighting, autovideo_site_public_thumbs_raymarching_caption, autovideo_site_public_thumbs_raymarching_speaker_inset [INFERRED 0.85]
- **Claude Code AI Agent Capability Icons** — autovideo_site_public_thumbs_ai_codeing_ai_brain_icon, autovideo_site_public_thumbs_ai_codeing_automation_gear_icon, autovideo_site_public_thumbs_ai_codeing_chat_speech_icon, autovideo_site_public_thumbs_ai_codeing_claude_code [INFERRED 0.85]
- **Claude Code IDE Interaction Surface** — autovideo_site_public_thumbs_ai_codeing_code_editor_window, autovideo_site_public_thumbs_ai_codeing_cli_prompt_cursor, autovideo_site_public_thumbs_ai_codeing_claude_code [INFERRED 0.85]
- **C++ Hello World with Claude Code promo scene** — autovideo_site_public_thumbs_ai_coding2_cpp, autovideo_site_public_thumbs_ai_coding2_hello_world_cpp, autovideo_site_public_thumbs_ai_coding2_gpp_compile_run, autovideo_site_public_thumbs_ai_coding2_claude_code, autovideo_site_public_thumbs_ai_coding2_scene_01 [INFERRED 0.85]
- **PART 03 进阶篇主题组** — autovideo_site_public_thumbs_ai_coding3_context_management, autovideo_site_public_thumbs_ai_coding3_mcp_protocol, autovideo_site_public_thumbs_ai_coding3_multi_agent_collaboration, autovideo_site_public_thumbs_ai_coding3_hands_on_20_lines [EXTRACTED 1.00]
- **IMU–Camera Joint Calibration** — autovideo_site_public_thumbs_imu_cam_calib_imu, autovideo_site_public_thumbs_imu_cam_calib_camera, autovideo_site_public_thumbs_imu_cam_calib_joint_calibration [EXTRACTED 1.00]
- **From Pinhole Imaging to Ground Plane Hypothesis for Ranging** — autovideo_site_public_thumbs_imu_cam_calib_pinhole_imaging, autovideo_site_public_thumbs_imu_cam_calib_ground_plane_hypothesis, autovideo_site_public_thumbs_imu_cam_calib_obstacle_ranging [EXTRACTED 1.00]
- **From Pinhole Model to Intrinsics/Extrinsics via Reprojection Error** — autovideo_site_public_thumbs_kalibr_pinhole_model, autovideo_site_public_thumbs_kalibr_reprojection_error_optimization, autovideo_site_public_thumbs_kalibr_intrinsics, autovideo_site_public_thumbs_kalibr_extrinsics [EXTRACTED 1.00]
- **Kalibr Calibration of Autonomous Driving Multi-Camera Systems** — autovideo_site_public_thumbs_kalibr_kalibr, autovideo_site_public_thumbs_kalibr_camera_calibration, autovideo_site_public_thumbs_kalibr_multi_camera, autovideo_site_public_thumbs_kalibr_autonomous_driving_perception [EXTRACTED 1.00]
- **Episode 1 LLM Training Foundations** — autovideo_site_public_thumbs_microgpt1_data, autovideo_site_public_thumbs_microgpt1_tokenizer, autovideo_site_public_thumbs_microgpt1_parameter_skeleton [EXTRACTED 1.00]
- **MicroGPT forward pass pipeline** — autovideo_site_public_thumbs_microgpt2_input_characters, autovideo_site_public_thumbs_microgpt2_embedding, autovideo_site_public_thumbs_microgpt2_attention, autovideo_site_public_thumbs_microgpt2_mlp, autovideo_site_public_thumbs_microgpt2_output_logits, autovideo_site_public_thumbs_microgpt2_next_char_prediction [EXTRACTED 1.00]
- **Attention QKV inputs** — autovideo_site_public_thumbs_microgpt2_query, autovideo_site_public_thumbs_microgpt2_key, autovideo_site_public_thumbs_microgpt2_value, autovideo_site_public_thumbs_microgpt2_attention [EXTRACTED 1.00]
- **Value Node Triple (data, children, local grads)** — autovideo_site_public_thumbs_microgpt3_value_node, autovideo_site_public_thumbs_microgpt3_data, autovideo_site_public_thumbs_microgpt3_children, autovideo_site_public_thumbs_microgpt3_local_grads [EXTRACTED 1.00]
- **Forward Path to Loss** — autovideo_site_public_thumbs_microgpt3_add_op, autovideo_site_public_thumbs_microgpt3_mul_op, autovideo_site_public_thumbs_microgpt3_exp_op, autovideo_site_public_thumbs_microgpt3_log_op, autovideo_site_public_thumbs_microgpt3_sum_op, autovideo_site_public_thumbs_microgpt3_loss [EXTRACTED 1.00]
- **Teaching Video Overlay Layout** — autovideo_site_public_thumbs_ocean_ocean_surface, autovideo_site_public_thumbs_ocean_presenter_pip, autovideo_site_public_thumbs_ocean_chinese_subtitle_bar [INFERRED 0.85]
- **PiP Ocean Tutorial Composition** — autovideo_site_public_thumbs_ocean2_ocean_surface, autovideo_site_public_thumbs_ocean2_presenter_inset, autovideo_site_public_thumbs_ocean2_subtitle_bar [INFERRED 0.85]
- **Cornell Box Global Illumination Demo** — autovideo_site_public_thumbs_smallpt1_cornell_box, autovideo_site_public_thumbs_smallpt1_mirror_sphere, autovideo_site_public_thumbs_smallpt1_glass_sphere, autovideo_site_public_thumbs_smallpt1_ceiling_area_light, autovideo_site_public_thumbs_smallpt1_color_bleeding, autovideo_site_public_thumbs_smallpt1_caustics [INFERRED 0.85]
- **smallpt Path-Tracing Material Demo** — autovideo_site_public_thumbs_smallpt2_remotion_cornell_box_scene, autovideo_site_public_thumbs_smallpt2_remotion_reflective_sphere, autovideo_site_public_thumbs_smallpt2_remotion_refractive_sphere, autovideo_site_public_thumbs_smallpt2_remotion_ceiling_light, autovideo_site_public_thumbs_smallpt2_remotion_caustics [INFERRED 0.85]
- **Cornell Box Global Illumination Demonstration** — autovideo_site_public_thumbs_smallpt3_cornell_box, autovideo_site_public_thumbs_smallpt3_reflective_sphere, autovideo_site_public_thumbs_smallpt3_refractive_sphere, autovideo_site_public_thumbs_smallpt3_ceiling_light, autovideo_site_public_thumbs_smallpt3_color_bleeding, autovideo_site_public_thumbs_smallpt3_caustics [INFERRED 0.85]
- **SpeedTree Rendering Pipeline Topics** — autovideo_site_public_thumbs_speedtree_hdrp, autovideo_site_public_thumbs_speedtree_urp, autovideo_site_public_thumbs_speedtree_batched_gpu, autovideo_site_public_thumbs_speedtree_lod [EXTRACTED 1.00]
- **Before/after interface performance contrast** — autovideo_site_public_thumbs_sync1_frozen_interface, autovideo_site_public_thumbs_sync1_smooth_multitasking, autovideo_site_public_thumbs_sync1_split_screen_ux_contrast, autovideo_site_public_thumbs_sync1_caption_ui_freeze [INFERRED 0.85]
- **Fork metaphor: sync gears vs async glow path** — autovideo_site_public_thumbs_sync2_developer_fork_choice, autovideo_site_public_thumbs_sync2_sync_gears_path, autovideo_site_public_thumbs_sync2_async_glow_path [INFERRED 0.85]
- **Construction Site Prop Ensemble** — autovideo_site_public_thumbs_urp1_workbench_tools, autovideo_site_public_thumbs_urp1_wall_framing, autovideo_site_public_thumbs_urp1_drywall_paint, autovideo_site_public_thumbs_urp1_work_light [EXTRACTED 1.00]
- **Tutorial Video Presentation Layout** — autovideo_site_public_thumbs_urp2_unity_construction_scene, autovideo_site_public_thumbs_urp2_presenter_inset, autovideo_site_public_thumbs_urp2_unity_export_caption [EXTRACTED 1.00]
- **Construction Site Set Dressing** — autovideo_site_public_thumbs_urp2_workbench_tools, autovideo_site_public_thumbs_urp2_wooden_wall_frame, autovideo_site_public_thumbs_urp2_cyan_painted_wall, autovideo_site_public_thumbs_urp2_tripod_work_light [EXTRACTED 1.00]
- **Low-latency global video call scene** — autovideo_site_public_thumbs_webrtc1_dual_laptop_video_call, autovideo_site_public_thumbs_webrtc1_high_speed_data_stream, autovideo_site_public_thumbs_webrtc1_global_network_globe, autovideo_site_public_thumbs_webrtc1_zero_delay, autovideo_site_public_thumbs_webrtc1_caption_video_call_latency [INFERRED 0.85]
- **WebRTC Media Transport Protocol Stack** — autovideo_site_public_thumbs_webrtc2_media_payload, autovideo_site_public_thumbs_webrtc2_srtp, autovideo_site_public_thumbs_webrtc2_udp, autovideo_site_public_thumbs_webrtc2_ip [EXTRACTED 1.00]
- **Starter Hero Placeholder Composition** — templates_starter_hero_solid_blue_square, templates_starter_hero_placeholder_hero_asset, templates_starter_hero_uniform_saturated_blue, templates_starter_hero_starter_template_visual [INFERRED 0.75]
- **Minimal PNG stub used as diagram asset in compile-test fixtures** — tests_fixtures_compile_test_assets_diagram_placeholder_png, tests_fixtures_compile_test_assets_diagram_compile_test_fixture, tests_fixtures_compile_test_assets_diagram_stub_diagram [INFERRED 0.75]

## Communities (149 total, 17 thin omitted)

### Community 0 - "CLI Build Pipeline"
Cohesion: 0.08
Nodes (37): generateLocalImage(), cleanupStill(), build(), buildCommand(), BuildError, BuildOptions, BuildResult, CompileOptions (+29 more)

### Community 1 - "Block Outputs UI"
Cohesion: 0.06
Nodes (31): actionLoading, audioDurationSec, audioEl, audioExists, audioMenuOpts, audioUrl, base, cmEl (+23 more)

### Community 2 - "Meta Editor UI"
Cohesion: 0.07
Nodes (39): applyAvatarRadiusToMeta(), applyLipsyncToMeta(), avatarDeleting, avatarExists, avatarRadius, avatarRadiusChoices, avatarRadiusOptions, avatarUploading (+31 more)

### Community 3 - "Site Project Meta Sync"
Cohesion: 0.06
Nodes (24): PROJECT_META, THEMES, DEEPREAD_DIR, __dirname, findValidBuild(), hasDeepread(), main(), OUTPUT (+16 more)

### Community 4 - "Web Editor Dependencies"
Cohesion: 0.05
Nodes (38): @codemirror/commands, @codemirror/lang-javascript, @codemirror/lang-yaml, @codemirror/state, @codemirror/theme-one-dark, @codemirror/view, naive-ui, pinia (+30 more)

### Community 5 - "Cursor Tool Schemas"
Cohesion: 0.05
Nodes (39): 16:9, 1:1, 9:16, enum, type, description, maximum, minimum (+31 more)

### Community 6 - "Remotion Subtitle Overlay"
Cohesion: 0.09
Nodes (29): findCurrentLine(), renderHighlightedText(), SubtitleOverlay(), BlockFrame(), getEnterStyle(), getExitStyle(), DARK_CODE, getTheme() (+21 more)

### Community 7 - "Cache Store Layer"
Cohesion: 0.10
Nodes (23): AudioKey, CacheKey, CacheStats, CacheStore, CacheStoreOptions, CacheType, CleanOptions, ComponentKey (+15 more)

### Community 8 - "Remotion Root Preview"
Cohesion: 0.10
Nodes (21): computeDurationFrames(), generatePreviewRoot(), RootPreviewOptions, RootRenderOptions, AnimationProps, ASPECT_RATIOS, assertVisualsReady(), AudioReadyScript (+13 more)

### Community 9 - "Project TopBar Actions"
Cohesion: 0.07
Nodes (30): buildDisabled, buildLoading, clampVisualConcurrency(), compileDisabled, compileLoading, concurrencySaving, confirmNoAvatar(), doctorItems (+22 more)

### Community 10 - "Four-Stage Pipeline Docs"
Cohesion: 0.07
Nodes (33): Build Output Path Constraint, Branded Stage Readiness Types, compile Stage, Content-Hash Cache, Four-Stage Pipeline, render Stage, script.json Canonical IR, tts Stage (+25 more)

### Community 11 - "CLI Render Engine"
Cohesion: 0.11
Nodes (25): computeBlockTimingWithFps(), render(), RenderError, resolveAvatarRadius(), shouldGenerateMuseTalkLipsync(), shouldOverlayRawAvatarLoop(), ConcatOptions, concatPartials() (+17 more)

### Community 12 - "MuseTalk Lipsync Server"
Cohesion: 0.08
Nodes (33): Test Video meta fixture, float16 VRAM savings, MuseTalk /lipsync REST API, lipsync_server.py FastAPI wrapper, max-avatar-seconds avatar trim, Serial inference lock, torch.load weights_only=False patch, Avatar PiP lipsync mode (+25 more)

### Community 13 - "Task Status Bar UI"
Cohesion: 0.07
Nodes (26): TaskStatus, allTasks, expanded, logContent, logLoading, { message }, props, runningLabel (+18 more)

### Community 14 - "Block Script Editor"
Cohesion: 0.09
Nodes (28): assetPaths, buildExtensions(), conflictEtag, conflictVisible, editorEl, emit, handleColorSchemeChange(), isDirty (+20 more)

### Community 15 - "Astro Site Package"
Cohesion: 0.07
Nodes (27): astro, @astrojs/markdown-remark, @astrojs/svelte, dependencies, astro, @astrojs/markdown-remark, @astrojs/svelte, katex (+19 more)

### Community 16 - "Visual Validation Scan"
Cohesion: 0.13
Nodes (23): analyzeByFileSize(), analyzeImage(), ASTScanResult, astStaticScan(), ensureNodeModules(), execFileAsync, extractSourceSnippet(), extractTscErrorContext() (+15 more)

### Community 17 - "TTS Generation Engine"
Cohesion: 0.12
Nodes (15): computeVoxcpmModelVersion(), md5File(), tts(), TtsError, concatenateWavsWithGaps(), generateSilenceWav(), getWavDurationSec(), computeLineTimings() (+7 more)

### Community 18 - "Web App Shell"
Cohesion: 0.08
Nodes (19): app, createForm, createRules, creating, deleting, deletingProject, demoCreating, doDelete() (+11 more)

### Community 19 - "Asset Manager UI"
Cohesion: 0.09
Nodes (21): AssetFile, assets, dialog, errorMsg, fetchAssets(), fileInputRef, isDragOver, loading (+13 more)

### Community 20 - "Astro Content Types"
Cohesion: 0.08
Nodes (25): AllValuesOf, astro:content, CollectionEntry, CollectionKey, ContentConfig, DataEntryMap, ExtractCollectionFilterType, ExtractDataType (+17 more)

### Community 21 - "Web TypeScript Config"
Cohesion: 0.08
Nodes (24): DOM, DOM.Iterable, env.d.ts, ES2022, src/**/*.vue, compilerOptions, baseUrl, esModuleInterop (+16 more)

### Community 22 - "Image Generation Module"
Cohesion: 0.16
Nodes (22): ASPECT_TO_SIZE, buildImageKey(), buildWrapperComponent(), cacheModel(), createFetchController(), fetchOpenAIImage(), fetchRemoteImage(), fetchSenseNovaImage() (+14 more)

### Community 23 - "Project Page Shell"
Cohesion: 0.08
Nodes (18): activeTab, nonStandard, pageLoadTime, parsedBlocks, projectName, rightCollapsed, route, scriptEditorKey (+10 more)

### Community 24 - "MuseTalk FastAPI Server"
Cohesion: 0.14
Nodes (23): BaseModel, get, ndarray, on_event, post, Response, build_styled_text(), cleanup() (+15 more)

### Community 25 - "Pinia Project Task Stores"
Cohesion: 0.13
Nodes (20): ProgressEvent, cleanup(), ProjectSummary, useProjectStore, formatStage(), getStageLabel(), STAGE_LABEL, useTaskStore (+12 more)

### Community 26 - "Config Defaults Types"
Cohesion: 0.14
Nodes (20): AnthropicConfig, CacheConfig, DEFAULT_CONFIG, ImageGenConfig, LoudnormConfig, MusetalkConfig, RenderConfig, VisualQualityConfig (+12 more)

### Community 27 - "Markdown Block Parser"
Cohesion: 0.15
Nodes (18): BlockError, extractSection(), parseBlockFile(), parseTitleLine(), RawBlock, splitIntoSegments(), DirectiveError, ParsedDirectives (+10 more)

### Community 28 - "Block Sidebar UI"
Cohesion: 0.11
Nodes (22): addBlock(), addingBlock, apiBlocks, batchClearCache(), batchCreate(), batchForce, batchLoading, checkedIds (+14 more)

### Community 29 - "Root DevDependencies"
Cohesion: 0.09
Nodes (23): ajv, @babel/types, concurrently, devDependencies, ajv, @babel/types, concurrently, @remotion/cli (+15 more)

### Community 30 - "Root Runtime Dependencies"
Cohesion: 0.09
Nodes (23): @anthropic-ai/sdk, commander, @hono/node-server, ms, p-limit, dependencies, @anthropic-ai/sdk, commander (+15 more)

### Community 32 - "Remotion TS Config"
Cohesion: 0.09
Nodes (21): bin/**/*.ts, remotion/**/*.ts, remotion/**/*.tsx, compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, jsx (+13 more)

### Community 33 - "Script Editor UI"
Cohesion: 0.13
Nodes (20): buildExtensions(), conflictData, ConflictInfo, conflictVisible, editorEl, emit, handleColorSchemeChange(), initEditor() (+12 more)

### Community 34 - "CLI Entry Commands"
Cohesion: 0.15
Nodes (12): getConfig(), program, copyDirRecursive(), initCommand(), copyRemotionFiles(), ensurePublicScript(), findAvailablePort(), generatePreviewRootForBuild() (+4 more)

### Community 35 - "Hono Server Entry"
Cohesion: 0.13
Nodes (16): hono, hono, app, __dirname, DIST_SEGMENTS, gitignorePath, port, server (+8 more)

### Community 36 - "Project Service Routes"
Cohesion: 0.19
Nodes (18): copyDir(), createProjectRoutes(), removeDir(), TEMPLATES_DIR, computeEtag(), ConflictResult, countBlocks(), FileWithEtag (+10 more)

### Community 37 - "Doctor Health Checks"
Cohesion: 0.20
Nodes (17): checkCacheDirWritable(), checkCJKFonts(), checkClaudeApiConnectivity(), checkClaudeCredentials(), checkDiskSpace(), checkNode(), checkPrlimitUnshare(), CheckResult (+9 more)

### Community 38 - "Web PRD Architecture"
Cohesion: 0.12
Nodes (18): Deepread Block File Layout, Deepread Authoring Principles, AutoVideo, ETag Optimistic Concurrency, Single-Thread FIFO Task Queue, Web UI Agent Workflow, .autovideo-web Config Store, AutoVideo Web Deployment (+10 more)

### Community 39 - "Block API Routes"
Cohesion: 0.20
Nodes (14): ANIMATION_PRESETS, CACHE_CLEAR_KINDS, createBlockRoutes(), isCacheClearKind(), patchDirective(), patchVisualMode(), resolveSlug(), VISUAL_MODES (+6 more)

### Community 40 - "Service Start Scripts"
Cohesion: 0.31
Nodes (15): build_all(), check_env(), err(), info(), install_deps(), ok(), port_busy(), section() (+7 more)

### Community 41 - "Settings Panel UI"
Cohesion: 0.13
Nodes (16): activeTab, anthropicConcurrencyOptions, clampAnthropicConcurrency(), emit, form, imageGenProviderOptions, loadConfig(), { message } (+8 more)

### Community 42 - "VoxCPM Numerics Ops"
Cohesion: 0.15
Nodes (17): Addition Op (+, data=-0.95), _children (incoming nodes), Computational Graph, Forward Propagation Computational Graph Slide, data (current value), Exponential Op (exp, data=0.39), Forward Propagation, Input a (data=0.42) (+9 more)

### Community 43 - "Visual Metrics Module"
Cohesion: 0.18
Nodes (14): assessVisualMetrics(), cellEdgeMean(), computeImageMetrics(), computeStaticMetrics(), dimensionRef(), execFileAsync, ImageMetrics, resolveNodePx() (+6 more)

### Community 44 - "Assets API Routes"
Cohesion: 0.24
Nodes (14): AssetError, BlockForAssets, CODE_EXTENSIONS, computeFileHash(), ensureDirForFile(), FileRef, inlineCodeSnippet(), isCodeFile() (+6 more)

### Community 45 - "Meta YAML Types"
Cohesion: 0.22
Nodes (14): ASPECT_TO_DIMS, aspectToDimensions(), DEFAULTS, extractMetaSegment(), MetaError, MetaOverrides, ParsedMeta, parseMetaKvLines() (+6 more)

### Community 46 - "QA Validation Module"
Cohesion: 0.24
Nodes (15): checkNonBlackFrames(), execBuffer(), execCapture(), isFrameBlack(), probeDuration(), probeFormatDuration(), probeResolution(), QABlockTiming (+7 more)

### Community 47 - "Batch Optimization"
Cohesion: 0.12
Nodes (6): AnimationProps, AnimationProps, remotion, AnimationProps, CARDS, AnimationProps

### Community 48 - "JSON Schema Types"
Cohesion: 0.12
Nodes (16): type, description, pattern, type, description, type, properties, enter (+8 more)

### Community 49 - "Visual Review Pipeline"
Cohesion: 0.21
Nodes (14): extractJson(), reviewViaCLI(), reviewViaSDK(), reviewVisual(), toResult(), VisualReviewConfig, VisualReviewInput, VisualReviewResult (+6 more)

### Community 50 - "Compile Stage Core"
Cohesion: 0.22
Nodes (11): compile(), loadSchema(), parseMetaArgs(), AssetProcessResult, parseAndMergeBlocks(), ProjectError, RawProjectJson, readProject() (+3 more)

### Community 51 - "Block Panel UI"
Cohesion: 0.18
Nodes (15): activeTab, ANIM_OPTIONS, currentEnter, currentExit, currentMode, editorKey, emit, { message } (+7 more)

### Community 52 - "Compile Stage Helpers"
Cohesion: 0.14
Nodes (13): schemas/**/*.json, server/**/*.ts, ./tsconfig.json, web, compilerOptions, outDir, rootDir, exclude (+5 more)

### Community 53 - "Script Parser Module"
Cohesion: 0.18
Nodes (12): ParseResult, ParseWarning, ScriptJson, ScriptJsonBlock, ApiError, AppConfig, AppConfigPublic, BlocksResponse (+4 more)

### Community 54 - "Camera Transform Remotion"
Cohesion: 0.22
Nodes (10): add(), AnimationProps, CameraTransform(), cross(), isoProj(), norm(), rotY(), scale() (+2 more)

### Community 55 - "Loudnorm Audio Processing"
Cohesion: 0.20
Nodes (7): applyLoudnorm(), execAsync(), LoudnormConfig, LoudnormResult, MeasuredValues, parseMeasuredValues(), Block

### Community 56 - "Asset Upload Dialog"
Cohesion: 0.18
Nodes (11): accept, blockId, emit, fileName, handleCancel(), handleUpload(), maxUploadBytes, message (+3 more)

### Community 57 - "Blocks JSON Schema"
Cohesion: 0.15
Nodes (12): type, title, properties, blockId, $schema, title, required, $schema (+4 more)

### Community 58 - "Compile Stage Utils"
Cohesion: 0.15
Nodes (13): properties, format, type, format, type, audioGeneratedAt, compiledAt, renderedAt (+5 more)

### Community 59 - "File Guard Utils"
Cohesion: 0.36
Nodes (10): fileGuard(), createAssetRoutes(), getMime(), MIME_TYPES, isAllowedRootUploadBasename(), isSafeRelativePathSegment(), maxRootUploadBytes(), maxRootUploadLabel() (+2 more)

### Community 60 - "Task Runner Service"
Cohesion: 0.27
Nodes (10): copyDir(), createTaskRunner(), getTaskConfig(), loadWebConfig(), snapshotSourceFiles(), syncAvatarMetaToScript(), wrapProgress(), extractScriptAssetRefs() (+2 more)

### Community 61 - "Install Scripts"
Cohesion: 0.21
Nodes (7): info(), install.sh script, step(), warn(), install.sh script, install.sh script, install.sh script

### Community 62 - "Duration Timing Helpers"
Cohesion: 0.17
Nodes (12): durationSec, lineTimings, wavPath, additionalProperties, description, properties, required, type (+4 more)

### Community 63 - "Fade Animation Helpers"
Cohesion: 0.27
Nodes (12): fade, fade-down, fade-up, none, slide-left, slide-right, zoom-in, zoom-out (+4 more)

### Community 64 - "Component Generation"
Cohesion: 0.27
Nodes (10): AnthropicConfig, buildUserContent(), ComponentGenInput, ComponentGenResult, generateComponent(), generateComponentViaCLI(), NOTE: we intentionally do NOT forward --model to the CLI., RetryContext (+2 more)

### Community 65 - "CARLA Demo Content"
Cohesion: 0.33
Nodes (11): CARLA, CARLA x SparseDriveV2 仿真教程, Ego 车, EP02, EP03: 仿真引擎与 API, EP03 Slide: 仿真引擎与 API, 把数据喂给算法, 带传感器的车辆（已安装） (+3 more)

### Community 66 - "Attention QKV Lesson"
Cohesion: 0.29
Nodes (11): 注意力 (Q/K/V), 嵌入 (dim=16), 前向传播：数据如何流过模型, 输入字符, Key (K), 前馈网络 MLP (16→64→16), 模型即4000多个随机数字, 下一个字符的预测 (+3 more)

### Community 67 - "Marketing Thumbnails A"
Cohesion: 0.27
Nodes (11): 经典的康奈尔盒子场景 Caption, Refractive Caustics on Floor, Circular Ceiling Area Light, Color Bleeding Global Illumination, Red and Blue Cornell Box Walls, Classic Cornell Box Scene, Monte Carlo Path-Tracing Noise, Reflective Metallic Sphere (+3 more)

### Community 68 - "Build Artifacts Layout"
Cohesion: 0.18
Nodes (10): artifacts, assets, blocks, meta, additionalProperties, description, required, $schema (+2 more)

### Community 69 - "Enter Frames Animation"
Cohesion: 0.18
Nodes (11): enterFrames, enterSec, exitSec, frames, holdSec, totalSec, timing, additionalProperties (+3 more)

### Community 70 - "Path Guard Middleware"
Cohesion: 0.35
Nodes (8): projectGuard(), parseRange(), serveFileWithRange(), createOutputRoutes(), resolveSlug(), computeSlug(), parseMetaFields(), computeOutputSlug()

### Community 71 - "System Utils"
Cohesion: 0.36
Nodes (10): configPath(), createSystemRoutes(), loadConfig(), mergeConfig(), publicConfig(), resolveConfig(), saveConfig(), checkChromium() (+2 more)

### Community 72 - "CARLA Demo Content B"
Cohesion: 0.31
Nodes (10): CARLA, CARLA Environment, CARLA × SparseDriveV2 Simulation Tutorial, Closed-loop Evaluation, Closed-loop Pipeline (trained model to CARLA test), EP06: Closed-loop Evaluation Practical Session, Sensors, SparseDriveV2 (+2 more)

### Community 73 - "Marketing Thumbnails B"
Cohesion: 0.29
Nodes (10): AutoSim, Closed-Loop Evaluation (闭环评测), Cursor Agent, EP06 Closed-Loop Evaluation, EP07: 8分到9分, epic_v2 (8 PASS · 1 WARN · 1 FAIL), epic_v3 (9 PASS · 0 WARN · 1 FAIL), Multi-Agent Collaboration (+2 more)

### Community 74 - "Camera Lesson Content"
Cohesion: 0.31
Nodes (10): 相机 Camera, 地平面假设 Ground Plane Hypothesis, IMU, 智能系统感知 Intelligent System Perception, IMU与相机联合标定 Joint Calibration, 障碍物测距 Obstacle Ranging, 针孔成像 Pinhole Imaging, 机器人 Robot (+2 more)

### Community 75 - "Autonomy Perception Lesson"
Cohesion: 0.29
Nodes (10): Autonomous Driving Perception, Autonomous Vehicle, Camera Calibration, Camera Extrinsics, Camera Intrinsics, Kalibr, Autonomous Driving Multi-Camera System, Pinhole Model (+2 more)

### Community 76 - "Marketing Thumbnails C"
Cohesion: 0.29
Nodes (10): Rotating 3D Scene Caption, Checkered Ground Plane, Soft Directional Lighting With Shadows, Twenty-Plus Geometric Primitives, Gold Torus Primitive, Gold Wireframe Cube, Purple Specular Sphere, Raymarching 3D Geometry Scene (+2 more)

### Community 77 - "Marketing Thumbnails D"
Cohesion: 0.27
Nodes (10): Floor Caustics Under Glass Sphere, Circular Ceiling Light Source, Red Left and Blue Right Walls, Cornell Box Style Path-Traced Scene, Monte Carlo Path-Tracing Noise, Narrator Picture-in-Picture Overlay, Metallic Reflective Sphere, Glass Refractive Sphere (+2 more)

### Community 78 - "Batched GPU Rendering"
Cohesion: 0.27
Nodes (10): Batched GPU, Blender MCP Alternative, HDRP, LOD, Rendering Principles, SpeedTree, Technical Artists, SpeedTree Tree Rendering Title Slide (+2 more)

### Community 79 - "Marketing Thumbnails E"
Cohesion: 0.29
Nodes (10): Partially Painted Cyan Wall with Paint Buckets, Circular Presenter Face Inset, Yellow Tripod Double Work Light, Unity Indoor Construction Scene, Caption: 我们已经从 Unity 导出了场景, Unity Scene Export, URP Universal Render Pipeline, Video Thumbnail UI Overlay (+2 more)

### Community 80 - "Cache Hit Tracking"
Cohesion: 0.20
Nodes (10): cacheHit, partialPath, cacheHit, partialPath, render, additionalProperties, description, properties (+2 more)

### Community 81 - "Schema Descriptions"
Cohesion: 0.20
Nodes (10): description, componentPath, description, imagePath, videoPath, visual, additionalProperties, properties (+2 more)

### Community 82 - "AI Brain Icon Asset"
Cohesion: 0.28
Nodes (9): AI Brain Icon, AI-Powered Coding Agent, Automation Gear Icon, Chat Speech Bubble Icon, Claude Code, Command-Line Prompt with Cursor, Glowing Code Editor Window, Network Knowledge Graph Background (+1 more)

### Community 83 - "MicroGPT Agent Lesson"
Cohesion: 0.31
Nodes (9): Agent 核心只有 20 行, AI 写代码看着像魔法, 揭秘 AI 编程的真相, 上下文管理, 工程冰山藏在水下 (100,000+ 行工程代码), 动手实现 20 行, MCP 协议, 多 Agent 协作 (+1 more)

### Community 84 - "CARLA Demo Content C"
Cohesion: 0.36
Nodes (9): CARLA, CARLA Simulation Environment, CARLA × SparseDriveV2 Simulation Tutorial, End-to-End Autonomous Driving Paradigm Evolution, EP04: End-to-End Autonomous Driving Paradigm Evolution, Model Inference, SparseDriveV2, Carla4 Episode Title Slide (+1 more)

### Community 85 - "Marketing Thumbnails F"
Cohesion: 0.31
Nodes (9): sync1 thumbnail, 界面冻结转着圈无响应, Frozen unresponsive interface, Ghosted stuttering windows, Loading spinner buffering, Orbiting window icons, Smooth multitasking performance, Speaker video inset (+1 more)

### Community 86 - "Marketing Thumbnails G"
Cohesion: 0.31
Nodes (9): URP Construction Site Thumbnail, 3D Construction Site Scene, Partially Painted Drywall with Paint Buckets, No Graphics Card Used Claim, Presenter Video Inset Overlay, Unity Universal Render Pipeline, Wooden Stud Wall Framing with Door Opening, Tripod Dual-Head Work Light (+1 more)

### Community 87 - "Marketing Thumbnails H"
Cohesion: 0.36
Nodes (9): webrtc1 thumbnail, 当你视频通话时，对方几乎是零延迟地动着嘴, Dual-laptop video call, Wireframe global network globe, High-speed blue data stream, Mirrored video participant on both screens, Speaker video inset, WebRTC realtime communications (+1 more)

### Community 88 - "WebRTC Encoding Lesson"
Cohesion: 0.31
Nodes (9): WebRTC Encoding Compression, IP, WebRTC Latency Reduction, 媒体载荷 (Media Payload), WebRTC Protocol Stack Diagram, Purple Ring Protocol Label (uncertain), SRTP, UDP (+1 more)

### Community 89 - "Prepare Assets Stage"
Cohesion: 0.25
Nodes (7): DATA_FILE, __dirname, main(), PROJECT_DIR, sh(), THUMBS_DIR, VIDEOS_DIR

### Community 90 - "Package Manifests"
Cohesion: 0.22
Nodes (8): bin, autovideo, description, engines, node, name, type, version

### Community 91 - "Aspect Ratio Helpers"
Cohesion: 0.22
Nodes (9): aspect, fps, height, schemaVersion, subtitleSafeBottom, theme, voiceRef, width (+1 more)

### Community 92 - "Camera Sensors Lesson"
Cohesion: 0.39
Nodes (8): Camera Sensors, CARLA × SparseDriveV2 Simulation Tutorial, Ego Vehicle, EP02: Sensors and Data Collection, Install Sensors Task, Eyes Ears and Touch Sensing Metaphor, Sensors and Data Collection, CARLA SparseDriveV2 EP02 Title Slide

### Community 93 - "Candidate Pool Logic"
Cohesion: 0.43
Nodes (8): Dense Computable Candidate Pool, CARLA, CARLA × SparseDriveV2 Simulation Tutorial, EP05 SparseDriveV2 Architecture Analysis, Generation vs Generation Scoring, Scoring is All You Need, SparseDriveV2, Carla5 EP05 Title Slide

### Community 94 - "Marketing Thumbnails I"
Cohesion: 0.43
Nodes (8): Data, microgpt.py Episode 1 Video Thumbnail, LLM Training, microgpt.py, Neural Network Diagram, Parameter Skeleton, Tokenizer, 200-Line Python LLM Primer

### Community 95 - "Lesson Comparison Content"
Cohesion: 0.46
Nodes (8): 本集逐项对照, 裁剪 (切掉视野外), 坐标变换 (MVP矩阵), 调试截图验证, 深度测试 (遮挡关系), MVP矩阵, 光栅化 (三角形铺像素), 顶点变成像素的过程

### Community 96 - "Marketing Thumbnails J"
Cohesion: 0.36
Nodes (8): Chinese Subtitle Bar, Clear Sky and Horizon Line, Deep Blue Ocean Surface with Waves, Presenter Picture-in-Picture Inset, Sunlight Glints on Water, Ocean Video Thumbnail, 海浪起伏，阳光在水面上跳动, Wide-Angle Ocean Horizon Composition

### Community 97 - "Cornell Box Lesson"
Cohesion: 0.29
Nodes (8): 一个经典的 Cornell Box 场景, Glass Sphere Caustics, Circular Ceiling Area Light, Color Bleeding Global Illumination, Cornell Box Scene, Glass Refractive Sphere, Mirror Reflective Sphere, Low-Sample Path-Traced Noise

### Community 98 - "NPM Scripts"
Cohesion: 0.25
Nodes (8): scripts, build, build:client, build:server, build:web, dev, dev:web, start:web

### Community 99 - "Animation Presets"
Cohesion: 0.25
Nodes (8): animation, image, video, visualMode, default, description, enum, type

### Community 100 - "Subtitle Lines Model"
Cohesion: 0.25
Nodes (8): lines, additionalProperties, properties, required, type, explicitDurationSec, lines, narration

### Community 101 - "Sandbox Isolation"
Cohesion: 0.36
Nodes (6): buildWhitelistedEnv(), ENV_WHITELIST, runIsolated(), SandboxOptions, SandboxResult, wrapWithIsolation()

### Community 102 - "Partial Cache Keys"
Cohesion: 0.39
Nodes (7): PartialKey, copyFile(), ensureDir(), getRemotionVersion(), renderBlocks(), RenderBlocksOptions, RenderBlocksResult

### Community 103 - "Marketing Thumbnails K"
Cohesion: 0.57
Nodes (7): 用 Claude Code 写一个 C++ 程序, Claude Code, C++, g++ Compile and Run Hello World, 用 C++ 写 Hello World, SCENE 01, AI Coding C++ Thumbnail

### Community 104 - "Marketing Thumbnails L"
Cohesion: 0.48
Nodes (7): Crystalline Geometric Core, Glowing Data Stream Path, Futuristic Tech Aesthetic, Presenter Circular Inset, BuildUnreal Video Thumbnail, Vertical Light Beam, YouTube-Style Thumbnail Layout

### Community 105 - "CARLA Simulator Asset"
Cohesion: 0.52
Nodes (7): CARLA Simulator, End-to-End Autonomous Driving Agent, Ego Vehicle, EP01: CARLA Simulator Overview, CARLA × SparseDriveV2 Simulation Tutorial Series, SparseDriveV2, CARLA × SparseDriveV2 EP01 Title Card

### Community 106 - "Sky Backdrop Visual"
Cohesion: 0.33
Nodes (7): Clear Blue Sky Backdrop, Weathered Orange Compact Car 3D Render, C++ CPU Line-by-Line Rasterization, MyRender Application Window, Dark Asphalt Road Ground Plane, Subtitle Claim: Rendered in C++ on CPU, Presenter Webcam Inset

### Community 107 - "Ocean Surface Visual"
Cohesion: 0.43
Nodes (7): Choppy Deep Blue Ocean Surface, PiP Teaching Video Layout, Presenter Picture-in-Picture Inset, Sea Shape Creation (Prior Episode), Chinese Subtitle Overlay, Ocean Tutorial Video Frame, Wide-Angle Curved Horizon

### Community 108 - "Marketing Thumbnails M"
Cohesion: 0.48
Nodes (7): async/await, async/await Recap Slide (sync2 thumbnail), Asynchronous glowing path metaphor, Cross-language async/await comparison, Developer at fork choosing execution path, Video presenter webcam inset, Synchronous gears path metaphor

### Community 109 - "Enter Animation Props"
Cohesion: 0.29
Nodes (7): enter, exit, id, narration, visual, required, title

### Community 110 - "Schema Additional Props"
Cohesion: 0.29
Nodes (7): additionalProperties, type, additionalProperties, type, properties, artifacts, meta

### Community 111 - "Enter Frames Helpers"
Cohesion: 0.29
Nodes (7): enterFrames, enterSec, exitSec, frames, holdSec, totalSec, properties

### Community 112 - "Test Fixtures"
Cohesion: 0.29
Nodes (4): CompileError, FIXTURE_PROJECT, FIXTURES_DIR, OUTPUT_BASE

### Community 113 - "Test Fixtures 2"
Cohesion: 0.38
Nodes (4): createMockServer(), generateWavBuffer(), makeConfig(), makeOpts()

### Community 114 - "Total Internal Reflection"
Cohesion: 0.38
Nodes (6): AnimationProps, describeArc(), polarToCartesian(), RAY_GROUPS, RayGroup, TOTAL_REFLECTION()

### Community 115 - "Pipeline Flow Diagram"
Cohesion: 0.40
Nodes (4): AnimationProps, NODES, PipelineFlow(), PipelineFlow()

### Community 116 - "Pattern Matching"
Cohesion: 0.33
Nodes (6): pattern, type, additionalProperties, description, type, assets

### Community 117 - "Schema Items"
Cohesion: 0.33
Nodes (6): items, minItems, type, additionalProperties, type, blocks

### Community 119 - "SenseNova T2I Service"
Cohesion: 0.40
Nodes (4): HF_ENDPOINT, SENSENOVA_DEVICE_MAP, SENSENOVA_MODEL_PATH, start.sh script

### Community 120 - "Title Cards Remotion"
Cohesion: 0.40
Nodes (3): AnimationProps, CARDS, COLORS

### Community 121 - "Lipsync Feature Docs"
Cohesion: 0.67
Nodes (4): Lipsync Feature Complete, MuseTalk Integration Pipeline, avatarRef Lipsync Field, MuseTalk Lipsync

### Community 125 - "Shader Comparison"
Cohesion: 0.67
Nodes (3): AnimationProps, easeOut(), SlideComparison()

### Community 126 - "Marketing Thumbnails N"
Cohesion: 0.67
Nodes (4): Placeholder Hero Asset, Solid Blue Square Hero Image, Starter Template Visual Slot, Uniform Saturated Blue Field

### Community 132 - "Test Fixtures 3"
Cohesion: 1.00
Nodes (3): Compile-Test Diagram Fixture Asset, 1x1 Placeholder PNG Diagram, Stub Diagram (No Visual Content)

## Ambiguous Edges - Review These
- `Test Video meta fixture` → `Avatar PiP lipsync mode`  [AMBIGUOUS]
  tests/fixtures/compile-test/meta.md · relation: conceptually_related_to
- `No Graphics Card Used Claim` → `Unity Universal Render Pipeline`  [AMBIGUOUS]
  autovideo-site/public/thumbs/urp1.jpg · relation: conceptually_related_to
- `SRTP` → `Purple Ring Protocol Label (uncertain)`  [AMBIGUOUS]
  autovideo-site/public/thumbs/webrtc2.jpg · relation: semantically_similar_to
- `UDP` → `Purple Ring Protocol Label (uncertain)`  [AMBIGUOUS]
  autovideo-site/public/thumbs/webrtc2.jpg · relation: conceptually_related_to

## Knowledge Gaps
- **747 isolated node(s):** `AnimationProps`, `AnimationProps`, `AnimationProps`, `AnimationProps`, `STEPS` (+742 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Test Video meta fixture` and `Avatar PiP lipsync mode`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `No Graphics Card Used Claim` and `Unity Universal Render Pipeline`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `SRTP` and `Purple Ring Protocol Label (uncertain)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `UDP` and `Purple Ring Protocol Label (uncertain)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `properties` connect `JSON Schema Types` to `Animation Presets`, `Subtitle Lines Model`, `Enter Frames Animation`, `Cache Hit Tracking`, `Schema Descriptions`, `Schema Items`, `Duration Timing Helpers`, `Fade Animation Helpers`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `visualMode` connect `Animation Presets` to `JSON Schema Types`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `default` connect `Animation Presets` to `Remotion Root Preview`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._