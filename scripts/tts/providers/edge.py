"""
edge-tts provider — always available, used as final fallback.
"""
import asyncio
import subprocess
import sys
import re
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


@dataclass
class TTSResult:
    wav_path: str
    vtt_path: str
    provider_used: str
    duration_s: float
    success: bool
    error: Optional[str] = None


class EdgeTTSProvider:
    name = "edge"

    def is_available(self) -> bool:
        try:
            result = subprocess.run(
                ["edge-tts", "--version"],
                capture_output=True, text=True, timeout=5
            )
            return result.returncode == 0
        except Exception:
            # Try via python -m
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "edge_tts", "--version"],
                    capture_output=True, text=True, timeout=5
                )
                return result.returncode == 0
            except Exception:
                return False

    def synth(self, *, text: str, voice: str, out_wav: Path, out_vtt: Path,
              emphases=None, hints=None) -> TTSResult:
        """
        Synthesize via edge-tts.
        edge-tts outputs MP3 + VTT natively; we convert MP3 → WAV with ffmpeg.
        """
        emphases = emphases or []
        hints = hints or {}

        # edge-tts outputs mp3
        mp3_path = out_wav.with_suffix('.mp3')
        tmp_vtt = out_vtt

        cmd = self._edge_cmd()
        edge_cmd = [
            *cmd,
            "--voice", voice,
            "--text", text,
            "--write-media", str(mp3_path),
            "--write-subtitles", str(tmp_vtt),
        ]

        result = subprocess.run(edge_cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise RuntimeError(f"edge-tts failed: {result.stderr[:300]}")

        # Convert MP3 → WAV (16kHz mono to save space, 24kHz for quality)
        ffmpeg_result = subprocess.run([
            "ffmpeg", "-y", "-i", str(mp3_path),
            "-ar", "24000", "-ac", "1", "-acodec", "pcm_s16le",
            str(out_wav),
        ], capture_output=True, timeout=30)

        if ffmpeg_result.returncode != 0:
            raise RuntimeError(f"ffmpeg conversion failed: {ffmpeg_result.stderr.decode()[:200]}")

        mp3_path.unlink(missing_ok=True)

        duration = self._get_duration(out_wav)
        return TTSResult(
            wav_path=str(out_wav),
            vtt_path=str(tmp_vtt),
            provider_used="edge",
            duration_s=duration,
            success=True,
        )

    def _edge_cmd(self):
        """Return the edge-tts command array."""
        # Try direct command first, then python -m
        result = subprocess.run(["edge-tts", "--version"], capture_output=True, timeout=3)
        if result.returncode == 0:
            return ["edge-tts"]
        return [sys.executable, "-m", "edge_tts"]

    def _get_duration(self, wav_path: Path) -> float:
        try:
            result = subprocess.run([
                "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(wav_path),
            ], capture_output=True, text=True, timeout=10)
            return float(result.stdout.strip())
        except Exception:
            return 0.0
