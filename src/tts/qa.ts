/**
 * AutoVideo — Synthesis QA gate (per-line)
 *
 * Every synthesized take is analyzed with stock ffmpeg/ffprobe before it
 * enters the audio cache; flagged takes are re-rolled by the caller with a
 * per-call salt. Detection is deliberately heuristic and dependency-free:
 *
 *   1. duration anomaly  — actual duration vs the text-length expectation
 *   2. silence           — total silence ratio / longest single silence
 *                          (silencedetect)
 *   3. hit_guard         — max_volume at genuine full scale, above the
 *                          clip-guard's output level (volumedetect)
 *   4. RMS anomaly       — mean_volume so low the line is near-silent mumbling
 *
 * Calibration basis (thresholds below): post-A2 levels — the server's
 * clip-guard compresses peaks > 0.99 down to exactly 0.99 linear (≈ -0.087
 * dBFS, printed as -0.1 dB by volumedetect), so the old -0.1 dB threshold
 * flagged EVERY guard-touched take as "clipping" and burned re-rolls on
 * audio that was fine. -0.09 dB sits just above the guard's output: only
 * takes at real full scale trip it, and even then it's a soft signal —
 * output hugging the guard means the take runs hot, worth a re-roll for a
 * cleaner take, not a hard failure. Normal narration lines measure around
 * mean_volume -30…-15 dBFS, and the client-side alignment clamps per-line
 * gain to ±4 dB around the block median (MAX_LINE_GAIN_DB in audio.ts), so
 * -45 dB is far below any plausible aligned take yet well above the -80 dB
 * digital-silence sentinel (SILENCE_MEAN_DB in audio.ts).
 */

import { spawnSync } from "node:child_process";
import { getWavDurationSec } from "./audio.js";

// ---------------------------------------------------------------------------
// Thresholds (exported so calibration stays in one place)
// ---------------------------------------------------------------------------

export const QA_THRESHOLDS = {
  /** Expected Chinese narration rate, chars per second. */
  charsPerSec: 4.5,
  /** An ASCII word counts as this many Chinese chars of speaking time. */
  latinWordCharEquiv: 2,
  /** actual/expected below this → duration_too_short */
  minDurationRatio: 0.3,
  /** actual/expected above this → duration_too_long */
  maxDurationRatio: 3.0,
  /** Floor for the expected duration, so 1-char lines don't blow up the ratio. */
  minExpectedSec: 0.4,
  /** silencedetect noise floor (dBFS) */
  silenceNoiseDb: -35,
  /** Minimum segment length silencedetect counts as silence (s) */
  silenceMinDurSec: 0.25,
  /** Total silence fraction above this → silence_high */
  maxSilenceRatio: 0.5,
  /** A single internal silence longer than this → silence_long */
  maxSingleSilenceSec: 1.5,
  /**
   * max_volume (dBFS) at/above this → hit_guard. The servers' clip-guard
   * compresses peaks to 0.99 linear (≈ -0.087 dB, printed as -0.1 dB), so a
   * -0.1 dB threshold flagged every guard-touched take and white-burned
   * re-rolls; -0.09 dB only trips at genuine full scale. Semantic: output
   * hugging the guard = running hot — worth a re-roll for a cleaner take,
   * but a soft signal (see the weight), not a hard clipping verdict.
   */
  guardPeakDb: -0.09,
  /** mean_volume (dBFS) below this → rms_too_low (near-silent / mumbling) */
  minMeanVolumeDb: -45,
} as const;

/**
 * Score deductions per issue category. A take starts at 100 and loses the
 * weight of each category it trips (once per category); the score only exists
 * to pick the best of several flagged takes — a passing take always scores
 * 100, above any flagged one (min weight > 0).
 */
export const QA_SCORE_WEIGHTS = {
  duration: 40,
  silence: 30,
  /** Soft signal: a guard-level take is usable, just hot — keep it cheap. */
  hitGuard: 10,
  rms: 50,
} as const;

type QaCategory = keyof typeof QA_SCORE_WEIGHTS;

export interface LineAudioReport {
  /** true when no check flagged the take */
  pass: boolean;
  /** 0–100, higher is better; used to keep the best of several takes */
  score: number;
  /** Human-readable issue codes with the measured values, e.g. "hit_guard(peak 0.0dB)" */
  issues: string[];
}

// ---------------------------------------------------------------------------
// Text length → expected duration
// ---------------------------------------------------------------------------

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;
const LATIN_WORD_RE = /[A-Za-z0-9]+/g;

/**
 * Effective spoken length of a line in "Chinese char" units: CJK characters
 * (incl. fullwidth punctuation) count 1 each, ASCII words count
 * `latinWordCharEquiv` each, whitespace counts nothing.
 */
export function effectiveCharCount(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++;
  }
  const latinWords = (text.replace(CJK_RE, " ").match(LATIN_WORD_RE) ?? []).length;
  return cjk + latinWords * QA_THRESHOLDS.latinWordCharEquiv;
}

// ---------------------------------------------------------------------------
// ffmpeg probes
// ---------------------------------------------------------------------------

interface SilenceSegment {
  start: number;
  end: number;
}

interface LevelProbe {
  meanDb: number | null;
  maxDb: number | null;
  silences: SilenceSegment[];
}

/**
 * One ffmpeg pass running silencedetect + volumedetect, returning silence
 * segments plus mean/max volume. A trailing silence without silence_end is
 * closed at `durationSec`.
 */
function probeLevels(wavPath: string, durationSec: number): LevelProbe {
  const res = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-nostats",
      "-i", wavPath,
      "-af",
      `silencedetect=n=${QA_THRESHOLDS.silenceNoiseDb}dB:d=${QA_THRESHOLDS.silenceMinDurSec},volumedetect`,
      "-f", "null", "-",
    ],
    { encoding: "utf-8", timeout: 30_000 }
  );
  const out = res.stderr ?? "";

  const meanMatch = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(out);
  const maxMatch = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(out);

  const silences: SilenceSegment[] = [];
  let openStart: number | null = null;
  for (const m of out.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    if (m[1] === "start") {
      openStart = parseFloat(m[2]);
    } else if (openStart !== null) {
      silences.push({ start: openStart, end: parseFloat(m[2]) });
      openStart = null;
    }
  }
  if (openStart !== null) {
    silences.push({ start: openStart, end: durationSec });
  }

  return {
    meanDb: meanMatch ? parseFloat(meanMatch[1]) : null,
    maxDb: maxMatch ? parseFloat(maxMatch[1]) : null,
    silences,
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze one synthesized line. `text` (the exact string handed to the
 * engine) enables the duration-vs-expectation check; omit it to skip that
 * check. Never throws: an unreadable wav comes back as a score-0 failure.
 */
export async function analyzeLineAudio(
  wavPath: string,
  text?: string
): Promise<LineAudioReport> {
  const issues: string[] = [];
  const categories = new Set<QaCategory>();
  const flag = (category: QaCategory, issue: string) => {
    categories.add(category);
    issues.push(issue);
  };

  let durationSec: number;
  try {
    durationSec = getWavDurationSec(wavPath);
  } catch (err) {
    return {
      pass: false,
      score: 0,
      issues: [`probe_error(${err instanceof Error ? err.message : String(err)})`],
    };
  }

  // 1. Duration vs text-length expectation
  if (text !== undefined) {
    const expectedSec = Math.max(
      effectiveCharCount(text) / QA_THRESHOLDS.charsPerSec,
      QA_THRESHOLDS.minExpectedSec
    );
    const ratio = durationSec / expectedSec;
    if (ratio < QA_THRESHOLDS.minDurationRatio) {
      flag("duration", `duration_too_short(${ratio.toFixed(2)}x of expected)`);
    } else if (ratio > QA_THRESHOLDS.maxDurationRatio) {
      flag("duration", `duration_too_long(${ratio.toFixed(2)}x of expected)`);
    }
  }

  // 2–4. Silence, guard peak, RMS from one ffmpeg pass
  const { meanDb, maxDb, silences } = probeLevels(wavPath, durationSec);

  if (maxDb !== null && maxDb >= QA_THRESHOLDS.guardPeakDb) {
    flag("hitGuard", `hit_guard(peak ${maxDb.toFixed(1)}dB)`);
  }
  if (meanDb !== null && meanDb < QA_THRESHOLDS.minMeanVolumeDb) {
    flag("rms", `rms_too_low(mean ${meanDb.toFixed(1)}dB)`);
  }
  const totalSilenceSec = silences.reduce((n, s) => n + (s.end - s.start), 0);
  const silenceRatio = durationSec > 0 ? totalSilenceSec / durationSec : 0;
  if (silenceRatio > QA_THRESHOLDS.maxSilenceRatio) {
    flag("silence", `silence_high(${(silenceRatio * 100).toFixed(0)}% of line)`);
  }
  const longestSilenceSec = silences.reduce((n, s) => Math.max(n, s.end - s.start), 0);
  if (longestSilenceSec > QA_THRESHOLDS.maxSingleSilenceSec) {
    flag("silence", `silence_long(${longestSilenceSec.toFixed(2)}s)`);
  }

  let score = 100;
  for (const category of categories) {
    score -= QA_SCORE_WEIGHTS[category];
  }
  score = Math.max(0, score);

  return { pass: issues.length === 0, score, issues };
}
