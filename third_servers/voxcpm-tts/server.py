"""
VoxCPM2 FastAPI server — TTS backend

Endpoints:
  GET  /health              → { status: "ok" }
  POST /v1/voices           → { voice_id: string }
  POST /v1/speech           → WAV binary (48kHz), optional style
  POST /v1/speech/styled    → WAV binary with style control / voice design
"""

import io
import logging
import os
import re
import sys
import tempfile
import uuid

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [server] %(message)s")
logger = logging.getLogger("voxcpm-server")

MODEL_DIR = os.environ.get("VOXCPM_MODEL_DIR", "")
if not MODEL_DIR:
    raise RuntimeError(
        "VOXCPM_MODEL_DIR is not set. Export it to point at your VoxCPM2 "
        "weights directory before starting the server."
    )
ENABLE_DENOISER = os.environ.get("VOXCPM_ENABLE_DENOISER", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

logger.info(f"Loading VoxCPM2 model from {MODEL_DIR} (denoiser={ENABLE_DENOISER}) ...")

from voxcpm import VoxCPM  # noqa: E402

model = VoxCPM(
    voxcpm_model_path=MODEL_DIR,
    enable_denoiser=ENABLE_DENOISER,
    optimize=False,
)

# Fix tokenizer: LlamaTokenizerFast.from_pretrained + mask_multichar_chinese_tokens
# produces token IDs WITHOUT the BOS token, while the model was trained WITH BOS.
sys.path.insert(0, MODEL_DIR)
from tokenization_voxcpm2 import VoxCPM2Tokenizer  # noqa: E402

proper_tokenizer = VoxCPM2Tokenizer.from_pretrained(MODEL_DIR)
model.tts_model.text_tokenizer = proper_tokenizer.encode
logger.info("VoxCPM2 model loaded (tokenizer fixed with BOS + CJK split).")

voices: dict[str, str] = {}

app = FastAPI(title="VoxCPM2 TTS Server")


def insert_zh_en_space(text: str) -> str:
    """在中文↔英文/数字边界插入空格，帮助 tokenizer 识别语言切换。

    例：「使用Python编写代码」→「使用 Python 编写代码」
        「GPT4模型」→「GPT4 模型」
    """
    cjk = r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]"
    ascii_char = r"[A-Za-z0-9]"
    text = re.sub(rf"({cjk})({ascii_char})", r"\1 \2", text)
    text = re.sub(rf"({ascii_char})({cjk})", r"\1 \2", text)
    return text


def build_styled_text(text: str, style: str | None) -> str:
    """Wrap dialogue with VoxCPM2 Style Control / Voice Design tag."""
    text = text.strip()
    style = (style or "").strip()
    if not style:
        return text
    if text.startswith("(") and ")" in text:
        return text
    return f"({style}){text}"


def wav_response(audio: np.ndarray) -> Response:
    if audio.dtype != np.int16:
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


def run_generate(
    text: str,
    style: str | None,
    voice_id: str | None,
    cfg_value: float,
    inference_timesteps: int,
    denoise: bool,
    retry_badcase: bool,
    normalize: bool,
) -> np.ndarray:
    text = insert_zh_en_space(text)
    final_text = build_styled_text(text, style)
    ref_path = None
    if voice_id is not None:
        if voice_id not in voices:
            raise HTTPException(status_code=404, detail=f"voice_id {voice_id} not found")
        ref_path = voices[voice_id]

    mode = "styled+clone" if ref_path else ("styled+design" if style else "plain")
    logger.info(
        f"TTS [{mode}]: style={style!r}, voice={voice_id}, text={text!r}, final={final_text!r}"
    )

    try:
        return model.generate(
            text=final_text,
            reference_wav_path=ref_path,
            cfg_value=cfg_value,
            inference_timesteps=inference_timesteps,
            denoise=denoise,
            retry_badcase=retry_badcase,
            normalize=normalize,
        )
    except Exception as e:
        logger.error(f"TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


class VoiceRequest(BaseModel):
    wav_base64: str


class VoiceResponse(BaseModel):
    voice_id: str


class SpeechRequest(BaseModel):
    text: str
    voice_id: str
    style: str | None = Field(
        default=None,
        description="Optional style/voice-effect prompt. Prepended as (style) before text.",
    )
    cfg_value: float = 2.0
    inference_timesteps: int = 10
    denoise: bool = False
    retry_badcase: bool = True
    normalize: bool = Field(
        default=False,
        description="Run wetext text normalization (handles numbers, symbols). "
                    "CJK-ASCII boundary spacing is always applied regardless of this flag.",
    )


class StyledSpeechRequest(BaseModel):
    text: str = Field(description="Dialogue text to synthesize")
    style: str = Field(
        description="Style / voice-effect prompt (emotion, pace, tone, character traits)"
    )
    voice_id: str | None = Field(
        default=None,
        description="Optional reference voice for cloning. Omit for pure Voice Design.",
    )
    cfg_value: float = 2.0
    inference_timesteps: int = 10
    denoise: bool = False
    retry_badcase: bool = True
    normalize: bool = Field(
        default=False,
        description="Run wetext text normalization (handles numbers, symbols). "
                    "CJK-ASCII boundary spacing is always applied regardless of this flag.",
    )


@app.get("/health")
async def health():
    return {"status": "ok", "model": "VoxCPM2", "styled_speech": True}


@app.post("/v1/voices", response_model=VoiceResponse)
async def register_voice(req: VoiceRequest):
    import base64

    voice_id = f"v_{uuid.uuid4().hex[:12]}"
    wav_bytes = base64.b64decode(req.wav_base64)

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(wav_bytes)
    tmp.flush()
    tmp.close()

    voices[voice_id] = tmp.name
    logger.info(f"Registered voice {voice_id} ({len(wav_bytes)} bytes)")

    return VoiceResponse(voice_id=voice_id)


@app.post("/v1/speech")
async def synthesize(req: SpeechRequest):
    audio = run_generate(
        text=req.text,
        style=req.style,
        voice_id=req.voice_id,
        cfg_value=req.cfg_value,
        inference_timesteps=req.inference_timesteps,
        denoise=req.denoise,
        retry_badcase=req.retry_badcase,
        normalize=req.normalize,
    )
    return wav_response(audio)


@app.post("/v1/speech/styled")
async def synthesize_styled(req: StyledSpeechRequest):
    """Synthesize speech with explicit style / voice-effect control.

    - voice_id set  → Style Control (clone timbre + style prompt)
    - voice_id null → Voice Design (style prompt only, no reference audio)
    """
    audio = run_generate(
        text=req.text,
        style=req.style,
        voice_id=req.voice_id,
        cfg_value=req.cfg_value,
        inference_timesteps=req.inference_timesteps,
        denoise=req.denoise,
        retry_badcase=req.retry_badcase,
        normalize=req.normalize,
    )
    return wav_response(audio)


@app.on_event("shutdown")
async def cleanup():
    for path in voices.values():
        try:
            os.unlink(path)
        except OSError:
            pass
