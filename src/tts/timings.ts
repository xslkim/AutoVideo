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
 */

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