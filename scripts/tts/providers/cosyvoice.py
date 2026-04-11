"""
CosyVoice 2 TTS provider — local GPU, best Chinese-English mixed reading.

Expects a running CosyVoice FastAPI service at COSYVOICE_ENDPOINT
(default: http://127.0.0.1:50000).

Service startup (run once, stays alive):
  cd /path/to/CosyVoice
  python3 api_server.py --port 50000

API contract:
  POST /tts/sft
  Body: { "text": str, "speaker": str }
  Returns: audio/wav stream

  POST /tts/zero_shot (optional, for voice cloning)
  Body: { "text": str, "prompt_text": str, "prompt_wav_url": str }
  Returns: audio/wav stream
"""
import os
import subprocess
import json
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


COSYVOICE_ENDPOINT = os.environ.get("COSYVOICE_ENDPOINT", "http://127.0.0.1:50000")
COSYVOICE_SPEAKER  = os.environ.get("COSYVOICE_SPEAKER", "中文男")  # default preset male voice


@dataclass
class TTSResult:
    wav_path: str
    vtt_path: str
    provider_used: str
    duration_s: float
    success: bool
    error: Optional[str] = None


class CosyVoiceProvider:
    name = "cosyvoice"

    def is_available(self) -> bool:
        try:
            req = urllib.request.Request(
                f"{COSYVOICE_ENDPOINT}/health",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except Exception:
            return False

    def synth(self, *, text: str, voice: str, out_wav: Path, out_vtt: Path,
              emphases=None, hints=None) -> TTSResult:
        emphases = emphases or []
        hints    = hints or {}

        speaker = voice if voice and voice != "zh-CN-YunxiNeural" else COSYVOICE_SPEAKER

        # Try SFT (supervised fine-tuned with preset voices) first
        body = json.dumps({"text": text, "speaker": speaker}).encode("utf-8")

        req = urllib.request.Request(
            f"{COSYVOICE_ENDPOINT}/tts/sft",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status != 200:
                raise RuntimeError(f"CosyVoice API error: {resp.status}")
            wav_bytes = resp.read()

        out_wav.write_bytes(wav_bytes)

        # CosyVoice doesn't provide word-level timestamps natively.
        # Generate an approximate VTT using character-proportional timing.
        duration = self._get_duration(out_wav)
        vtt_content = self._generate_approx_vtt(text, duration)
        out_vtt.write_text(vtt_content, encoding="utf-8")

        return TTSResult(
            wav_path=str(out_wav),
            vtt_path=str(out_vtt),
            provider_used="cosyvoice",
            duration_s=duration,
            success=True,
        )

    def _generate_approx_vtt(self, text: str, duration_s: float) -> str:
        """
        Generate approximate word-level VTT by splitting text into segments
        and distributing time proportionally by character count.

        For better accuracy, pipe through WhisperX forced alignment after synthesis.
        """
        # Split at punctuation boundaries
        import re
        segments = re.split(r'([，。！？、；,.!?;])', text)
        chunks = []
        current = ""
        for seg in segments:
            current += seg
            if re.search(r'[，。！？、；,.!?;]', seg):
                if current.strip():
                    chunks.append(current.strip())
                current = ""
        if current.strip():
            chunks.append(current.strip())

        if not chunks:
            chunks = [text]

        total_chars = sum(len(c) for c in chunks) or 1
        lines = ["WEBVTT", ""]
        current_ms = 0

        for chunk in chunks:
            char_ratio = len(chunk) / total_chars
            end_ms = current_ms + int(char_ratio * duration_s * 1000)
            lines.append(f"{self._ms_to_vtt(current_ms)} --> {self._ms_to_vtt(end_ms)}")
            lines.append(chunk)
            lines.append("")
            current_ms = end_ms

        return "\n".join(lines)

    def _ms_to_vtt(self, ms: int) -> str:
        h  = ms // 3600000
        m  = (ms % 3600000) // 60000
        s  = (ms % 60000) // 1000
        r  = ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d}.{r:03d}"

    def _get_duration(self, wav_path: Path) -> float:
        try:
            result = subprocess.run([
                "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(wav_path),
            ], capture_output=True, text=True, timeout=10)
            return float(result.stdout.strip())
        except Exception:
            return 0.0
