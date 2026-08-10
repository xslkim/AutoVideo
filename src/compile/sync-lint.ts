/**
 * Narration-sync authoring lint (deterministic, no API cost).
 *
 * The animation pipeline can keep visuals in sync with the voiceover via
 * props.lineTimings — but only when the description declares the mapping and
 * the generated component honours it. These lints catch the two authoring
 * patterns that silently break sync, at compile time:
 *
 *  1. absolute-beat — the description uses absolute timestamps ([4.5s])
 *     past the entrance window. TTS duration shifts every synthesis, so
 *     absolute beats drift out of sync (the highlight lands on the wrong
 *     item). Purely-visual entrance stagger within the first few seconds
 *     is fine.
 *  2. missing-mapping — the narration enumerates items (第一/第二/…, ①②③,
 *     1. 2. 3.) but the description never says how visuals follow the
 *     narration, so the generator has nothing to wire lineTimings to.
 *
 * Warnings are non-blocking: they print at compile and are meant for the
 * author (human or LLM) to fix the description.
 */

import type { Block } from "../types/script.js";

export interface SyncLintWarning {
  blockId: string;
  rule: "absolute-beat" | "missing-mapping";
  message: string;
}

/** Narration line opens an enumerated item: 第一… / 1. / 1、/ ① / step 1 … */
const ENUMERATION_RE =
  /^\s*(第[一二三四五六七八九十百0-9]+|[0-9]+\s*[.、)]|step\s*[0-9]+|[①②③④⑤⑥⑦⑧⑨⑩])/i;

/** True when ≥2 narration lines enumerate items (a walkthrough structure). */
export function enumeratesNarration(lines: { text: string }[]): boolean {
  let count = 0;
  for (const l of lines) {
    if (ENUMERATION_RE.test(l.text)) count++;
  }
  return count >= 2;
}

/** Description phrases that declare "visuals follow the voiceover" intent. */
const SYNC_INTENT_RE =
  /lineTimings|跟随旁白|旁白跟随|跟着旁白|旁白推进|旁白切换|旁白讲|讲到哪|与旁白同步|对应旁白|按旁白|随旁白/;

export function declaresSyncIntent(description: string): boolean {
  return SYNC_INTENT_RE.test(description);
}

/** Absolute beat markers like [0.5s] / [4s] in a description. */
const ABSOLUTE_BEAT_RE = /\[(\d+(?:\.\d+)?)\s*s\]/g;

/**
 * Beats inside the entrance window are choreography, not narration sync —
 * only timestamps beyond it risk drifting against the voiceover.
 */
const ENTRANCE_WINDOW_SEC = 3;

/** Lint one block list; returns warnings (never throws). */
export function lintNarrationSync(blocks: Block[]): SyncLintWarning[] {
  const warnings: SyncLintWarning[] = [];

  for (const block of blocks) {
    if (block.visualMode !== "animation") continue;
    const description = block.visual?.description ?? "";

    ABSOLUTE_BEAT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let maxBeat = 0;
    while ((m = ABSOLUTE_BEAT_RE.exec(description)) !== null) {
      maxBeat = Math.max(maxBeat, parseFloat(m[1]));
    }
    if (maxBeat > ENTRANCE_WINDOW_SEC) {
      warnings.push({
        blockId: block.id,
        rule: "absolute-beat",
        message:
          `视觉描述含超出入场阶段的绝对时间戳（最大 [${maxBeat}s]）。` +
          `旁白由 TTS 合成、时长每次都会变，绝对节拍会静默错位——` +
          `跟随旁白的推进请改写为旁白行对应关系（组件可读 props.lineTimings），` +
          `详见 docs/AUTHORING.md「与旁白同步的节拍」。`,
      });
    }

    const lines = block.narration?.lines ?? [];
    if (enumeratesNarration(lines) && !declaresSyncIntent(description)) {
      warnings.push({
        blockId: block.id,
        rule: "missing-mapping",
        message:
          `旁白按条目推进（${lines.length} 行，含"第一/第二/…"或编号），但视觉描述未说明画面元素与旁白行的对应关系，` +
          `生成的动画可能不会跟随讲解推进。建议在描述中写明"旁白讲到第 N 项时高亮第 N 项（用 props.lineTimings 驱动）"。`,
      });
    }
  }

  return warnings;
}
