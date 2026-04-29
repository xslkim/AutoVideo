#!/usr/bin/env python3
"""
VoxCPM FastAPI Server — wraps VoxCPM2 model for AutoVideo TTS.

Usage:
  pip install voxcpm fastapi uvicorn
  python voxcpm_server.py --port 50001 [--model openbmb/VoxCPM2]

API:
  POST /synthesize
  Form data:
    text=<str>              Text to synthesize (required)
    reference_wav=<file>    Reference audio for voice cloning (optional)
    prompt_text=<str>       Transcript of reference audio for hi-fi cloning (optional)
    voice_design=<str>      Voice description, e.g. "年轻男声，温和专业" (optional)
    cfg_value=<float>       Guidance scale 1.0-3.0 (default: 2.0)
    inference_steps=<int>   Diffusion steps 4-30 (default: 10)
  Returns:
    Raw PCM int16 bytes @ 48kHz mono

  GET /health  →  {"status": "ok", "model": "openbmb/VoxCPM2"}
"""

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

# ── Model singleton ──────────────────────────────────────────────────────────

_model = None
_model_name = ""
_sample_rate = 48000


def load_model(model_name: str, optimize: bool = True):
    """Load VoxCPM model (called once at startup)."""
    global _model, _model_name, _sample_rate
    if _model is not None:
        return _model

    print(f"[VoxCPM] Loading model: {model_name} ...")
    t0 = time.time()

    from voxcpm import VoxCPM

    _model = VoxCPM.from_pretrained(model_name, load_denoiser=False, optimize=optimize)
    _model_name = model_name
    _sample_rate = _model.tts_model.sample_rate

    elapsed = time.time() - t0
    print(f"[VoxCPM] Model loaded in {elapsed:.1f}s (sample_rate={_sample_rate})")
    return _model


def get_model():
    """Return the loaded model singleton."""
    return _model


# ── FastAPI app ──────────────────────────────────────────────────────────────

def create_app():
    from fastapi import FastAPI, File, Form, UploadFile, HTTPException
    from fastapi.responses import Response

    app = FastAPI(title="VoxCPM TTS Server")

    @app.get("/health")
    async def health():
        return {"status": "ok", "model": _model_name}

    @app.post("/synthesize")
    async def synthesize(
        text: str = Form(...),
        reference_wav: UploadFile = File(default=None),
        prompt_text: str = Form(default=""),
        voice_design: str = Form(default=""),
        cfg_value: float = Form(default=2.0),
        inference_steps: int = Form(default=10),
    ):
        if not text.strip():
            raise HTTPException(status_code=400, detail="text is required")

        model = get_model()
        if model is None:
            raise HTTPException(status_code=503, detail="Model not loaded")

        # Save uploaded reference audio to temp file (if provided)
        ref_wav_path = None

        if reference_wav is not None:
            ref_bytes = await reference_wav.read()
            if ref_bytes:
                tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp.write(ref_bytes)
                tmp.close()
                ref_wav_path = tmp.name

        # Build synthesis text with optional voice design prefix
        synth_text = text
        if voice_design and not voice_design.startswith("("):
            synth_text = f"({voice_design}){text}"

        import numpy as np

        try:
            kwargs = {
                "text": synth_text,
                "cfg_value": float(cfg_value),
                "inference_timesteps": int(inference_steps),
            }

            if ref_wav_path and prompt_text:
                # Hi-fi / ultimate cloning: reference + transcript
                kwargs["prompt_wav_path"] = ref_wav_path
                kwargs["prompt_text"] = prompt_text
                kwargs["reference_wav_path"] = ref_wav_path
            elif ref_wav_path:
                # Voice cloning with style control
                kwargs["reference_wav_path"] = ref_wav_path

            wav_np = model.generate(**kwargs)

            if wav_np is None or len(wav_np) == 0:
                raise HTTPException(status_code=500, detail="VoxCPM returned empty audio")

            # Convert float numpy array → int16 PCM bytes
            wav_int16 = (wav_np * 32767).clip(-32768, 32767).astype("int16")
            pcm_bytes = wav_int16.tobytes()

            duration_ms = int(len(wav_np) / _sample_rate * 1000)

            return Response(
                content=pcm_bytes,
                media_type="audio/raw",
                headers={
                    "X-Sample-Rate": str(_sample_rate),
                    "X-Channels": "1",
                    "X-Bits-Per-Sample": "16",
                    "X-Duration-Ms": str(duration_ms),
                },
            )

        except HTTPException:
            raise
        except Exception as e:
            print(f"[VoxCPM] Synthesis error: {e}", file=sys.stderr)
            raise HTTPException(status_code=500, detail=str(e))

        finally:
            if ref_wav_path and os.path.exists(ref_wav_path):
                os.unlink(ref_wav_path)

    return app


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VoxCPM TTS Server")
    parser.add_argument("--port", type=int, default=50001, help="Server port (default: 50001)")
    parser.add_argument("--model", default="openbmb/VoxCPM2", help="Model name or path (default: openbmb/VoxCPM2)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    args = parser.parse_args()

    # Load model before starting server
    load_model(args.model)

    import uvicorn

    app = create_app()
    print(f"[VoxCPM] Starting server on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
