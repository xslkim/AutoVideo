/**
 * T3.4 — lineTimings 计算
 *
 * 从各行音频时长（秒）推导每行字幕的起止时间戳（毫秒）。
 *
 * 公式（PRD §6.2.3 step 4）：
 *   startMs[i] = Σ(行[0..i-1] 时长 + 行[0..i-1] 后的静音)
 *   endMs[i]   = startMs[i] + 行[i]时长
 *
 * 静音默认 200ms；调用方可传入按标点计算的逐行间隔（见 tts/gaps.ts），
 * 此时必须与拼接音频时使用的间隔完全一致，否则字幕会与语音错位。
 *
 * 下半部分是字级时间戳（charTimings，逐字卡拉OK字幕用）：
 * estimate* 是均匀语速估算；fetchAlignHealth / requestLineAlignment /
 * buildCharTimingsFromAlignment 是 align-tts 强制对齐服务的客户端
 * （third_servers/align-tts/），可达时用真实对齐覆盖估算值。
 */

import fs from "node:fs";

/** 默认每行音频后附加的静音时长（毫秒） */
export const DEFAULT_GAP_MS = 200;

export interface LineTiming {
  lineIndex: number;
  startMs: number;
  endMs: number;
}

/**
 * 从各行音频时长（秒）计算 lineTimings 数组。
 *
 * @param lineDurationsSec 各行音频时长，单位秒（不含尾部静音）
 * @param gapsMs 每行之后的静音（毫秒）；缺省为固定 200ms
 * @returns lineTimings 数组，startMs / endMs 单位毫秒
 */
export function computeLineTimings(
  lineDurationsSec: number[],
  gapsMs?: number[]
): LineTiming[] {
  const timings: LineTiming[] = [];

  let cursorMs = 0; // 累积游标，指向下一行的 startMs

  for (let i = 0; i < lineDurationsSec.length; i++) {
    const durationMs = lineDurationsSec[i] * 1000;

    timings.push({
      lineIndex: i,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
    });

    cursorMs += durationMs + (gapsMs?.[i] ?? DEFAULT_GAP_MS);
  }

  return timings;
}

// ── 字级时间戳（charTimings） ────────────────────────────────────────

/**
 * 单个字符在块音频内的时间跨度，供逐字卡拉OK字幕驱动。
 *
 * 时间是块相对秒（与渲染侧 frame = sec × fps 的时钟一致）；
 * lineIndex 把字符挂回所属旁白行，字符顺序与该行 ttsText 一致。
 */
export interface CharTiming {
  lineIndex: number;
  char: string;
  startSec: number;
  endSec: number;
}

/** align-tts 服务返回的单个字 token，行内相对毫秒。 */
export interface AlignToken {
  char: string;
  startMs: number;
  endMs: number;
}

/**
 * 按 Unicode 码点切分字符（emoji / CJK 扩展区的代理对不拆开）。
 */
export function splitChars(text: string): string[] {
  return Array.from(text);
}

/**
 * 行内均匀语速估算：把该行音频跨度 [startMs, endMs] 均分给每个字符。
 * 中文语速近似均匀，作为无对齐服务时的兜底；标点/空格同样占一份时长。
 */
export function estimateLineCharTimings(
  text: string,
  lineIndex: number,
  timing: LineTiming
): CharTiming[] {
  const chars = splitChars(text);
  if (chars.length === 0) return [];

  const spanMs = Math.max(0, timing.endMs - timing.startMs);
  const perCharMs = spanMs / chars.length;

  return chars.map((char, ci) => ({
    lineIndex,
    char,
    startSec: (timing.startMs + ci * perCharMs) / 1000,
    endSec: (timing.startMs + (ci + 1) * perCharMs) / 1000,
  }));
}

/**
 * 整块的字级估算：逐行均分后按行序拼接。
 * lineTexts[i] 对应 lineTimings[i]（ttsText，即字幕展示文本）。
 */
export function estimateCharTimings(
  lineTexts: string[],
  lineTimings: LineTiming[]
): CharTiming[] {
  return lineTimings.flatMap((timing, li) =>
    estimateLineCharTimings(lineTexts[li] ?? "", timing.lineIndex, timing)
  );
}

/**
 * 把 align-tts 的行内对齐结果换算成块相对秒的 CharTiming。
 *
 * displayText 是字幕展示文本（ttsText）；tokens 对应实际参与对齐的字符
 * 序列——ttsText 去掉 ASCII 括号（不朗读，见 cli/tts.ts stripCodeParens）
 * 和空白字符（FunASR 对齐按非空白字计数）。这两类字符映射回展示文本时
 * 给零时长（锚在前一字末尾），卡拉OK高亮会直接跳过它们。
 *
 * token 数或字符内容与被朗读文本对不上时返回 null（调用方回退估算）——
 * 对齐模型可能改写文本（全半角、英文分词），宁可用估算也不产出错位时间戳。
 */
export function buildCharTimingsFromAlignment(
  displayText: string,
  tokens: AlignToken[],
  lineIndex: number,
  lineStartMs: number
): CharTiming[] | null {
  // 与 align-tts 服务的约定：不被朗读的字符（ASCII 括号、空白）不占时长
  const isSilentChar = (c: string) => c === "(" || c === ")" || /\s/.test(c);
  const displayChars = splitChars(displayText);
  const spokenChars = displayChars.filter((c) => !isSilentChar(c));

  if (tokens.length !== spokenChars.length) return null;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].char !== spokenChars[i]) return null;
  }

  const out: CharTiming[] = [];
  let ti = 0;
  let prevEndMs = lineStartMs;
  for (const char of displayChars) {
    if (isSilentChar(char)) {
      const anchorSec = prevEndMs / 1000;
      out.push({ lineIndex, char, startSec: anchorSec, endSec: anchorSec });
      continue;
    }
    const token = tokens[ti++];
    const startMs = lineStartMs + Math.max(0, token.startMs);
    const endMs = lineStartMs + Math.max(token.startMs, token.endMs, 0);
    prevEndMs = endMs;
    out.push({ lineIndex, char, startSec: startMs / 1000, endSec: endMs / 1000 });
  }
  return out;
}

// ── align-tts 服务客户端（third_servers/align-tts/） ────────────────────

/**
 * 健康检查：服务可达且模型加载完成返回 true（加载中/未启动返回 false）。
 * 连接被拒会立即返回，不会让调用方等满 timeout。
 */
export async function fetchAlignHealth(
  endpoint: string,
  timeoutMs = 2000
): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 请求一行的强制对齐：上传该行 WAV + 被朗读文本，返回行内相对毫秒的
 * 字级 token 序列。HTTP 错误或响应缺 tokens 字段时抛错（调用方回退估算）。
 */
export async function requestLineAlignment(
  endpoint: string,
  wavPath: string,
  text: string,
  timeoutMs = 30_000
): Promise<AlignToken[]> {
  const wavBase64 = fs.readFileSync(wavPath).toString("base64");

  const res = await fetch(`${endpoint.replace(/\/+$/, "")}/align`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wav_base64: wavBase64, text }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown error");
    throw new Error(`align-tts /align failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    tokens?: { char: string; start_ms: number; end_ms: number }[];
  };
  if (!Array.isArray(data.tokens)) {
    throw new Error("align-tts /align response missing tokens array");
  }
  return data.tokens.map((t) => ({
    char: t.char,
    startMs: t.start_ms,
    endMs: t.end_ms,
  }));
}