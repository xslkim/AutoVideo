"""
FunASR 强制对齐服务 — 为 AutoVideo 逐字卡拉OK字幕产出字级时间戳

Endpoints:
  GET  /health  → { "status": "ok" }（模型加载中/加载失败返回 503）
  POST /align   → { "tokens": [{ "char", "start_ms", "end_ms" }], "duration_ms": int }

对齐模型（环境变量 ALIGN_MODEL 覆盖）：
  默认 iic/speech_timestamp_prediction-v1-16k-offline（FunASR fa-zh，字级时间戳
  预测，输入音频+原文输出每个字的时间区间）。备选 paraformer 系模型见 README。

与客户端（src/tts/timings.ts）的契约：
  - 请求 text 是「实际被朗读的文本」（可含空白；ASCII 括号已被客户端剥离）
  - 中文对齐模型按非空白字计数，因此响应 tokens 只覆盖 text 中的非空白字符，
    一一对应、顺序一致；客户端会把空白/括号映射成零时长
  - 若模型产出的时间戳数量与非空白字符数不一致（英文混排分词等），返回 422，
    客户端自动回退行内均匀估算
"""

import base64
import logging
import os
import tempfile
import threading

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [server] %(message)s")
logger = logging.getLogger("align-tts-server")

# FunASR 模型 ID（ModelScope）或本地模型目录；start.sh 会把 install.sh
# 下载好的本地目录注入进来
ALIGN_MODEL = os.environ.get(
    "ALIGN_MODEL", "iic/speech_timestamp_prediction-v1-16k-offline"
)
# CPU 可跑（字级时间戳模型很小）；有 GPU 时设 ALIGN_DEVICE=cuda:0
ALIGN_DEVICE = os.environ.get("ALIGN_DEVICE", "cpu")

app = FastAPI(title="AutoVideo align-tts")

# 模型在后台线程加载，/health 在加载期间回 503（与 cosyvoice-tts 同一约定）；
# 同步加载会让健康检查在整个加载期无响应
_state = {"model": None, "error": None, "ready": False}
# FunASR generate 不是线程安全的；逐个对齐请求串行处理
_infer_lock = threading.Lock()


def _load_model() -> None:
    try:
        from funasr import AutoModel

        logger.info("loading alignment model: %s (device=%s)", ALIGN_MODEL, ALIGN_DEVICE)
        # disable_update：避免每次启动都联网检查模型版本
        model = AutoModel(
            model=ALIGN_MODEL,
            model_revision="v2.0.4",
            device=ALIGN_DEVICE,
            disable_update=True,
        )
        _state["model"] = model
        _state["ready"] = True
        logger.info("alignment model ready")
    except Exception as exc:  # noqa: BLE001 — 任何加载失败都要反映到 /health
        logger.exception("model load failed")
        _state["error"] = str(exc)


@app.on_event("startup")
async def _startup() -> None:
    threading.Thread(target=_load_model, daemon=True).start()


@app.get("/health")
async def health():
    if _state["ready"]:
        return {"status": "ok"}
    if _state["error"]:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "detail": _state["error"]},
        )
    return JSONResponse(status_code=503, content={"status": "loading"})


class AlignRequest(BaseModel):
    wav_base64: str
    text: str


def _non_whitespace_chars(text: str) -> list[str]:
    """对齐契约：时间戳只对应非空白字符（中文逐字；空白不发音）。"""
    return [c for c in text if not c.isspace()]


@app.post("/align")
async def align(req: AlignRequest):
    if not _state["ready"]:
        raise HTTPException(status_code=503, detail="model not ready")

    chars = _non_whitespace_chars(req.text)
    if not chars:
        raise HTTPException(status_code=422, detail="text has no alignable characters")

    try:
        wav_bytes = base64.b64decode(req.wav_base64)
    except Exception:
        raise HTTPException(status_code=422, detail="wav_base64 is not valid base64")

    # FunASR 的 (audio, text) 输入走文件路径最稳（内部用 soundfile 读并重采样到 16k）
    tmp = tempfile.NamedTemporaryFile(prefix="align-", suffix=".wav", delete=False)
    try:
        tmp.write(wav_bytes)
        tmp.close()

        with _infer_lock:
            # fa-zh / timestamp-prediction 模型的对齐用法：input=(音频, 文本)。
            # 返回 [{"text": 原文, "timestamp": [[start_ms, end_ms], ...]}]，
            # timestamp 与文本的非空白字一一对应（中文逐字）。
            # 注意：不同 funasr 版本的返回字段若有出入，校准点就在下面这段解析。
            res = _state["model"].generate(
                input=(tmp.name, req.text),
                data_type=("sound", "text"),
            )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("alignment failed")
        raise HTTPException(status_code=500, detail=f"alignment failed: {exc}")
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    item = res[0] if isinstance(res, (list, tuple)) else res
    timestamps = item.get("timestamp") if isinstance(item, dict) else None
    if not isinstance(timestamps, list):
        raise HTTPException(
            status_code=500,
            detail="model returned no timestamp list — check funasr version output format",
        )

    if len(timestamps) != len(chars):
        # 模型按自己的分词出时间戳,数量与字符不一定相等:"socket" 这类
        # 英文词整体一档(且被大写归一),不发音的标点直接没有档位。用模型
        # 返回的 text 字段(空格分隔的分词结果)与原文逐字符对齐:
        # 大小写不敏感匹配;被丢弃的标点挂上一字符结束时刻(零时长,不单独
        # 占高亮);多字符合词把时间段均分给每个字符。对不上才 422 回退估算。
        seg_text = item.get("text")
        seg_tokens = seg_text.split() if isinstance(seg_text, str) else []
        expanded_ts: list[list[int]] = []
        ci = 0
        ok = len(seg_tokens) == len(timestamps)
        last_end = 0
        if ok:
            for tok, ts in zip(seg_tokens, timestamps):
                n = max(1, len(tok))
                while ci < len(chars) and "".join(chars[ci:ci + n]).lower() != tok.lower():
                    expanded_ts.append([last_end, last_end])
                    ci += 1
                if ci + n > len(chars):
                    ok = False
                    break
                step = (int(ts[1]) - int(ts[0])) / n
                for i in range(n):
                    expanded_ts.append([int(ts[0] + i * step), int(ts[0] + (i + 1) * step)])
                ci += n
                last_end = int(ts[1])
            while ci < len(chars):
                expanded_ts.append([last_end, last_end])
                ci += 1
        if ok and len(expanded_ts) == len(chars):
            timestamps = expanded_ts
        else:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"token count mismatch: model produced {len(timestamps)} timestamps "
                    f"for {len(chars)} non-whitespace chars"
                ),
            )

    tokens = []
    prev_end = 0
    for char, ts in zip(chars, timestamps):
        start_ms, end_ms = int(ts[0]), int(ts[1])
        # 防御性钳制：时间戳单调不减、不越出负数区间
        start_ms = max(0, start_ms, prev_end)
        end_ms = max(start_ms, end_ms)
        prev_end = end_ms
        tokens.append({"char": char, "start_ms": start_ms, "end_ms": end_ms})

    duration_ms = tokens[-1]["end_ms"] if tokens else 0
    return {"tokens": tokens, "duration_ms": duration_ms}
