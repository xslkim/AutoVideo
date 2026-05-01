"""
VoxCPM2 FastAPI server — AutoVideo TTS backend

Endpoints:
  GET  /health       → { status: "ok" }
  POST /v1/voices    → { voice_id: string }
  POST /v1/speech    → WAV binary (48kHz)
"""

import os
import uuid
import tempfile
import io
import sys
import logging
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

# ── Logging ──────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s [server] %(message)s")
logger = logging.getLogger("voxcpm-server")

# ── Load VoxCPM model at startup ────────────────────────────────────────

MODEL_DIR = os.environ.get(
    "VOXCPM_MODEL_DIR",
    os.path.expanduser("~/.cache/voxcpm/VoxCPM2"),
)

logger.info(f"Loading VoxCPM2 model from {MODEL_DIR} ...")

# Add venv site-packages to path if available
venv_path = os.path.expanduser("~/video-agent-venv/lib/python3.12/site-packages")
if os.path.isdir(venv_path):
    sys.path.insert(0, venv_path)

from voxcpm import VoxCPM  # noqa: E402

model = VoxCPM(
    voxcpm_model_path=MODEL_DIR,
    enable_denoiser=True,
    optimize=False,  # faster startup, slightly slower inference
)
logger.info("VoxCPM2 model loaded.")

# ── Voice store ─────────────────────────────────────────────────────────

voices: dict[str, str] = {}  # voice_id → temp WAV path


# ── FastAPI app ──────────────────────────────────────────────────────────

app = FastAPI(title="AutoVideo VoxCPM2 TTS Server")


class VoiceRequest(BaseModel):
    wav_base64: str


class VoiceResponse(BaseModel):
    voice_id: str


class SpeechRequest(BaseModel):
    text: str
    voice_id: str
    cfg_value: float = 2.0
    inference_timesteps: int = 10
    denoise: bool = False
    retry_badcase: bool = True


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/v1/voices", response_model=VoiceResponse)
async def register_voice(req: VoiceRequest):
    import base64

    voice_id = f"v_{uuid.uuid4().hex[:12]}"
    wav_bytes = base64.b64decode(req.wav_base64)

    # Write to temp file (VoxCPM needs a file path)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(wav_bytes)
    tmp.flush()
    tmp.close()

    voices[voice_id] = tmp.name
    logger.info(f"Registered voice {voice_id} ({len(wav_bytes)} bytes)")

    return VoiceResponse(voice_id=voice_id)


@app.post("/v1/speech")
async def synthesize(req: SpeechRequest):
    if req.voice_id not in voices:
        raise HTTPException(status_code=404, detail=f"voice_id {req.voice_id} not found")

    ref_path = voices[req.voice_id]

    logger.info(f"TTS: text={req.text!r}, voice={req.voice_id}, cfg={req.cfg_value}")

    try:
        audio: np.ndarray = model.generate(
            text=req.text,
            reference_wav_path=ref_path,
            cfg_value=req.cfg_value,
            inference_timesteps=req.inference_timesteps,
            denoise=req.denoise,
            retry_badcase=req.retry_badcase,
        )
    except Exception as e:
        logger.error(f"TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Convert to WAV bytes (48kHz, float32 → int16)
    if audio.dtype != np.int16:
        # Normalize float audio to int16
        if audio.dtype in (np.float32, np.float64):
            peak = np.max(np.abs(audio))
            if peak > 0:
                audio = (audio / peak * 32767).astype(np.int16)
            else:
                audio = audio.astype(np.int16)

    buf = io.BytesIO()
    sf.write(buf, audio, 48000, subtype="PCM_16", format="WAV")
    wav_bytes = buf.getvalue()

    logger.info(f"TTS done: {len(wav_bytes)} bytes, {len(audio) / 48000:.2f}s")

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Length": str(len(wav_bytes))},
    )


@app.on_event("shutdown")
async def cleanup():
    for path in voices.values():
        try:
            os.unlink(path)
        except OSError:
            pass
