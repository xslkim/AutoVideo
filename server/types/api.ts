// 共享类型定义 — 源自 WEB_PRD.md 附录 B
// 前端通过 path alias 引用

export type Stage = 'compile' | 'tts' | 'visuals' | 'render' | 'build' | 'merge';

export type TaskStatus = 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface ProgressEvent {
  percent: number;          // 0-100
  step: string;             // 用户可见的中文步骤说明
  stage: Stage;             // 当前 stage（build 模式下子 stage）
  blockId?: string;         // 当前正在处理的块（如有）
}

export interface TaskRecord {
  id: string;               // ULID
  project: string;
  stage: Stage;
  blockIds?: string[];
  force: boolean;
  outputSlug: string;       // 入队时由 live meta.md 计算，运行全程固定（§3.3）
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  lastProgress?: ProgressEvent;
  errorMessage?: string;
  errorCode?: string;
  errorStack?: string;
}

export type VisualMode = 'animation' | 'image' | 'video';

export type CacheClearKind = 'audio' | 'visual' | 'partial' | 'all';

export interface BlockStatus {
  id: string;               // 'B01'
  title: string;            // 块头标题（不含 #Bxx）
  line: number;             // 块头在 script.md 中的行号（1-based）
  visualMode: VisualMode;   // 默认 'animation'
  imageSource?: string;     // if set, image mode uses local file (no API needed)
  videoSource?: string;     // if set, video mode uses local mp4 (no API needed)
  enter: string;            // 入场动画，默认 'fade'
  exit: string;             // 出场动画，默认 'fade'
  audio: boolean;           // 来自 block.audio?.wavPath + 文件存在
  visual: boolean;          // animation: block.visual.componentPath；image: block.visual.imagePath
  rendered: boolean;        // 来自 block.render?.partialPath + 文件存在
}

export interface BlocksResponse {
  blocks: BlockStatus[];
  warnings: { line: number; message: string }[];
  currentSlug: string;
}

export interface AppConfig {
  version: 1;
  anthropic?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    concurrency?: number;
    /** Use local `claude` CLI instead of Anthropic SDK */
    useCLI?: boolean;
    /** Path to the `claude` binary (default: "claude") */
    cliPath?: string;
  };
  imageGen?: {
    provider?: 'openai' | 'sensenova';
    baseURL?: string;
    apiKey?: string;
    model?: string;
    size?: string;
    timeoutMs?: number;
    concurrency?: number;
    numSteps?: number;
    cfgScale?: number;
  };
  voxcpm?: {
    endpoint?: string;
    modelDir?: string;
    autoStart?: boolean;
    concurrency?: number;
  };
  musetalk?: {
    url?: string;
  };
}

export interface AppConfigPublic {
  version: 1;
  anthropic: {
    apiKey: { set: boolean; last4?: string };
    baseURL?: string;
    model?: string;
    concurrency?: number;
  };
  imageGen: {
    provider?: 'openai' | 'sensenova';
    baseURL?: string;
    apiKey: { set: boolean; last4?: string };
    model?: string;
    size?: string;
    timeoutMs?: number;
    concurrency?: number;
    numSteps?: number;
    cfgScale?: number;
  };
  voxcpm: {
    endpoint?: string;
    modelDir?: string;
    autoStart?: boolean;
    concurrency?: number;
  };
  musetalk: {
    url?: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface DoctorReport {
  voxcpm: { status: 'ok' | 'fail'; message?: string };
  anthropic: { status: 'ok' | 'missing'; message?: string };
  imageGen: { status: 'ok' | 'missing' | 'fail'; message?: string };
  ffmpeg: { status: 'ok' | 'missing'; version?: string };
  remotion: { status: 'ok'; version: string };
  musetalk: { status: 'ok' | 'fail' | 'missing'; message?: string };
}
