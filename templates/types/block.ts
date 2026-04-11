/**
 * AutoVideo v2 — TypeScript types for blocks.json
 * Keep in sync with schemas/block.schema.json
 */

export interface Rect {
  x: number; y: number; w: number; h: number;
}

export interface AnimationConfig {
  preset: string;
  duration: number;
  easing?: string;
}

// ─── Content specs ────────────────────────────────────────────────────────────

export interface ImageSpec {
  src: string;
  source?: 'user' | 'ai-generated' | 'url';
  fit?: 'contain' | 'cover' | 'stretch';
  kenBurns?: { from: number; to: number; anchor?: string };
  altText?: string;
}

export interface CodeSpec {
  source: string;
  range?: [number, number] | null;
  language?: string;
  theme?: string;
  reveal?: { mode: string; linesPerSecond?: number; cursor?: boolean };
  highlights?: Array<{ line: number; color?: string }>;
  annotations?: Array<{ line: number; text: string; side?: string }>;
  inlineCode?: string;
  __lines?: string[];  // pre-processed by Stage 3
}

export interface AnimationSpec {
  description: string;
  timeline?: Array<{ at: number; do: string }>;
  componentPath: string | null;
}

export interface IconSpec {
  name: string;
  size?: number;
  color?: string;
  stroke?: number;
  anim?: string;
}

export interface LottieSpec {
  src: string;
  loop?: boolean;
  speed?: number;
}

export interface VideoSpec {
  src: string;
  muted?: boolean;
  startTime?: number;
  speed?: number;
}

export interface TextCardLine {
  text: string;
  style?: 'hero' | 'title' | 'body' | 'caption' | 'mono';
  color?: string;
}

export interface TextCardSpec {
  lines: TextCardLine[];
  align?: 'left' | 'center' | 'right';
  background?: string;
}

export type ContentSpec =
  | { type: 'image';     spec: ImageSpec }
  | { type: 'code';      spec: CodeSpec }
  | { type: 'animation'; spec: AnimationSpec }
  | { type: 'icon';      spec: IconSpec }
  | { type: 'lottie';    spec: LottieSpec }
  | { type: 'video';     spec: VideoSpec }
  | { type: 'textcard';  spec: TextCardSpec };

// ─── Main types ───────────────────────────────────────────────────────────────

export interface Emphasis {
  start: number;
  end: number;
  word?: string;
}

export interface SubtitleEntry {
  text: string;
  startMs: number;
  endMs: number;
  emphases?: Array<{ start: number; end: number }>;
}

export interface Narration {
  text: string;
  emphases: Emphasis[];
  hints: {
    pauseAfter?: number;
    rate?: number;
    style?: string;
  };
}

export interface BlockTiming {
  audioPath: string | null;
  vttPath: string | null;
  ttsDuration: number | null;
  enterDuration: number | null;
  holdDuration: number | null;
  exitDuration: number | null;
  totalDuration: number | null;
  startFrame: number | null;
  frames: number | null;
  provider: string | null;
}

export interface Block {
  id: string;
  title: string;
  narration: Narration;
  visual: {
    rect: Rect;
    enter: AnimationConfig;
    content: ContentSpec;
    exit: AnimationConfig;
  };
  timing: BlockTiming;
  subtitles: SubtitleEntry[];
  artifacts: {
    componentPath: string | null;
    assetFiles: string[];
    thumbnailPath: string | null;
  };
  status: {
    tts: string;
    component: string;
    render: string;
  };
}

export interface VideoMeta {
  title: string;
  aspect: '16:9' | '9:16' | '1:1';
  resolution: { w: number; h: number };
  fps: number;
  theme: string;
  voice: string;
}

export interface BlocksJson {
  version: '2.0';
  meta: VideoMeta;
  blocks: Block[];
}
