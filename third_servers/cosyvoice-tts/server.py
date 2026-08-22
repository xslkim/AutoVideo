"""
Fun-CosyVoice3 FastAPI server — TTS backend (zero-shot voice cloning)

Endpoints:
  GET  /health              → { status: "ok" } (503 while the model is loading / failed)
  POST /v1/voices           → { voice_id: string }  (md5 fingerprint of the wav; idempotent)
  POST /v1/speech           → WAV binary (48kHz), zero-shot with the registered voice

Consistency strategy: every line is synthesized with the SAME registered voiceRef
as zero-shot prompt — no line chaining (usesChain=false on the client side).
"""

import base64
import hashlib
import io
import logging
import os
import random
import re
import sys
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
logger = logging.getLogger("cosyvoice-server")

SCRIPT_DIR = Path(__file__).resolve().parent

MODEL_DIR = os.environ.get("COSYVOICE_MODEL_DIR", "")
if not MODEL_DIR:
    raise RuntimeError(
        "COSYVOICE_MODEL_DIR is not set. Export it to point at your "
        "Fun-CosyVoice3-0.5B weights directory before starting the server."
    )
REPO_DIR = Path(os.environ.get("COSYVOICE_REPO_DIR", SCRIPT_DIR / "CosyVoice"))
VOICE_DIR = Path(os.environ.get("COSYVOICE_VOICE_DIR", SCRIPT_DIR / "voices"))
# CosyVoice3 was trained with an instruct prefix separated from the reference
# transcript by <|endofprompt|> (see upstream example.py). Prepended to
# prompt_text when the caller did not include the marker itself.
INSTRUCT_PREFIX = os.environ.get(
    "COSYVOICE_INSTRUCT_PREFIX", "You are a helpful assistant.<|endofprompt|>"
)
OUTPUT_SAMPLE_RATE = 48000

# CosyVoice zero-shot rejects reference audio longer than 30s. Overlong
# references are auto-trimmed to the first REF_TRIM_SEC seconds (with the
# transcript truncated proportionally) so a long voiceRef works out of the
# box — see register_voice().
MAX_REF_SEC = float(os.environ.get("COSYVOICE_MAX_REF_SEC", "29"))
REF_TRIM_SEC = float(os.environ.get("COSYVOICE_REF_TRIM_SEC", "14"))

# CosyVoice is not a pip package: import it from the cloned repo.
for p in (REPO_DIR, REPO_DIR / "third_party" / "Matcha-TTS"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

VOICE_DIR.mkdir(parents=True, exist_ok=True)

# Model loads in a background thread so /health can report 503 while loading
# instead of the port simply being unreachable (uvicorn imports this module
# before serving; a synchronous load would leave health checks unanswered).
model = None
model_error: str | None = None


def _load_model() -> None:
    global model, model_error
    try:
        logger.info(f"Loading Fun-CosyVoice3 model from {MODEL_DIR} ...")
        from cosyvoice.cli.cosyvoice import AutoModel

        model = AutoModel(model_dir=MODEL_DIR)
        logger.info(f"Fun-CosyVoice3 model loaded (sample_rate={model.sample_rate}).")
    except Exception as e:
        model_error = str(e)
        logger.error(f"Model load failed: {e}")


threading.Thread(target=_load_model, daemon=True).start()


# The LLM/flow decoder starts from fresh RNG noise on every call. Without a
# fixed seed each line of a script is a new dice roll and the cloned timbre
# drifts — audible as "a different speaker per paragraph". Seed deterministically
# per (voice fingerprint, salt, text) so synthesis is reproducible across
# registrations and server restarts (voice_id IS the wav md5 fingerprint).
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

app = FastAPI(title="Fun-CosyVoice3 TTS Server")


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


def _voice_paths(voice_id: str) -> tuple[Path, Path]:
    return VOICE_DIR / f"{voice_id}.wav", VOICE_DIR / f"{voice_id}.txt"


def _read_prompt_text(voice_id: str) -> str | None:
    _, txt_path = _voice_paths(voice_id)
    if not txt_path.exists():
        return None
    text = txt_path.read_text(encoding="utf-8").strip()
    return text or None


def wav_response(speech: torch.Tensor, sample_rate: int) -> Response:
    """Model output → 48kHz PCM16 WAV. Clip-guard ONLY: compress when the peak
    exceeds 0.99, never normalize quieter takes up to full scale."""
    if sample_rate != OUTPUT_SAMPLE_RATE:
        speech = torchaudio.functional.resample(speech, sample_rate, OUTPUT_SAMPLE_RATE)
    audio = speech.squeeze(0).float().cpu().numpy()
    if audio.size == 0:
        raise HTTPException(status_code=500, detail="model returned empty audio")
    peak = float(np.max(np.abs(audio)))
    if peak > 0.99:
        audio = audio / peak * 0.99
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)

    buf = io.BytesIO()
    sf.write(buf, pcm, OUTPUT_SAMPLE_RATE, subtype="PCM_16", format="WAV")
    wav_bytes = buf.getvalue()
    logger.info(f"TTS done: {len(wav_bytes)} bytes, {len(pcm) / OUTPUT_SAMPLE_RATE:.2f}s")
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Length": str(len(wav_bytes))},
    )


def run_generate(text: str, voice_id: str, seed_salt: str, normalize: bool) -> Response:
    if model is None:
        detail = (
            f"model failed to load: {model_error}" if model_error else "model is still loading"
        )
        raise HTTPException(status_code=503, detail=detail)

    wav_path, _ = _voice_paths(voice_id)
    if not wav_path.exists():
        raise HTTPException(status_code=404, detail=f"voice_id {voice_id} not found")
    prompt_text = _read_prompt_text(voice_id)
    if prompt_text is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"voice {voice_id} has no prompt_text: CosyVoice zero-shot requires "
                "the transcript of the reference wav. Re-POST /v1/voices with the "
                "same wav_base64 plus prompt_text to attach it."
            ),
        )

    # Same preprocessing on both sides of the prompt: CJK/ASCII boundary
    # spacing, then the engine's own text_normalize (text_frontend=normalize).
    text = insert_zh_en_space(text)
    prompt_text = insert_zh_en_space(prompt_text)
    if "<|endofprompt|>" not in prompt_text and INSTRUCT_PREFIX:
        prompt_text = INSTRUCT_PREFIX + prompt_text

    seed = _seed_from(voice_id, seed_salt, text)
    logger.info(f"TTS [zero-shot]: voice={voice_id}, seed={seed}, text={text!r}")

    with _gen_lock:
        _set_seed(seed)
        try:
            chunks = [
                out["tts_speech"]
                for out in model.inference_zero_shot(
                    text,
                    prompt_text,
                    str(wav_path),
                    stream=False,
                    text_frontend=normalize,
                )
            ]
        except Exception as e:
            logger.error(f"TTS failed: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e
    if not chunks:
        raise HTTPException(status_code=500, detail="model returned no audio")
    return wav_response(torch.cat(chunks, dim=1), model.sample_rate)


class VoiceRequest(BaseModel):
    wav_base64: str
    prompt_text: str | None = Field(
        default=None,
        description="Transcript of the reference wav. Required before the voice "
                    "can be used in /v1/speech; may be supplied now or later by "
                    "re-registering the same wav.",
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
    normalize: bool = Field(
        default=False,
        description="Run the engine's text normalization (handles numbers, symbols). "
                    "CJK-ASCII boundary spacing is always applied regardless of this flag.",
    )


@app.get("/health")
async def health():
    if model is not None:
        return {"status": "ok", "model": "Fun-CosyVoice3-0.5B"}
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

    prompt_text = (
        req.prompt_text.strip() if req.prompt_text and req.prompt_text.strip() else None
    )

    # Auto-trim overlong references: the transcript is sequential over the
    # audio, so a proportional character prefix stays aligned with the
    # trimmed head. voice_id fingerprints the ORIGINAL bytes — registering
    # the same source wav stays idempotent regardless of trimming.
    try:
        data, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        duration = len(data) / sr
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"cannot decode wav: {e}") from e
    stored_bytes = wav_bytes
    if duration > MAX_REF_SEC:
        data = data[: int(REF_TRIM_SEC * sr)]
        buf = io.BytesIO()
        sf.write(buf, data, sr, format="WAV", subtype="PCM_16")
        stored_bytes = buf.getvalue()
        if prompt_text:
            keep = max(1, int(len(prompt_text) * REF_TRIM_SEC / duration))
            prompt_text = prompt_text[:keep]
        logger.warning(
            f"reference wav {duration:.1f}s > {MAX_REF_SEC}s — auto-trimmed to first "
            f"{REF_TRIM_SEC}s, prompt_text truncated to {len(prompt_text) if prompt_text else 0} chars"
        )

    # voice_id is the content fingerprint: re-registering the same wav is a
    # no-op (idempotent), and a later call may attach/replace prompt_text.
    voice_id = hashlib.md5(wav_bytes).hexdigest()[:16]
    wav_path, txt_path = _voice_paths(voice_id)
    if not wav_path.exists():
        wav_path.write_bytes(stored_bytes)

    if prompt_text:
        txt_path.write_text(prompt_text, encoding="utf-8")
        logger.info(f"Registered voice {voice_id} with prompt_text ({len(wav_bytes)} bytes)")
    else:
        pending = not txt_path.exists()
        logger.info(
            f"Registered voice {voice_id} ({len(wav_bytes)} bytes)"
            + (", prompt_text pending" if pending else ", prompt_text kept")
        )

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
        normalize=req.normalize,
    )
