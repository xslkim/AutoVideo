# AutoVideo Architecture

## Overview

AutoVideo compiles Markdown teaching scripts into MP4 videos through a multi-stage pipeline:

```
Markdown → compile → TTS → visuals → render → MP4
```

The intermediate representation (IR) is `script.json`, a typed JSON file that carries all pipeline state.

## Pipeline Stages

### Stage 1: Compile (`src/cli/compile.ts`)

Parses project files into `script.json`:
1. Read `project.json` → resolve file paths
2. Parse `meta.md` → video metadata (dimensions, fps, theme)
3. Parse block markdown files → structured blocks with visual/narration sections
4. Process assets: hash content, copy to build dir, rewrite paths
5. Validate against JSON Schema (Ajv)
6. Write `script.json` + `public/script.json` + asset files

Output: `build/<slug>/script.json`

### Stage 2: TTS (`src/cli/tts.ts`)

Generates audio for each narration line:
1. Connect to VoxCPM2 TTS server (auto-start if configured)
2. For each block, generate WAV audio per narration line
3. Merge lines into block-level WAV with 200ms inter-line silence
4. Compute `lineTimings` (startMs/endMs per line)
5. Cache audio by text hash + voice config

Output: `public/audio/<blockId>.wav` + `script.json` with `audio` fields

### Stage 3: Visuals (`src/cli/visuals.ts`)

Generates React components from visual descriptions:
1. For each block, send visual description to Claude API
2. Claude generates a Remotion-compatible TSX component
3. Validate component in sandboxed subprocess (tsc + render smoke test)
4. Retry up to 3 times on validation failure
5. Cache component by description hash + model version

Output: `src/blocks/<blockId>/Component.tsx` + `script.json` with `componentPath` fields

### Stage 4: Render (`src/cli/render.ts`)

Renders blocks to MP4 and assembles final video:
1. Compute timing (enter/hold/exit frames per block)
2. Generate `remotion-root.tsx` with all block compositions
3. Bundle Remotion project once
4. Render each block as independent partial MP4 (parallel)
5. Concatenate partials with ffmpeg
6. Two-pass loudnorm normalization
7. Quality validation (resolution, duration, black frame detection)

Output: `output/final_normalized.mp4`

## Intermediate Representation: script.json

`script.json` is the central data structure flowing through the pipeline:

```typescript
interface Script {
  meta: { title, aspect, width, height, fps, theme, ... };
  blocks: Block[];
  assets: Record<string, string>;
  artifacts: { compiledAt, audioGeneratedAt, visualsGeneratedAt, renderedAt };
}

interface Block {
  id: string;           // "B01"
  title: string;
  enter: AnimationPreset;
  exit: AnimationPreset;
  visual: { description, componentPath? };
  narration: { lines: NarrationLine[] };
  audio?: { wavPath, durationSec, lineTimings };  // Stage 2 fills
  timing?: { enterSec, holdSec, exitSec, frames }; // Stage 4 fills
  render?: { partialPath, cacheHit };              // Stage 4 fills
}
```

### Type-Level Safety

TypeScript branded types enforce stage ordering at compile time:

- `CompiledScript` — after compile (no audio/componentPath)
- `AudioReadyScript` — after TTS (all blocks have audio)
- `VisualReadyScript` — after visuals (all blocks have componentPath)
- `RenderInputScript` — ready for render (audio + componentPath)
- `RenderedScript` — fully rendered (audio + componentPath + timing + render)

Runtime assertion functions (`assertCompiledScript`, `assertRenderInputReady`) provide descriptive error messages.

## Cache System (`src/cache/store.ts`)

Three cache types, each with a content-addressable key:

| Type | Key | Content |
|------|-----|---------|
| `audio` | text hash + voice config | WAV file |
| `component` | description hash + model | TSX file |
| `partial` | component hash + audio hash + theme + dimensions | MP4 file |

Cache entries are stored as `<cacheDir>/<type>/<hash>.<ext>` with a JSON manifest for metadata. Size-based eviction triggers when exceeding `maxSizeGB`.

## Remotion Integration

### Components

- `SubtitleOverlay` — renders timed narration subtitles with **highlight** support
- `BlockFrame` — wraps content with enter/exit animations
- `BlockComposition` — lazy-loads generated components, composes frame layout

### Theme (`remotion/engine/theme.ts`)

- `dark-code` theme: dark background, syntax-highlighted code colors
- CJK fonts via `@remotion/google-fonts/NotoSansSC`
- Emoji via `@remotion/google-fonts/NotoColorEmoji`
- Theme tokens: colors, fonts, spacing, subtitle config

### Rendering

Two modes:
- **Render mode** (`src/render/root-render.ts`): generates block-level Root.tsx for programmatic rendering
- **Preview mode** (`src/preview/root-preview.ts`): generates Root.tsx for Remotion Studio

## CLI Structure

```
bin/autovideo.ts          # Commander.js CLI entry point
src/cli/
  compile.ts              # Stage 1: Markdown → script.json
  tts.ts                  # Stage 2: Narration → WAV audio
  visuals.ts              # Stage 3: Description → React component
  render.ts               # Stage 4: Components → MP4
  preview.ts              # Open Remotion Studio
  build.ts                # Orchestrator: compile → tts → visuals → render
  cache.ts                # Cache management (stats/clean)
  doctor.ts               # Environment diagnostics
  init.ts                 # Create project from template
```

## Sub-Process Isolation (`src/ai/sandbox.ts`)

Visual components are validated in a sandboxed subprocess:
- Environment whitelist (PATH, HOME, LANG only)
- Optional memory limit via `prlimit`
- Optional CPU time limit
- Optional network isolation via `unshare -n`
- Configurable timeout

## Project Layout

```
AutoVideo/
  bin/autovideo.ts         # CLI entry
  src/
    types/script.ts        # Canonical types
    config/                # Configuration loading
    parser/                # Markdown/project parsing
    cache/                 # Cache store
    tts/                   # VoxCPM client, audio processing
    ai/                    # Claude API, component generation, sandbox
    render/                # Remotion rendering, concat, loudnorm, QA
    preview/               # Remotion Studio preview
    cli/                   # CLI command implementations
    utils/                 # Slugify, etc.
  remotion/
    components/            # SubtitleOverlay, etc.
    engine/                # Theme, types, BlockFrame
    Root.tsx               # Remotion root (render mode)
    VideoComposition.tsx   # Block composition
  templates/starter/       # Project template
  schemas/                 # JSON Schema for script.json
  tests/                   # Vitest test files
  docs/                    # Documentation
```
