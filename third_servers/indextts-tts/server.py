"""
IndexTTS-2.5 FastAPI server — TTS backend (voice cloning + emotion control)

Endpoints (deliberately mirrors ../cosyvoice-tts/server.py so the AutoVideo
client code stays engine-agnostic):
  GET  /health              → { status: "ok" } (503 while the model is loading / failed)
  POST /v1/voices           → { voice_id: string }  (md5 fingerprint of the wav; idempotent)
  POST /v1/speech           → WAV binary (48kHz), cloned from the registered voice

Differences from the CosyVoice server:
  - voice registration needs NO reference transcript (IndexTTS derives the
    speaker embedding from audio alone), so /v1/voices accepts only wav_base64
    (prompt_text is accepted but ignored, for client symmetry)
  - /v1/speech takes `emotion` — a natural-language emotion description
    ("平静耐心地讲解", "excited and fast") mapped to IndexTTS-2.5's emo_text
    pathway — and `duration_factor`, a speaking-rate multiplier (>1 = faster)

NOTE: this is a scaffolding wrapper. The exact IndexTTS-2.5 Python entrypoint
(import path / infer() kwargs) must be confirmed against the installed release
— see _load_model() and _infer() and adjust the marked spots if they differ.
"""

import base64
import hashlib
import io
import logging
import os
import random
import tempfile
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [server] %(message)s")
logger = logging.getLogger("indextts-server")

SCRIPT_DIR = Path(__file__).resolve().parent

MODEL_DIR = os.environ.get("INDEXTTS_MODEL_DIR", "")
if not MODEL_DIR:
    raise RuntimeError(
        "INDEXTTS_MODEL_DIR is not set. Export it to point at your "
        "IndexTTS-2.5 weights directory before starting the server."
    )
REPO_DIR = Path(os.environ.get("INDEXTTS_REPO_DIR", SCRIPT_DIR / "index-tts"))
VOICE_DIR = Path(os.environ.get("INDEXTTS_VOICE_DIR", SCRIPT_DIR / "voices"))
# IndexTTS-2.5 reads its checkpoint config from inside the model dir.
MODEL_CONFIG = os.environ.get("INDEXTTS_MODEL_CONFIG", "")  # default: <MODEL_DIR>/config.yaml
DEVICE = os.environ.get("INDEXTTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
# FP16 halves VRAM; disable when the GPU/driver combination misbehaves.
USE_FP16 = os.environ.get("INDEXTTS_FP16", "1") != "0"
OUTPUT_SAMPLE_RATE = 48000

VOICE_DIR.mkdir(parents=True, exist_ok=True)

# Model loads in a background thread so /health can report 503 while loading
# instead of the port simply being unreachable (uvicorn imports this module
# before serving; a synchronous load would leave health checks unanswered).
model = None
model_error: str | None = None


def _load_model() -> None:
    global model, model_error
    try:
        logger.info(f"Loading IndexTTS-2.5 model from {MODEL_DIR} (device={DEVICE}) ...")
        # ADJUST IF NEEDED: upstream entrypoint for IndexTTS2 is
        # `from indextts.infer_v2 import IndexTTS2`; a 2.5 release may rename
        # it. install.sh adds REPO_DIR to PYTHONPATH via the venv install.
        try:
            from indextts.infer_v2 import IndexTTS2 as Engine
        except ImportError:
            from indextts.infer import IndexTTS2 as Engine  # type: ignore

        model = Engine(
            cfg_path=MODEL_CONFIG or str(Path(MODEL_DIR) / "config.yaml"),
            model_dir=MODEL_DIR,
            use_fp16=USE_FP16,
            use_cuda_kernel=False,
        )
        logger.info("IndexTTS-2.5 model loaded.")
    except Exception as e:
        model_error = str(e)
        logger.error(f"Model load failed: {e}")


threading.Thread(target=_load_model, daemon=True).start()


# Keep synthesis reproducible: same (voice, salt, emotion, rate, text) must
# yield the same audio so the client-side audio cache is coherent across
# server restarts (voice_id IS the wav md5 fingerprint).
def _seed_from(*parts: str) -> int:
    h = hashlib.md5("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(h[:8], "little") % (2**31 - 1)


def _set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# Generation is GPU-bound and stateful (RNG + model); serialize requests.
_gen_lock = threading.Lock()

app = FastAPI(title="IndexTTS-2.5 TTS Server")


def _voice_path(voice_id: str) -> Path:
    return VOICE_DIR / f"{voice_id}.wav"


def wav_response(pcm: np.ndarray, sample_rate: int) -> Response:
    """PCM float array → 48kHz PCM16 WAV. Clip-guard ONLY: compress when the
    peak exceeds 0.99, never normalize quieter takes up to full scale."""
    if pcm.size == 0:
        raise HTTPException(status_code=500, detail="model returned empty audio")
    peak = float(np.max(np.abs(pcm)))
    if peak > 0.99:
        pcm = pcm / peak * 0.99
    pcm16 = (np.clip(pcm, -1.0, 1.0) * 32767).astype(np.int16)

    buf = io.BytesIO()
    sf.write(buf, pcm16, OUTPUT_SAMPLE_RATE, subtype="PCM_16", format="WAV")
    wav_bytes = buf.getvalue()
    logger.info(f"TTS done: {len(wav_bytes)} bytes, {len(pcm16) / OUTPUT_SAMPLE_RATE:.2f}s")
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Length": str(len(wav_bytes))},
    )


def _apply_duration_factor(pcm: np.ndarray, sr: int, factor: float) -> np.ndarray:
    """Best-effort tempo change via the sox `tempo` effect (pitch-preserving).

    IndexTTS-2.5 has no direct speaking-rate knob on the infer() path this
    wrapper targets; if sox support is missing we log and return the audio
    untouched rather than pitching the voice up/down with a naive resample.
    """
    if factor == 1.0:
        return pcm
    try:
        effects = [["tempo", str(factor)]]
        t = torch.from_numpy(pcm.astype(np.float32)).unsqueeze(0)
        stretched, out_sr = torchaudio.sox_effects.apply_effects_tensor(t, sr, effects)
        if out_sr != sr:
            stretched = torchaudio.functional.resample(stretched, out_sr, sr)
        return stretched.squeeze(0).numpy()
    except Exception as e:
        logger.warning(f"duration_factor={factor} unavailable (sox tempo failed: {e}); "
                       "returning unstretched audio")
        return pcm


def _infer(text: str, ref_wav: Path, emotion: str, duration_factor: float) -> tuple[np.ndarray, int]:
    """Run one synthesis and return float32 PCM at the model sample rate.

    ADJUST IF NEEDED: IndexTTS2.infer() writes to output_path and returns its
    sample rate; emotion text control is (use_emo_text=True, emo_text=...).
    If the installed 2.5 release exposes a native duration control kwarg,
    prefer it over the post-hoc tempo stretch in _apply_duration_factor.
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        kwargs: dict = {
            "spk_audio_prompt": str(ref_wav),
            "text": text,
            "output_path": out_path,
            "use_random": False,
        }
        if emotion:
            kwargs["use_emo_text"] = True
            kwargs["emo_text"] = emotion
        model.infer(**kwargs)
        data, sr = sf.read(out_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        return data, sr
    finally:
        Path(out_path).unlink(missing_ok=True)


def run_generate(
    text: str,
    voice_id: str,
    seed_salt: str,
    emotion: str = "",
    duration_factor: float = 1.0,
) -> Response:
    if model is None:
        detail = (
            f"model failed to load: {model_error}" if model_error else "model is still loading"
        )
        raise HTTPException(status_code=503, detail=detail)

    wav_path = _voice_path(voice_id)
    if not wav_path.exists():
        raise HTTPException(status_code=404, detail=f"voice_id {voice_id} not found")

    seed = _seed_from(voice_id, seed_salt, emotion, str(duration_factor), text)
    logger.info(
        f"TTS [clone]: voice={voice_id}, seed={seed}, emotion={emotion!r}, "
        f"duration_factor={duration_factor}, text={text!r}"
    )

    with _gen_lock:
        _set_seed(seed)
        try:
            data, sr = _infer(text, wav_path, emotion.strip(), duration_factor)
        except Exception as e:
            logger.error(f"TTS failed: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e

    data = _apply_duration_factor(data, sr, duration_factor)
    if sr != OUTPUT_SAMPLE_RATE:
        t = torch.from_numpy(data.astype(np.float32)).unsqueeze(0)
        data = torchaudio.functional.resample(t, sr, OUTPUT_SAMPLE_RATE).squeeze(0).numpy()
    return wav_response(data, OUTPUT_SAMPLE_RATE)


class VoiceRequest(BaseModel):
    wav_base64: str
    prompt_text: str | None = Field(
        default=None,
        description="Accepted for client symmetry with cosyvoice-tts; IndexTTS "
                    "cloning derives the speaker embedding from audio alone, so "
                    "the transcript is currently ignored.",
    )


class VoiceResponse(BaseModel):
    voice_id: str


class SpeechRequest(BaseModel):
    text: str
    voice_id: str
    seed_salt: str = Field(
        default="",
        description="Folded into the deterministic seed; change to re-roll all takes.",
    )
    emotion: str = Field(
        default="",
        description="Natural-language emotion description (IndexTTS-2.5 emo_text "
                    "pathway), e.g. '平静耐心地讲解' / 'excited'. Empty = neutral.",
    )
    duration_factor: float = Field(
        default=1.0,
        ge=0.5,
        le=2.0,
        description="Speaking-rate multiplier (>1 = faster). Applied as a "
                    "pitch-preserving tempo change; 1.0 keeps the model default.",
    )


@app.get("/health")
async def health():
    if model is not None:
        return {"status": "ok", "model": "IndexTTS-2.5"}
    detail = (
        f"model failed to load: {model_error}" if model_error else "model is still loading"
    )
    raise HTTPException(status_code=503, detail=detail)


# NOTE: `def` (not `async def`) so FastAPI runs this in the threadpool —
# the wav decode below is CPU work that would otherwise block the event loop.
@app.post("/v1/voices", response_model=VoiceResponse)
def register_voice(req: VoiceRequest):
    try:
        wav_bytes = base64.b64decode(req.wav_base64, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid wav_base64: {e}") from e
    if not wav_bytes:
        raise HTTPException(status_code=400, detail="wav_base64 decodes to empty payload")

    # Sanity-check the payload decodes as audio before storing it.
    try:
        sf.read(io.BytesIO(wav_bytes), dtype="float32")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"cannot decode wav: {e}") from e

    # voice_id is the content fingerprint: re-registering the same wav is a
    # no-op (idempotent).
    voice_id = hashlib.md5(wav_bytes).hexdigest()[:16]
    wav_path = _voice_path(voice_id)
    if not wav_path.exists() or wav_path.read_bytes() != wav_bytes:
        wav_path.write_bytes(wav_bytes)
    logger.info(f"Registered voice {voice_id} ({len(wav_bytes)} bytes)")
    return VoiceResponse(voice_id=voice_id)


# NOTE: `def` (not `async def`) so FastAPI runs this in the threadpool —
# generation holds the GPU for seconds and an async handler would block the
# event loop, leaving /health unanswered for the whole synthesis.
@app.post("/v1/speech")
def synthesize(req: SpeechRequest):
    return run_generate(
        text=req.text,
        voice_id=req.voice_id,
        seed_salt=req.seed_salt,
        emotion=req.emotion,
        duration_factor=req.duration_factor,
    )
