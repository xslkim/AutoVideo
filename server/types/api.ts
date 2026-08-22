// 共享类型定义 — 源自 docs/architecture/WEB_PRD.md 附录 B
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

export type VisualMode = 'animation' | 'image' | 'video' | 'html';

export type CacheClearKind = 'audio' | 'visual' | 'partial' | 'all';

export interface BlockStatus {
  id: string;               // 'B01'
  title: string;            // 块头标题（不含 #Bxx）
  line: number;             // 块头在 script.md 中的行号（1-based）
  visualMode: VisualMode;   // 默认 'animation'
  imageSource?: string;     // if set, image mode uses local file (no API needed)
  videoSource?: string;     // if set, video mode uses local mp4 (no API needed)
  htmlSource?: string;      // if set, html mode loads external .html file
  enter: string;            // 入场动画，默认 'fade'
  exit: string;             // 出场动画，默认 'fade'
  audio: boolean;           // 来自 block.audio?.wavPath + 文件存在
  visual: boolean;          // animation: componentPath；image: imagePath；html: htmlPath
  rendered: boolean;        // 来自 block.render?.partialPath + 文件存在
}

export interface BlocksResponse {
  blocks: BlockStatus[];
  warnings: { line: number; message: string }[];
  currentSlug: string;
}

export type AgentProviderName = 'anthropic-api' | 'claude-cli' | 'opencode-cli' | 'codex-cli';

/** 思考强度档位（仅 anthropic-api 驱动生效）；未设置等同 'off' */
export type ThinkingMode = 'off' | 'low' | 'medium' | 'high';

export interface AppConfig {
  version: 1;
  anthropic?: {
    /** Agent backend; unset → legacy useCLI mapping */
    provider?: AgentProviderName;
    apiKey?: string;
    baseURL?: string;
    model?: string;
    concurrency?: number;
    /** Legacy flag: use local `claude` CLI (superseded by provider) */
    useCLI?: boolean;
    /** Path to the agent CLI binary */
    cliPath?: string;
    /** Timeout for a single CLI invocation in ms */
    cliTimeoutMs?: number;
    /** 思考强度（仅 anthropic-api 驱动生效） */
    thinking?: ThinkingMode;
    /** 评审独立配置（可选；未设字段沿用生成配置）。生成模型无视觉能力时使用。 */
    review?: {
      provider?: AgentProviderName;
      model?: string;
      baseURL?: string;
      apiKey?: string;
      cliPath?: string;
      cliTimeoutMs?: number;
    };
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
    concurrency?: number;
    /** 服务器端确定性 seed 的盐（换值 = 全量重 roll）；非空时进音频缓存 key */
    seedSalt?: string;
  };
  /** TTS engine selector（仅文件配置场景下也由 PUT 透传，避免被白名单丢弃） */
  tts?: {
    provider?: 'voxcpm' | 'cosyvoice';
    /** 合成 QA 门（src/tts/qa.ts）；省略字段走默认值 */
    qa?: {
      enabled?: boolean;
      maxRetries?: number;
    };
  };
  cosyvoice?: {
    endpoint?: string;
    modelDir?: string;
    concurrency?: number;
    /** 参考音频文本（CosyVoice zero-shot 必需）；不设则回退 voiceRef 同名 .txt */
    referenceText?: string;
    normalize?: boolean;
    /** 语速倍率（>1 更快，0.5–2.0）；非 1.0 时进音频缓存 key */
    speed?: number;
    /** 服务器端确定性 seed 的盐（换值 = 全量重 roll）；非空时进音频缓存 key */
    seedSalt?: string;
  };
  musetalk?: {
    url?: string;
  };
  visualQuality?: {
    enabled?: boolean;
    minFontCoeff?: number;
    minAnyFontCoeff?: number;
    minElements?: number;
    minCoverage?: number;
    review?: boolean;
    maxReviewRounds?: number;
  };
}

export interface AppConfigPublic {
  version: 1;
  anthropic: {
    provider?: AgentProviderName;
    apiKey: { set: boolean; last4?: string };
    baseURL?: string;
    model?: string;
    concurrency?: number;
    useCLI?: boolean;
    cliPath?: string;
    cliTimeoutMs?: number;
    thinking?: ThinkingMode;
    review?: {
      provider?: AgentProviderName;
      model?: string;
      baseURL?: string;
      apiKey: { set: boolean; last4?: string };
      cliPath?: string;
      cliTimeoutMs?: number;
    };
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
    concurrency?: number;
    seedSalt?: string;
  };
  tts: {
    provider?: 'voxcpm' | 'cosyvoice';
    qa?: {
      enabled?: boolean;
      maxRetries?: number;
    };
  };
  cosyvoice: {
    endpoint?: string;
    modelDir?: string;
    concurrency?: number;
    referenceText?: string;
    normalize?: boolean;
    speed?: number;
    seedSalt?: string;
  };
  musetalk: {
    url?: string;
  };
  visualQuality: {
    enabled?: boolean;
    minFontCoeff?: number;
    minAnyFontCoeff?: number;
    minElements?: number;
    minCoverage?: number;
    review?: boolean;
    maxReviewRounds?: number;
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
  cosyvoice: { status: 'ok' | 'fail'; message?: string };
  anthropic: { status: 'ok' | 'missing'; message?: string };
  imageGen: { status: 'ok' | 'missing' | 'fail'; message?: string };
  ffmpeg: { status: 'ok' | 'missing'; version?: string };
  remotion: { status: 'ok'; version: string };
  musetalk: { status: 'ok' | 'fail' | 'missing'; message?: string };
}
