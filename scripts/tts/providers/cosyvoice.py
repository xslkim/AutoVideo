"""
CosyVoice 2 TTS provider — local GPU, best Chinese-English mixed reading.

Expects a running CosyVoice FastAPI service at COSYVOICE_ENDPOINT
(default: http://127.0.0.1:50000).

Service startup:
  cd /home/ubuntu/tools/CosyVoice
  source .venv/bin/activate
  python runtime/python/fastapi/server.py \
    --port 50000 \
    --model_dir pretrained_models/CosyVoice2-0.5B

API contract (matches CosyVoice runtime/python/fastapi/server.py):
  POST /inference_sft
  Form data: tts_text=<str>, spk_id=<str>
  Returns: raw PCM int16 bytes @ 22050 Hz (streaming)
"""
import os
import struct
import subprocess
import tempfile
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


COSYVOICE_ENDPOINT = os.environ.get("COSYVOICE_ENDPOINT", "http://127.0.0.1:50000")
COSYVOICE_SPEAKER  = os.environ.get("COSYVOICE_SPEAKER", "中文男")
COSYVOICE_SAMPLE_RATE = 22050   # server always returns 22050 Hz


@dataclass
class TTSResult:
    wav_path: str
    vtt_path: str
    provider_used: str
    duration_s: float
    success: bool
    error: Optional[str] = None


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int, out_path: Path) -> None:
    """Wrap raw int16 PCM bytes in a minimal RIFF/WAV header."""
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_bytes)
    chunk_size = 36 + data_size

    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', chunk_size, b'WAVE',
        b'fmt ', 16,
        1,              # PCM
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b'data', data_size,
    )
    out_path.write_bytes(header + pcm_bytes)


class CosyVoiceProvider:
    name = "cosyvoice"

    def is_available(self) -> bool:
        """Check if the CosyVoice FastAPI service is reachable."""
        try:
            # Try the inference_sft endpoint with a lightweight GET (no body needed)
            req = urllib.request.Request(
                f"{COSYVOICE_ENDPOINT}/inference_sft",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                # 422 Unprocessable Entity means server is up but needs form data
                return resp.status in (200, 422)
        except urllib.error.HTTPError as e:
            return e.code == 422   # server is running, just rejected empty request
        except Exception:
            return False

    def synth(self, *, text: str, voice: str, out_wav: Path, out_vtt: Path,
              emphases=None, hints=None) -> TTSResult:
        emphases = emphases or []

        # Pick speaker: use voice param if it looks like a CosyVoice speaker name,
        # otherwise fall back to env/default
        cosyvoice_voices = {"中文男", "中文女", "英文男", "英文女", "粤语女", "粤语男",
                            "日语男", "韩语女"}
        if voice and voice in cosyvoice_voices:
            speaker = voice
        else:
            speaker = COSYVOICE_SPEAKER

        # Build multipart/form-data body manually (avoid external deps)
        form_data = urllib.parse.urlencode({
            "tts_text": text,
            "spk_id": speaker,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{COSYVOICE_ENDPOINT}/inference_sft",
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )

        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                pcm_bytes = resp.read()
        except Exception as e:
            return TTSResult(
                wav_path=str(out_wav),
                vtt_path=str(out_vtt),
                provider_used="cosyvoice",
                duration_s=0.0,
                success=False,
                error=str(e),
            )

        if not pcm_bytes:
            return TTSResult(
                wav_path=str(out_wav),
                vtt_path=str(out_vtt),
                provider_used="cosyvoice",
                duration_s=0.0,
                success=False,
                error="CosyVoice returned empty audio",
            )

        # Wrap PCM → WAV
        _pcm_to_wav(pcm_bytes, COSYVOICE_SAMPLE_RATE, out_wav)

        duration = len(pcm_bytes) / 2 / COSYVOICE_SAMPLE_RATE   # int16 = 2 bytes/sample
        elapsed = time.time() - t0

        # Generate approximate VTT using character-proportional timing
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
        """Generate approximate VTT by splitting text at punctuation boundaries."""
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
