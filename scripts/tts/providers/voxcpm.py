"""
VoxCPM TTS provider — high-quality multilingual TTS via local GPU server.

VoxCPM2 supports 30 languages with voice design and voice cloning modes.
Requires the VoxCPM FastAPI server running (scripts/tts/voxcpm_server.py).

Server startup (done in Stage 0):
  python scripts/tts/voxcpm_server.py --port 50001 [--model openbmb/VoxCPM2]

API contract:
  POST /synthesize
  Form data: text, reference_wav (file), prompt_text, voice_design, cfg_value, inference_steps
  Returns: raw PCM int16 bytes @ 48kHz mono
"""
import os
import re
import struct
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


VOXCPM_ENDPOINT = os.environ.get("VOXCPM_ENDPOINT", "http://127.0.0.1:50001")
VOXCPM_SAMPLE_RATE = 48000  # VoxCPM2 outputs at 48kHz


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


class VoxCPMProvider:
    name = "voxcpm"

    def __init__(
        self,
        *,
        endpoint: Optional[str] = None,
        voice_design: Optional[str] = None,
        reference_wav: Optional[str] = None,
        prompt_text: Optional[str] = None,
    ):
        self._endpoint = endpoint or VOXCPM_ENDPOINT
        self._voice_design = voice_design or ""
        self._reference_wav = reference_wav or ""
        self._prompt_text = prompt_text or ""

    def is_available(self) -> bool:
        """Check if the VoxCPM server is reachable and healthy."""
        try:
            req = urllib.request.Request(
                f"{self._endpoint}/health",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def synth(self, *, text: str, voice: str, out_wav: Path, out_vtt: Path,
              emphases=None, hints=None,
              reference_wav: Optional[str] = None,
              prompt_text: Optional[str] = None) -> TTSResult:
        emphases = emphases or []
        hints = hints or {}

        # Per-call overrides take precedence over constructor values
        effective_ref_wav  = reference_wav  if reference_wav  is not None else self._reference_wav
        effective_prompt   = prompt_text    if prompt_text    is not None else self._prompt_text

        # Build multipart request
        boundary = "----AutoVideoVoxCPM"
        fields = {
            "text": text,
            "cfg_value": "2.0",
            "inference_steps": "10",
        }

        if self._voice_design:
            fields["voice_design"] = self._voice_design

        if effective_prompt:
            fields["prompt_text"] = effective_prompt

        # Build body
        files = {}
        if effective_ref_wav:
            ref_wav_path = Path(effective_ref_wav)
            if ref_wav_path.exists():
                ref_bytes = ref_wav_path.read_bytes()
                files["reference_wav"] = ("reference.wav", ref_bytes, "audio/wav")

        body = self._build_multipart(boundary=boundary, fields=fields, files=files)

        req = urllib.request.Request(
            f"{self._endpoint}/synthesize",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )

        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                pcm_bytes = resp.read()
                sample_rate = int(resp.headers.get("X-Sample-Rate", VOXCPM_SAMPLE_RATE))
                duration_ms = int(resp.headers.get("X-Duration-Ms", "0"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
            return TTSResult(
                wav_path=str(out_wav), vtt_path=str(out_vtt),
                provider_used="voxcpm", duration_s=0.0, success=False,
                error=f"VoxCPM server error {e.code}: {err_body}",
            )
        except Exception as e:
            return TTSResult(
                wav_path=str(out_wav), vtt_path=str(out_vtt),
                provider_used="voxcpm", duration_s=0.0, success=False,
                error=str(e),
            )

        if not pcm_bytes:
            return TTSResult(
                wav_path=str(out_wav), vtt_path=str(out_vtt),
                provider_used="voxcpm", duration_s=0.0, success=False,
                error="VoxCPM returned empty audio",
            )

        _pcm_to_wav(pcm_bytes, sample_rate, out_wav)
        duration = duration_ms / 1000.0 if duration_ms else len(pcm_bytes) / 2 / sample_rate

        vtt_content = self._generate_approx_vtt(text, duration)
        out_vtt.write_text(vtt_content, encoding="utf-8")

        elapsed = time.time() - t0
        print(f"[VoxCPM] synthesis took {elapsed:.1f}s, audio {duration:.1f}s")

        return TTSResult(
            wav_path=str(out_wav), vtt_path=str(out_vtt),
            provider_used="voxcpm", duration_s=duration, success=True,
        )

    # ── multipart builder (no external deps) ─────────────────────────────────

    def _build_multipart(self, boundary: str, fields: dict, files: dict) -> bytes:
        parts = []
        sep = f"--{boundary}\r\n".encode()
        for name, value in fields.items():
            parts.append(sep)
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            parts.append(str(value).encode("utf-8"))
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
        h = ms // 3600000
        m = (ms % 3600000) // 60000
        s = (ms % 60000) // 1000
        r = ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d}.{r:03d}"
