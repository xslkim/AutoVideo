#!/usr/bin/env python3
"""
AutoVideo — TTS Router (VoxCPM only)

Each narration line is synthesized separately. 200 ms silence is inserted between
lines, then all segments are concatenated into one WAV per block.

Voice persistence:
  - On first synthesis in a project (no voice-ref.wav), VoxCPM is called with no
    reference audio, producing a random voice. The resulting audio is saved as
    {project_dir}/voice-ref.wav and the spoken text as {project_dir}/voice-ref-text.txt.
  - All subsequent calls (same or later blocks) use voice-ref.wav for voice cloning.

Usage:
  python3 router.py <blocks.json> <block-id> <out-dir> [--config video-agent-config.json]
"""

import sys
import os
import json
import shutil
import struct
import subprocess
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

_scripts_dir = Path(__file__).parent.parent
sys.path.insert(0, str(_scripts_dir))
sys.path.insert(0, str(Path(__file__).parent))

_cache_available = False
try:
    from cache_utils import AudioCache
    _cache_available = True
except Exception:
    pass

SILENCE_MS = 200

# ─── Result ───────────────────────────────────────────────────────────────────

@dataclass
class TTSResult:
    wav_path: str
    vtt_path: str
    provider_used: str
    duration_s: float
    success: bool
    error: Optional[str] = None

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ms_to_vtt(ms: int) -> str:
    h = ms // 3600000
    m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000
    r = ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d}.{r:03d}"


def _detect_sample_rate(wav_path: Path) -> int:
    try:
        with open(wav_path, "rb") as f:
            f.seek(24)
            return struct.unpack('<I', f.read(4))[0]
    except Exception:
        return 48000


def _create_silence_wav(out_path: Path, duration_ms: int, sample_rate: int):
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r={sample_rate}:cl=mono",
        "-t", str(duration_ms / 1000),
        "-acodec", "pcm_s16le",
        str(out_path),
    ], check=True, capture_output=True)


def _concat_wavs(wav_paths: list, out_path: Path):
    list_file = out_path.parent / f"_concat_{out_path.stem}.txt"
    try:
        with open(list_file, "w") as f:
            for p in wav_paths:
                f.write(f"file '{p}'\n")
        subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(out_path),
        ], check=True, capture_output=True)
    finally:
        list_file.unlink(missing_ok=True)


def _build_vtt(lines: list, durations_s: list, silence_ms: int) -> str:
    entries = ["WEBVTT", ""]
    cursor_ms = 0
    for line, dur_s in zip(lines, durations_s):
        end_ms = cursor_ms + int(dur_s * 1000)
        entries.append(f"{_ms_to_vtt(cursor_ms)} --> {_ms_to_vtt(end_ms)}")
        entries.append(line)
        entries.append("")
        cursor_ms = end_ms + silence_ms
    return "\n".join(entries)


def _create_empty_wav(path: Path, duration_s: float):
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "anullsrc=r=24000:cl=mono",
        "-t", str(duration_s),
        "-acodec", "pcm_s16le",
        str(path),
    ], check=True, capture_output=True)

# ─── Voice reference ──────────────────────────────────────────────────────────

def _voice_ref_paths(project_dir: Path):
    return project_dir / "voice-ref.wav", project_dir / "voice-ref-text.txt"

# ─── Main synthesis ───────────────────────────────────────────────────────────

def synth_block(block: dict, config: dict, out_dir: Path, voice: str) -> TTSResult:
    from providers.voxcpm import VoxCPMProvider

    block_id   = block["id"]
    narration  = block.get("narration", {})
    text       = narration.get("text", "").strip()

    if not text:
        silence_path = out_dir / f"{block_id}.wav"
        vtt_path     = out_dir / f"{block_id}.vtt"
        out_dir.mkdir(parents=True, exist_ok=True)
        _create_empty_wav(silence_path, 0.5)
        vtt_path.write_text("WEBVTT\n\n")
        return TTSResult(wav_path=str(silence_path), vtt_path=str(vtt_path),
                         provider_used="none", duration_s=0.0, success=True)

    lines = [l for l in text.split('\n') if l.strip()]
    if not lines:
        lines = [text]

    project_dir = Path(config.get("projectDir", "."))
    tts_config  = config.get("tts", {})
    vx_cfg      = tts_config.get("voxcpm", {})
    endpoint    = vx_cfg.get("endpoint")

    voice_ref_wav, voice_ref_txt = _voice_ref_paths(project_dir)
    has_ref = voice_ref_wav.exists()

    final_wav = out_dir / f"{block_id}.wav"
    final_vtt = out_dir / f"{block_id}.vtt"

    # ── Cache lookup ──────────────────────────────────────────────────────────
    _audio_cache = None
    _audio_hash  = None
    if _cache_available:
        try:
            _audio_cache = AudioCache()
            _audio_hash  = _audio_cache.compute_hash(text, "voxcpm", "voxcpm")
            hit = _audio_cache.lookup(_audio_hash)
            if hit:
                out_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(hit["wav"], final_wav)
                shutil.copy2(hit["vtt"], final_vtt)
                if hit.get("meta"):
                    meta_src = Path(hit["meta"])
                    if meta_src.exists():
                        shutil.copy2(meta_src, out_dir / f"{block_id}.meta.json")
                duration_s = 0.0
                try:
                    mp = out_dir / f"{block_id}.meta.json"
                    if mp.exists():
                        duration_s = json.loads(mp.read_text()).get("duration_s", 0.0)
                except Exception:
                    pass
                print(f"[TTS] {block_id}: cache hit ({_audio_hash[:8]}…) → {final_wav}")
                return TTSResult(wav_path=str(final_wav), vtt_path=str(final_vtt),
                                 provider_used="cache(voxcpm)", duration_s=duration_s, success=True)
        except Exception as e:
            print(f"[TTS] {block_id}: cache lookup failed (non-fatal): {e}", file=sys.stderr)
    # ── End cache lookup ──────────────────────────────────────────────────────

    out_dir.mkdir(parents=True, exist_ok=True)

    provider = VoxCPMProvider(
        endpoint=endpoint,
        reference_wav=str(voice_ref_wav) if has_ref else None,
        prompt_text=voice_ref_txt.read_text(encoding="utf-8").strip() if (has_ref and voice_ref_txt.exists()) else "",
    )

    if not provider.is_available():
        return TTSResult(wav_path=str(final_wav), vtt_path=str(final_vtt),
                         provider_used="voxcpm", duration_s=0.0, success=False,
                         error="VoxCPM server not available")

    tmp_dir = out_dir / f"_tmp_{block_id}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        line_wavs      = []
        line_durations = []

        for i, line in enumerate(lines):
            line_wav = tmp_dir / f"line{i:03d}.wav"
            line_vtt = tmp_dir / f"line{i:03d}.vtt"

            # First line ever (no voice-ref.wav): synthesize without reference
            if not has_ref and i == 0:
                ref_wav_arg  = None
                prompt_arg   = None
            else:
                ref_wav_arg  = str(voice_ref_wav) if has_ref else None
                prompt_arg   = voice_ref_txt.read_text(encoding="utf-8").strip() if (has_ref and voice_ref_txt.exists()) else None

            print(f"[TTS] {block_id} line {i}: {line[:50]}", flush=True)
            result = provider.synth(
                text=line,
                voice="voxcpm",
                out_wav=line_wav,
                out_vtt=line_vtt,
                reference_wav=ref_wav_arg,
                prompt_text=prompt_arg,
            )

            if not result.success:
                return TTSResult(wav_path=str(final_wav), vtt_path=str(final_vtt),
                                 provider_used="voxcpm", duration_s=0.0, success=False,
                                 error=f"line {i}: {result.error}")

            # Save first-ever output as voice reference
            if not has_ref and i == 0:
                shutil.copy2(line_wav, voice_ref_wav)
                voice_ref_txt.write_text(line, encoding="utf-8")
                has_ref = True
                print(f"[TTS] Voice reference saved → {voice_ref_wav}")

            line_wavs.append(line_wav)
            line_durations.append(result.duration_s)

        # Build interleaved list: line0 [silence line1] [silence line2] ...
        sample_rate    = _detect_sample_rate(line_wavs[0])
        wavs_to_concat = []
        if len(line_wavs) > 1:
            silence_wav = tmp_dir / "silence.wav"
            _create_silence_wav(silence_wav, SILENCE_MS, sample_rate)
            for idx, lw in enumerate(line_wavs):
                wavs_to_concat.append(lw)
                if idx < len(line_wavs) - 1:
                    wavs_to_concat.append(silence_wav)
        else:
            wavs_to_concat = line_wavs

        if len(wavs_to_concat) == 1:
            shutil.copy2(wavs_to_concat[0], final_wav)
        else:
            _concat_wavs(wavs_to_concat, final_wav)

        vtt_content    = _build_vtt(lines, line_durations, SILENCE_MS)
        final_vtt.write_text(vtt_content, encoding="utf-8")

        total_duration = sum(line_durations) + (len(lines) - 1) * SILENCE_MS / 1000
        print(f"[TTS] {block_id}: OK ({total_duration:.1f}s, {len(lines)} lines)")

        # ── Cache store ───────────────────────────────────────────────────────
        if _cache_available and _audio_cache and _audio_hash:
            try:
                meta_file = out_dir / f"{block_id}.meta.json"
                _audio_cache.store(
                    hash_val=_audio_hash, wav_path=str(final_wav), vtt_path=str(final_vtt),
                    meta_path=str(meta_file) if meta_file.exists() else None,
                    title=block.get("title", block_id), project=str(project_dir), provider="voxcpm",
                )
            except Exception as e:
                print(f"[TTS] {block_id}: cache store failed (non-fatal): {e}", file=sys.stderr)

        return TTSResult(wav_path=str(final_wav), vtt_path=str(final_vtt),
                         provider_used="voxcpm", duration_s=total_duration, success=True)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AutoVideo TTS Router (VoxCPM)")
    parser.add_argument("blocks_json")
    parser.add_argument("block_id")
    parser.add_argument("out_dir")
    parser.add_argument("--config", default="video-agent-config.json")
    args = parser.parse_args()

    blocks_data = json.loads(Path(args.blocks_json).read_text())
    block = next((b for b in blocks_data["blocks"] if b["id"] == args.block_id), None)
    if not block:
        print(f"ERROR: Block {args.block_id} not found in {args.blocks_json}", file=sys.stderr)
        sys.exit(1)

    config = {}
    config_path = Path(args.config)
    if config_path.exists():
        config = json.loads(config_path.read_text())

    voice   = config.get("voice", "zh-CN-YunxiNeural")
    out_dir = Path(args.out_dir)

    result = synth_block(block, config, out_dir, voice)

    meta_path = out_dir / f"{args.block_id}.meta.json"
    meta_path.write_text(json.dumps(asdict(result), indent=2))

    if not result.success:
        print(f"ERROR: TTS failed for {args.block_id}: {result.error}", file=sys.stderr)
        sys.exit(1)

    print(f"OK: {args.block_id} → {result.wav_path} ({result.duration_s:.2f}s)")

if __name__ == "__main__":
    main()
