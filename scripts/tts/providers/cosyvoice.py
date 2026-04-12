"""
CosyVoice 2 TTS provider — local GPU, best Chinese-English mixed reading.

Uses inference_zero_shot (voice cloning) since CosyVoice2-0.5B has no built-in
SFT speakers. Requires a short reference WAV (~3-10s) configured in
video-agent-config.json as tts.cosyvoice.promptWav and tts.cosyvoice.promptText.

Service startup (done in Stage 0):
  cd /home/ubuntu/tools/CosyVoice
  source .venv/bin/activate
  python runtime/python/fastapi/server.py \
    --port 50000 \
    --model_dir pretrained_models/CosyVoice2-0.5B

API contract (matches CosyVoice runtime/python/fastapi/server.py):
  POST /inference_zero_shot
  Form data: tts_text=<str>, prompt_text=<str>, prompt_wav=<file>
  Returns: raw PCM int16 bytes @ 22050 Hz (streaming)
"""
import os
import re
import struct
import subprocess
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


COSYVOICE_ENDPOINT   = os.environ.get("COSYVOICE_ENDPOINT", "http://127.0.0.1:50000")
# Default reference audio bundled with CosyVoice
DEFAULT_PROMPT_WAV   = "/home/ubuntu/tools/CosyVoice/asset/zero_shot_prompt.wav"
DEFAULT_PROMPT_TEXT  = "希望你以后能够做的比我还好呦。"
COSYVOICE_SAMPLE_RATE = 22050   # server always returns 22050 Hz PCM


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

    def __init__(self, prompt_wav: Optional[str] = None, prompt_text: Optional[str] = None):
        self._prompt_wav  = prompt_wav  or DEFAULT_PROMPT_WAV
        self._prompt_text = prompt_text or DEFAULT_PROMPT_TEXT

    def is_available(self) -> bool:
        """Check if the CosyVoice FastAPI service is reachable."""
        if not Path(self._prompt_wav).exists():
            return False
        try:
            req = urllib.request.Request(
                f"{COSYVOICE_ENDPOINT}/inference_zero_shot",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status in (200, 422)
        except urllib.error.HTTPError as e:
            return e.code == 422
        except Exception:
            return False

    def synth(self, *, text: str, voice: str, out_wav: Path, out_vtt: Path,
              emphases=None, hints=None) -> TTSResult:
        emphases = emphases or []

        prompt_wav_path = Path(self._prompt_wav)
        if not prompt_wav_path.exists():
            return TTSResult(
                wav_path=str(out_wav), vtt_path=str(out_vtt),
                provider_used="cosyvoice", duration_s=0.0, success=False,
                error=f"Prompt WAV not found: {self._prompt_wav}",
            )

        # Build multipart/form-data with file upload
        boundary = "----AutoVideoBoundary"
        prompt_wav_bytes = prompt_wav_path.read_bytes()
        body = self._build_multipart(
            boundary=boundary,
            fields={
                "tts_text":    text,
                "prompt_text": self._prompt_text,
            },
            files={
                "prompt_wav": ("prompt.wav", prompt_wav_bytes, "audio/wav"),
            },
        )

        req = urllib.request.Request(
            f"{COSYVOICE_ENDPOINT}/inference_zero_shot",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )

        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                pcm_bytes = resp.read()
        except Exception as e:
            return TTSResult(
                wav_path=str(out_wav), vtt_path=str(out_vtt),
                provider_used="cosyvoice", duration_s=0.0, success=False,
                error=str(e),
            )

        if not pcm_bytes:
            return TTSResult(
                wav_path=str(out_wav), vtt_path=str(out_vtt),
                provider_used="cosyvoice", duration_s=0.0, success=False,
                error="CosyVoice returned empty audio",
            )

        _pcm_to_wav(pcm_bytes, COSYVOICE_SAMPLE_RATE, out_wav)
        duration = len(pcm_bytes) / 2 / COSYVOICE_SAMPLE_RATE

        vtt_content = self._generate_approx_vtt(text, duration)
        out_vtt.write_text(vtt_content, encoding="utf-8")

        return TTSResult(
            wav_path=str(out_wav), vtt_path=str(out_vtt),
            provider_used="cosyvoice", duration_s=duration, success=True,
        )

    # ── multipart builder (no external deps) ─────────────────────────────────

    def _build_multipart(self, boundary: str, fields: dict, files: dict) -> bytes:
        parts = []
        sep = f"--{boundary}\r\n".encode()
        for name, value in fields.items():
            parts.append(sep)
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            parts.append(value.encode("utf-8"))
            parts.append(b"\r\n")
        for name, (filename, data, ctype) in files.items():
            parts.append(sep)
            parts.append(
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                f'Content-Type: {ctype}\r\n\r\n'.encode()
            )
            parts.append(data)
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        return b"".join(parts)

    # ── approximate VTT from punctuation splits ───────────────────────────────

    def _generate_approx_vtt(self, text: str, duration_s: float) -> str:
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
