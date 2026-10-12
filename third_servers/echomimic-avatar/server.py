"""
EchoMimicV3-Flash 半身虚拟讲师服务(AutoVideo avatar 后端之一)。

POST /avatar — multipart: image(参考肖像 png/jpg), audio(旁白 wav),
               可选 fps / seed / prompt / steps / audio_guidance_scale
GET  /health — 就绪探针(权重缺失时 503)

与 musetalk-lipsync 的接口差异:
  - 输入是静态参考图片,不是循环视频;表单字段为 image(而非 video),端点为 /avatar。
  - 输出固定 768x768 半身带表情视频片段(扩散模型生成,非嘴部区域替换)。
  - 响应同样为无音轨 video/mp4,与 AutoVideo 渲染管线的叠加约定一致。

实现方式:子进程调用上游 antgroup/echomimic_v3 的 infer_flash.py(8 步 Flash 推理),
权重布局见 install.sh 与 README.md。需要 CUDA >= 12.1、显存 >= 12 GB。

启动(在 third_servers/echomimic-avatar/ 下):
  conda activate echomimic_v3 && python server.py --host 0.0.0.0 --port 8006
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

SCRIPT_DIR = Path(__file__).resolve().parent

# populated by main() args
_repo_dir: Path = SCRIPT_DIR / "repo"
_model_root: Path = SCRIPT_DIR / "repo" / "flash"
_max_seconds: float = 30.0
_weight_dtype: str = "bfloat16"

_inference_lock = threading.Lock()

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

# infer_flash.py 的 CLI 默认值,与上游 run_flash.sh 对齐
FLASH_DEFAULTS = {
    "steps": 8,
    "guidance_scale": 6.0,
    "audio_guidance_scale": 3.0,
    "teacache_threshold": 0.1,
    "fps": 25,
    "seed": 43,
    "sample_size": (768, 768),
}


def check_ready() -> list[str]:
    """返回缺失项列表;空列表表示可推理。"""
    missing: list[str] = []
    if not (_repo_dir / "infer_flash.py").is_file():
        missing.append(f"上游仓库未就绪(缺 {_repo_dir / 'infer_flash.py'},先运行 install.sh)")
        return missing
    weights = [
        _model_root / "transformer" / "diffusion_pytorch_model.safetensors",
        _model_root / "Wan2.1-Fun-V1.1-1.3B-InP",
        _model_root / "chinese-wav2vec2-base",
    ]
    for p in weights:
        if not p.exists():
            missing.append(f"缺权重: {p}(install.sh 或手动下载,见 README.md)")
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except Exception:
        missing.append("ffmpeg 不在 PATH 中")
    return missing


def probe_audio_seconds(wav_path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(wav_path),
        ],
        capture_output=True, check=True, text=True,
    )
    return float(out.stdout.strip())


def wan_frame_count(duration_sec: float, fps: int) -> int:
    """Wan 系模型帧数约定为 4n+1;按音频时长向上取整,封顶 --max-seconds。"""
    import math
    capped = min(duration_sec, _max_seconds)
    return 4 * math.ceil(capped * fps / 4) + 1


def build_infer_cmd(
    image_path: Path,
    audio_path: Path,
    out_dir: Path,
    video_length: int,
    fps: int,
    seed: int,
    prompt: str,
    steps: int,
    audio_guidance_scale: float,
) -> list[str]:
    w, h = FLASH_DEFAULTS["sample_size"]
    return [
        sys.executable, "infer_flash.py",
        "--image_path", str(image_path),
        "--audio_path", str(audio_path),
        "--prompt", prompt,
        "--num_inference_steps", str(steps),
        "--config_path", "config/config.yaml",
        "--model_name", str(_model_root / "Wan2.1-Fun-V1.1-1.3B-InP"),
        "--ckpt_idx", "50000",
        "--transformer_path", str(_model_root / "transformer" / "diffusion_pytorch_model.safetensors"),
        "--save_path", str(out_dir),
        "--wav2vec_model_dir", str(_model_root / "chinese-wav2vec2-base"),
        "--sampler_name", "Flow_Unipc",
        "--video_length", str(video_length),
        "--guidance_scale", str(FLASH_DEFAULTS["guidance_scale"]),
        "--audio_guidance_scale", str(audio_guidance_scale),
        "--audio_scale", "1.0",
        "--neg_scale", "1.0",
        "--neg_steps", "0",
        "--seed", str(seed),
        "--enable_teacache",
        "--teacache_threshold", str(FLASH_DEFAULTS["teacache_threshold"]),
        "--num_skip_start_steps", "5",
        "--riflex_k", "6",
        "--ulysses_degree", "1",
        "--ring_degree", "1",
        "--weight_dtype", _weight_dtype,
        "--sample_size", str(w), str(h),
        "--fps", str(fps),
        "--add_prompt", "",
        "--negative_prompt", "",
        "--shift", "5.0",
    ]


def find_output_mp4(out_dir: Path, since: float) -> Path | None:
    """infer_flash.py 的输出命名以 upstream 为准——取本次调用后新生成的最新 mp4。"""
    candidates = [
        p for p in out_dir.rglob("*.mp4") if p.stat().st_mtime >= since
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def strip_audio(src_mp4: Path, dst_mp4: Path) -> None:
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(src_mp4), "-an", "-c:v", "copy", str(dst_mp4)],
            capture_output=True, check=True,
        )
    except subprocess.CalledProcessError:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(src_mp4),
                "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dst_mp4),
            ],
            capture_output=True, check=True,
        )


app = FastAPI(title="EchoMimicV3-Flash Avatar API")


@app.get("/health")
def health() -> JSONResponse:
    missing = check_ready()
    if missing:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "error": "; ".join(missing)},
        )
    gpu = "unknown"
    try:
        import torch
        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0)
    except Exception:
        pass
    return JSONResponse({"status": "ok", "gpu": gpu, "mode": "flash", "resolution": "768x768"})


@app.post("/avatar", response_model=None)
async def avatar(
    image: UploadFile = File(..., description="参考肖像 png/jpg(半身正脸)"),
    audio: UploadFile = File(..., description="旁白 wav"),
    fps: int = Form(FLASH_DEFAULTS["fps"]),
    seed: int = Form(FLASH_DEFAULTS["seed"]),
    prompt: str = Form("A person is speaking."),
    steps: int = Form(FLASH_DEFAULTS["steps"]),
    audio_guidance_scale: float = Form(FLASH_DEFAULTS["audio_guidance_scale"]),
):
    if fps < 1 or fps > 60:
        return JSONResponse(status_code=400, content={"error": "fps must be between 1 and 60"})
    if steps < 1 or steps > 50:
        return JSONResponse(status_code=400, content={"error": "steps must be between 1 and 50"})

    iname = (image.filename or "").lower()
    aname = (audio.filename or "").lower()
    if not any(iname.endswith(s) for s in IMAGE_SUFFIXES):
        return JSONResponse(status_code=400, content={"error": "image must be .png/.jpg/.jpeg/.webp"})
    if not aname.endswith(".wav"):
        return JSONResponse(status_code=400, content={"error": "audio must be .wav"})

    missing = check_ready()
    if missing:
        return JSONResponse(status_code=503, content={"error": "; ".join(missing)})

    sid = uuid.uuid4().hex
    session_dir = _repo_dir / "results" / "api_sessions" / sid
    out_dir = session_dir / "outputs"
    session_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(exist_ok=True)

    image_path = session_dir / f"{sid}_ref{Path(iname).suffix}"
    audio_path = session_dir / f"{sid}_audio.wav"
    stripped_path = session_dir / f"{sid}_out_no_audio.mp4"

    try:
        image_path.write_bytes(await image.read())
        audio_path.write_bytes(await audio.read())

        try:
            duration = probe_audio_seconds(audio_path)
        except Exception as e:
            return JSONResponse(status_code=400, content={"error": f"invalid or unreadable audio (ffprobe): {e}"})

        video_length = wan_frame_count(duration, fps)
        cmd = build_infer_cmd(
            image_path, audio_path, out_dir, video_length,
            fps, seed, prompt, steps, audio_guidance_scale,
        )

        started = time.time()
        with _inference_lock:
            proc = subprocess.run(cmd, cwd=_repo_dir, capture_output=True, text=True)
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()
            msg = tail[-1] if tail else f"exit code {proc.returncode}"
            return JSONResponse(status_code=500, content={"error": f"infer_flash failed: {msg[:500]}"})

        produced = find_output_mp4(out_dir, started - 1)
        if produced is None:
            return JSONResponse(status_code=500, content={"error": "inference produced no output mp4"})

        strip_audio(produced, stripped_path)
        return Response(content=stripped_path.read_bytes(), media_type="video/mp4")
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        try:
            shutil.rmtree(session_dir, ignore_errors=True)
        except Exception:
            pass


def main() -> None:
    global _repo_dir, _model_root, _max_seconds, _weight_dtype

    parser = argparse.ArgumentParser(description="EchoMimicV3-Flash avatar service")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8006)
    parser.add_argument("--repo-dir", type=str, default=os.environ.get("ECHOMIMIC_REPO_DIR", str(SCRIPT_DIR / "repo")))
    parser.add_argument("--model-root", type=str, default=None,
                        help="权重根目录(默认 <repo>/flash,布局见 README.md)")
    parser.add_argument("--max-seconds", type=float, default=float(os.environ.get("ECHO_MAX_SECONDS", "30")),
                        help="单片段最长秒数(AutoVideo 按 block 调用,默认 30)")
    parser.add_argument("--weight-dtype", type=str, default=os.environ.get("ECHO_WEIGHT_DTYPE", "bfloat16"))
    args = parser.parse_args()

    _repo_dir = Path(args.repo_dir).resolve()
    _model_root = Path(args.model_root).resolve() if args.model_root else _repo_dir / "flash"
    _max_seconds = args.max_seconds
    _weight_dtype = args.weight_dtype

    for m in check_ready():
        print(f"[WARN] {m}", file=sys.stderr)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()
