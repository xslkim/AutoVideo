/**
 * tests/tts/qa.test.ts — Synthesis QA gate
 *
 * Samples are synthesized with ffmpeg lavfi (no fixtures, no network):
 *   normal  — sine + tremolo envelope at speech-like level
 *   clipped — sine gained past full scale (hard-clipped on pcm_s16le)
 *   silence — 2.5s mute inside a 4s tone
 *   short   — 0.4s blip for a 9-char line
 *   quiet   — -51 dB mean (near-silent mumbling)
 *
 * Note: ffmpeg's sine source peaks at 1/8 full scale (-18.1 dB), so the
 * volume gains below are relative to that.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  analyzeLineAudio,
  effectiveCharCount,
  QA_THRESHOLDS,
  QA_SCORE_WEIGHTS,
} from "../../src/tts/qa.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-qa-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Synthesize a mono 48kHz s16 WAV from a lavfi source + optional filter chain. */
function lavfi(name: string, source: string, filters?: string): string {
  const out = path.join(tmpDir, name);
  const args = ["-f", "lavfi", "-i", source];
  if (filters) args.push("-af", filters);
  args.push("-ar", "48000", "-ac", "1", "-acodec", "pcm_s16le", "-y", out);
  execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 30_000 });
  return out;
}

// 9 chars at the default 4.5 chars/s → expected duration 2.0s.
const TEXT_2S = "一二三四五六七八九。";

describe("analyzeLineAudio", () => {
  it("accepts a normal speech-level take", async () => {
    const wav = lavfi("normal.wav", "sine=frequency=440:duration=2", "tremolo=f=6:d=0.4,volume=6dB");
    const report = await analyzeLineAudio(wav, TEXT_2S);
    expect(report.pass).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
  });

  it("flags a hard-clipped take (peak above the clip-guard level)", async () => {
    const wav = lavfi("clipped.wav", "sine=frequency=440:duration=2", "volume=20dB");
    const report = await analyzeLineAudio(wav, TEXT_2S);
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.startsWith("hit_guard"))).toBe(true);
    expect(report.score).toBe(100 - QA_SCORE_WEIGHTS.hitGuard);
  });

  it("does NOT flag a take sitting at the clip-guard level (≈ -0.1 dB)", async () => {
    // The servers' clip-guard compresses peaks to 0.99 linear, which
    // volumedetect prints as -0.1 dB. The old -0.1 dB threshold condemned
    // every guard-touched take as "clipping" and white-burned re-rolls;
    // the -0.09 dB threshold clears them. ffmpeg's sine peaks at 1/8 FS,
    // so +18 dB lands just under full scale (0.99 linear).
    const wav = lavfi("guard.wav", "sine=frequency=440:duration=2", "volume=18dB");
    const report = await analyzeLineAudio(wav, TEXT_2S);
    expect(report.pass).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("hit_guard is a soft signal: lowest deduction weight", () => {
    expect(QA_SCORE_WEIGHTS.hitGuard).toBe(10);
    expect(QA_SCORE_WEIGHTS.hitGuard).toBe(
      Math.min(...Object.values(QA_SCORE_WEIGHTS))
    );
  });

  it("flags a long internal silence (ratio and single-segment)", async () => {
    const wav = lavfi(
      "silence.wav",
      "sine=frequency=440:duration=4",
      // Mute t∈[1,3.5]: commas inside the enable expression are escaped for the filtergraph.
      "volume=0:enable=between(t\\,1\\,3.5),volume=6dB"
    );
    const report = await analyzeLineAudio(wav, "一二三四五六七八九。一二三四五六七八九。"); // 4s expected
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.startsWith("silence_high"))).toBe(true);
    expect(report.issues.some((i) => i.startsWith("silence_long"))).toBe(true);
    // Both silence issues share one category deduction.
    expect(report.score).toBe(100 - QA_SCORE_WEIGHTS.silence);
  });

  it("flags a take far too short for its text", async () => {
    const wav = lavfi("short.wav", "sine=frequency=440:duration=0.4", "volume=6dB");
    const report = await analyzeLineAudio(wav, TEXT_2S);
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.startsWith("duration_too_short"))).toBe(true);
    expect(report.score).toBe(100 - QA_SCORE_WEIGHTS.duration);
  });

  it("flags a near-silent (low RMS) take", async () => {
    const wav = lavfi("quiet.wav", "sine=frequency=440:duration=2", "volume=-30dB");
    const report = await analyzeLineAudio(wav, TEXT_2S);
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.startsWith("rms_too_low"))).toBe(true);
  });

  it("skips the duration check when no text is given", async () => {
    const wav = lavfi("notext.wav", "sine=frequency=440:duration=0.4", "volume=6dB");
    const report = await analyzeLineAudio(wav);
    expect(report.pass).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("a flagged take always scores below a passing one", async () => {
    // The QA re-roll loop relies on this to prefer the first passing take.
    const minWeight = Math.min(...Object.values(QA_SCORE_WEIGHTS));
    expect(minWeight).toBeGreaterThan(0);
    const good = await analyzeLineAudio(
      lavfi("cmp-ok.wav", "sine=frequency=440:duration=2", "volume=6dB"),
      TEXT_2S
    );
    const bad = await analyzeLineAudio(
      lavfi("cmp-bad.wav", "sine=frequency=440:duration=2", "volume=20dB"),
      TEXT_2S
    );
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("returns score 0, never throws, on an unreadable wav", async () => {
    const bogus = path.join(tmpDir, "bogus.wav");
    fs.writeFileSync(bogus, "not a wav");
    const report = await analyzeLineAudio(bogus, TEXT_2S);
    expect(report.pass).toBe(false);
    expect(report.score).toBe(0);
    expect(report.issues[0]).toMatch(/^probe_error/);
  });
});

describe("effectiveCharCount", () => {
  it("counts CJK chars and fullwidth punctuation as one each", () => {
    expect(effectiveCharCount("第一行内容，")).toBe(6);
  });

  it("counts ASCII words at the configured equivalence, ignoring whitespace", () => {
    // 使用…渲染 = 4 CJK, GPU = 1 word × latinWordCharEquiv
    expect(effectiveCharCount("使用 GPU 渲染")).toBe(4 + QA_THRESHOLDS.latinWordCharEquiv);
  });
});

describe("QA_THRESHOLDS sanity", () => {
  it("duration ratio brackets 1.0", () => {
    expect(QA_THRESHOLDS.minDurationRatio).toBeLessThan(1);
    expect(QA_THRESHOLDS.maxDurationRatio).toBeGreaterThan(1);
  });

  it("single-silence limit exceeds the silencedetect minimum segment", () => {
    expect(QA_THRESHOLDS.maxSingleSilenceSec).toBeGreaterThan(QA_THRESHOLDS.silenceMinDurSec);
  });

  it("RMS floor sits between aligned speech and digital silence", () => {
    // Aligned narration lives above ≈-40dB; audio.ts treats ≤-80dB as silence.
    expect(QA_THRESHOLDS.minMeanVolumeDb).toBeLessThan(-40);
    expect(QA_THRESHOLDS.minMeanVolumeDb).toBeGreaterThan(-80);
  });
});
