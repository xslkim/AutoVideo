# AutoVideo Input Specification

## Project Structure

A minimal AutoVideo project consists of:

```
my-project/
  project.json       # project manifest
  meta.md            # video metadata
  script.md          # block content (can be multiple files)
  autovideo.config.json  # optional configuration overrides
  hero.png           # assets (images)
```

## project.json

```json
{
  "meta": "./meta.md",
  "blocks": ["./script.md"]
}
```

- `meta`: path to metadata file (relative to project directory)
- `blocks`: array of block content files (parsed in order)

## meta.md

YAML frontmatter with video-level metadata:

```markdown
--- meta ---
title: My Video Title
aspect: 16:9
theme: dark-code
fps: 30
---
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | string | required | Video title, used for output directory slug |
| `aspect` | `16:9` \| `9:16` \| `1:1` | `16:9` | Aspect ratio |
| `theme` | string | `dark-code` | Theme name (currently only `dark-code`) |
| `fps` | number | `30` | Frames per second |
| `voiceRef` | string | auto | Path to reference audio WAV (10-30s) |
| `slug` | string | auto | Override output directory name |

## Block Syntax

Blocks are defined with `>>>` headers in markdown files:

```markdown
>>> Block Title #B01
@enter: fade-up
@exit: fade

--- visual ---
Visual description for AI to generate component.
Can reference images: 显示图片 ./hero.png

--- narration ---
First narration line with **highlighted words**.
Second narration line.

>>> Second Block #B02
@duration: 6s

--- visual ---
Another visual description

--- narration ---
Narration for the second block
```

### Block Header

```
>>> Display Title #BLOCK_ID
```

- Display title shown in the video
- `#BLOCK_ID`: unique identifier (e.g., `B01`, `B02`)

### Directives

| Directive | Example | Description |
|-----------|---------|-------------|
| `@enter` | `@enter: fade-up` | Entrance animation preset |
| `@exit` | `@exit: fade` | Exit animation preset |
| `@duration` | `@duration: 6s` | Override narration duration |

### Animation Presets

`fade`, `fade-up`, `fade-down`, `slide-left`, `slide-right`, `zoom-in`, `zoom-out`, `none`

### Visual Section

Plain text description fed to Claude AI to generate a React/Remotion component.

- Reference images with relative paths: `显示图片 ./hero.png`
- Describe layout, colors, animations

### Narration Section

Text spoken by TTS. Supports **bold markers** for subtitle highlighting:

```
This is **important** text
```

The word "important" will be highlighted with the accent color in subtitles.

## Assets

Images referenced in visual sections are:
1. Hashed by content (SHA-256)
2. Copied to `build/<slug>/public/assets/<hash>.png`
3. Paths rewritten in script.json

## Configuration (autovideo.config.json)

Optional file in project root:

```json
{
  "voxcpm": {
    "endpoint": "http://127.0.0.1:8000",
    "cfgValue": 2.0,
    "inferenceTimesteps": 10,
    "concurrency": 4
  },
  "anthropic": {
    "model": "claude-sonnet-4-6",
    "maxRetries": 3
  },
  "render": {
    "blockConcurrency": 4,
    "loudnorm": { "i": -16, "tp": -1.5, "lra": 11 }
  },
  "cache": {
    "dir": "~/.cache/autovideo",
    "maxSizeGB": 10
  }
}
```
