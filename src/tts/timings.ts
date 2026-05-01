/**
 * T3.4 — lineTimings 计算
 *
 * 从各行音频时长（秒）推导每行字幕的起止时间戳（毫秒）。
 *
 * 公式（PRD §6.2.3 step 4）：
 *   每行音频末尾固定附加 200ms 静音。
 *   startMs[i] = Σ(行[0..i-1] 时长 + 200ms)
 *   endMs[i]   = startMs[i] + 行[i]时长
 */

/** 每行音频后附加的静音时长（毫秒） */
const GAP_MS = 200;

export interface LineTiming {
  lineIndex: number;
  startMs: number;
  endMs: number;
}

/**
 * 从各行音频时长（秒）计算 lineTimings 数组。
 *
 * @param lineDurationsSec 各行音频时长，单位秒（不含尾部 200ms 静音）
 * @returns lineTimings 数组，startMs / endMs 单位毫秒
 */
export function computeLineTimings(lineDurationsSec: number[]): LineTiming[] {
  const timings: LineTiming[] = [];

  let cursorMs = 0; // 累积游标，指向下一行的 startMs

  for (let i = 0; i < lineDurationsSec.length; i++) {
    const durationMs = lineDurationsSec[i] * 1000;

    timings.push({
      lineIndex: i,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
    });

    // 当前行结束 + 200ms 静音 → 下一行起点
    cursorMs += durationMs + GAP_MS;
  }

  return timings;
}