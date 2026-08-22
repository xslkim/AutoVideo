/**
 * Per-line loudness alignment in concatenateWavsWithGaps:
 * - lines at different levels converge to the block median RMS
 * - gain is clamped to ±4 dB (a −40 dB line is boosted by 4 dB, not to median)
 * - silent lines are excluded from the median and left silent
 * - total duration and sample rate are unchanged
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  concatenateWavsWithGaps,
  getWavDurationSec,
} from "../../src/tts/audio.js";

const SAMPLE_RATE = 48000;
const LINE_SEC = 0.5;
const GAP_SEC = 0.2;

/** Synthesize a 440 Hz tone at `levelDb` (full-scale sine = 0 dBFS peak). */
function makeToneWav(outPath: string, levelDb: number): void {
  execFileSync(
    "ffmpeg",
    [
      "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${LINE_SEC}`,
      "-af", `volume=${levelDb}dB`,
      "-ar", String(SAMPLE_RATE),
      "-ac", "1",
      "-acodec", "pcm_s16le",
      "-y", outPath,
    ],
    { stdio: "ignore", timeout: 30_000 }
  );
}

function makeSilenceWav(outPath: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-f", "lavfi",
      "-i", "anullsrc=r=48000:cl=mono",
      "-t", String(LINE_SEC),
      "-acodec", "pcm_s16le",
      "-y", outPath,
    ],
    { stdio: "ignore", timeout: 30_000 }
  );
}

/** Offset of the first PCM byte (walk past any metadata chunks). */
function wavDataOffset(buf: Buffer): number {
  let off = 12; // skip RIFF/WAVE
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return off + 8;
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in WAV");
}

/** RMS level (dBFS) of the samples in [startSec, startSec + durationSec). */
function segmentRmsDb(wavPath: string, startSec: number, durationSec: number): number {
  const buf = fs.readFileSync(wavPath);
  const data = wavDataOffset(buf);
  const start = data + Math.round(startSec * SAMPLE_RATE) * 2;
  const count = Math.round(durationSec * SAMPLE_RATE);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const s = buf.readInt16LE(start + i * 2) / 32768;
    sum += s * s;
  }
  return 20 * Math.log10(Math.sqrt(sum / count) || 1e-12);
}

describe("concatenateWavsWithGaps loudness alignment", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-audio-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** levelsDb entries: number = tone level, null = digital silence */
  function makeLines(levelsDb: (number | null)[]): string[] {
    return levelsDb.map((lvl, i) => {
      const p = path.join(dir, `line${i}.wav`);
      if (lvl === null) makeSilenceWav(p);
      else makeToneWav(p, lvl);
      return p;
    });
  }

  it("aligns differing line levels to the median within 3 dB", () => {
    // Within-clamp spread (needs +2 / 0 / −2 dB) so alignment can complete.
    const lines = makeLines([-17, -15, -13]);
    const out = path.join(dir, "out.wav");
    concatenateWavsWithGaps(lines, out, { gapSec: GAP_SEC });

    const step = LINE_SEC + GAP_SEC;
    const rms = lines.map((_, i) => segmentRmsDb(out, i * step, LINE_SEC));
    expect(Math.max(...rms) - Math.min(...rms)).toBeLessThan(3);
  });

  it("clamps per-line gain to ±4 dB instead of pulling quiet lines up to the median", () => {
    const lines = makeLines([-15, -40, -15]);
    const out = path.join(dir, "out.wav");
    concatenateWavsWithGaps(lines, out, { gapSec: GAP_SEC });

    const step = LINE_SEC + GAP_SEC;
    const quietIn = segmentRmsDb(lines[1], 0, LINE_SEC);
    const quietOut = segmentRmsDb(out, step, LINE_SEC);
    // Exactly the +4 dB clamp, not the ~+25 dB needed to reach the median.
    expect(quietOut - quietIn).toBeGreaterThan(3);
    expect(quietOut - quietIn).toBeLessThan(5);

    // ...so the quiet line stays well below its neighbours.
    const normalOut = segmentRmsDb(out, 0, LINE_SEC);
    expect(normalOut - quietOut).toBeGreaterThan(15);
  });

  it("skips silent lines: excluded from the median and left silent", () => {
    const lines = makeLines([-16, null, -14]);
    const out = path.join(dir, "out.wav");
    concatenateWavsWithGaps(lines, out, { gapSec: GAP_SEC });

    const step = LINE_SEC + GAP_SEC;
    expect(segmentRmsDb(out, step, LINE_SEC)).toBeLessThan(-70);

    // The median comes from the two voiced lines only; they still align.
    const first = segmentRmsDb(out, 0, LINE_SEC);
    const third = segmentRmsDb(out, 2 * step, LINE_SEC);
    expect(Math.abs(first - third)).toBeLessThan(3);
  });

  it("keeps total duration and 48 kHz sample rate", () => {
    const lines = makeLines([-16, -20, -12]);
    const out = path.join(dir, "out.wav");
    const expected = 3 * LINE_SEC + 2 * GAP_SEC;

    const total = concatenateWavsWithGaps(lines, out, { gapSec: GAP_SEC });
    expect(total).toBeCloseTo(expected, 1);
    expect(getWavDurationSec(out)).toBeCloseTo(expected, 1);

    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_streams", "-i", out],
        { encoding: "utf-8", timeout: 10_000 }
      )
    );
    expect(probe.streams[0].sample_rate).toBe("48000");
  });
});
