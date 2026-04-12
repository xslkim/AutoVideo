#!/usr/bin/env python3
"""
AutoVideo v2 — TTS Router
Routes narration blocks to the best TTS provider based on content.

Usage:
  python3 router.py <blocks.json> <block-id> <out-dir> [--provider auto|edge|cosyvoice|azure]

Outputs:
  <out-dir>/<block-id>.wav
  <out-dir>/<block-id>.vtt   (word-level timestamps)
  <out-dir>/<block-id>.meta.json

See TTS_RESEARCH.md for provider selection rationale.
"""

import sys
import os
import json
import re
import time
import argparse
import subprocess
import shutil
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

# ─── Routing config defaults ──────────────────────────────────────────────────

DEFAULT_ROUTING = {
    "strategy": "auto",           # auto | edge | cosyvoice
    "mixedLangThreshold": 0.15,   # EN chars ratio > threshold → upgrade
    "minLengthForUpgrade": 30,    # text length > this → upgrade
    "upgradeOnEmphasis": True,    # has **bold** → upgrade
    "fallbackChain": ["cosyvoice", "edge"],
}

# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class TTSResult:
    wav_path: str
    vtt_path: str
    provider_used: str
    duration_s: float
    success: bool
    error: Optional[str] = None

# ─── Content analysis ─────────────────────────────────────────────────────────

def analyze_content(narration: dict) -> dict:
    """Analyze narration for routing decisions."""
    text = narration.get("text", "")
    emphases = narration.get("emphases", [])

    if not text:
        return {"en_ratio": 0, "length": 0, "has_emphasis": False, "has_code": False}

    # Count ASCII letters as "English"
    ascii_letters = sum(1 for c in text if c.isascii() and c.isalpha())
    total_letters = sum(1 for c in text if c.isalpha())
    en_ratio = ascii_letters / max(total_letters, 1)

    # Detect code-like terms (camelCase, ALL_CAPS, contains digits mixed with letters)
    code_pattern = re.search(r'[A-Z][a-z]+[A-Z]|[a-z]+[A-Z]|[A-Z]{2,}|`[^`]+`', text)

    return {
        "en_ratio": en_ratio,
        "length": len(text),
        "has_emphasis": len(emphases) > 0,
        "has_code": code_pattern is not None,
    }

def select_provider(narration: dict, routing: dict) -> str:
    """Decide which provider to use based on content analysis."""
    strategy = routing.get("strategy", "auto")
    if strategy != "auto":
        return strategy

    analysis = analyze_content(narration)
    threshold = routing.get("mixedLangThreshold", 0.15)
    min_len = routing.get("minLengthForUpgrade", 30)
    upgrade_on_emphasis = routing.get("upgradeOnEmphasis", True)

    should_upgrade = (
        analysis["en_ratio"] > threshold
        or analysis["length"] > min_len
        or (upgrade_on_emphasis and analysis["has_emphasis"])
        or analysis["has_code"]
    )

    fallback_chain = routing.get("fallbackChain", ["cosyvoice", "azure", "edge"])

    if should_upgrade:
        return fallback_chain[0]
    return "edge"

# ─── Load providers ───────────────────────────────────────────────────────────

def get_provider(name: str, tts_config: dict = None, project_dir: Path = None):
    """Lazy-import provider by name."""
    providers_dir = Path(__file__).parent / "providers"
    sys.path.insert(0, str(providers_dir.parent))
    tts_config = tts_config or {}

    if name == "edge":
        from providers.edge import EdgeTTSProvider
        return EdgeTTSProvider()
    elif name == "cosyvoice":
        from providers.cosyvoice import CosyVoiceProvider
        cv_cfg = tts_config.get("cosyvoice", {})
        prompt_wav  = cv_cfg.get("promptWav")
        prompt_text = cv_cfg.get("promptText")
        # Resolve relative path against project dir
        if prompt_wav and project_dir and not Path(prompt_wav).is_absolute():
            prompt_wav = str(project_dir / prompt_wav)
        return CosyVoiceProvider(prompt_wav=prompt_wav, prompt_text=prompt_text)
    else:
        raise ValueError(f"Unknown TTS provider: {name}")

# ─── Router ───────────────────────────────────────────────────────────────────

def synth_block(block: dict, config: dict, out_dir: Path, voice: str) -> TTSResult:
    """Synthesize a block's narration, with automatic provider fallback."""
    block_id = block["id"]
    narration = block.get("narration", {})
    text = narration.get("text", "").strip()

    if not text:
        # Create silent placeholder
        silence_path = out_dir / f"{block_id}.wav"
        vtt_path = out_dir / f"{block_id}.vtt"
        _create_silence(silence_path, 0.5)
        vtt_path.write_text("WEBVTT\n\n")
        return TTSResult(
            wav_path=str(silence_path),
            vtt_path=str(vtt_path),
            provider_used="none",
            duration_s=0.0,
            success=True,
        )

    routing = {**DEFAULT_ROUTING, **config.get("tts", {}).get("routing", {})}
    tts_config = config.get("tts", {})

    # Override strategy from CLI if set
    strategy_override = config.get("_strategy_override")
    if strategy_override:
        routing["strategy"] = strategy_override

    initial_provider = select_provider(narration, routing)
    fallback_chain = routing.get("fallbackChain", ["cosyvoice", "edge"])

    # Build ordered list of providers to try
    providers_to_try = [initial_provider]
    for fb in fallback_chain:
        if fb not in providers_to_try:
            providers_to_try.append(fb)
    # Always end with edge-tts as final fallback
    if "edge" not in providers_to_try:
        providers_to_try.append("edge")

    out_dir.mkdir(parents=True, exist_ok=True)
    wav_path = out_dir / f"{block_id}.wav"
    vtt_path = out_dir / f"{block_id}.vtt"

    # Resolve project dir for relative asset paths
    project_dir = Path(config.get("projectDir", "."))

    last_error = None
    for provider_name in providers_to_try:
        print(f"[TTS] {block_id}: trying {provider_name}...", flush=True)
        try:
            provider = get_provider(provider_name, tts_config=tts_config, project_dir=project_dir)
            if not provider.is_available():
                print(f"[TTS] {block_id}: {provider_name} not available, skipping")
                continue

            provider_voice = _resolve_voice(provider_name, voice, tts_config)
            result = provider.synth(
                text=text,
                voice=provider_voice,
                out_wav=wav_path,
                out_vtt=vtt_path,
                emphases=narration.get("emphases", []),
                hints=narration.get("hints", {}),
            )
            result.provider_used = provider_name
            if result.success:
                print(f"[TTS] {block_id}: {provider_name} OK ({result.duration_s:.1f}s)")
                return result
            else:
                last_error = result.error or "unknown error"
                print(f"[TTS] {block_id}: {provider_name} returned failure: {last_error}", file=sys.stderr)
                time.sleep(1)

        except Exception as e:
            last_error = str(e)
            print(f"[TTS] {block_id}: {provider_name} FAILED: {e}", file=sys.stderr)
            time.sleep(2)

    return TTSResult(
        wav_path=str(wav_path),
        vtt_path=str(vtt_path),
        provider_used="none",
        duration_s=0.0,
        success=False,
        error=last_error,
    )

def _resolve_voice(provider_name: str, default_voice: str, tts_config: dict) -> str:
    if provider_name == "edge":
        return tts_config.get("edge", {}).get("voice", default_voice)
    elif provider_name == "cosyvoice":
        # CosyVoice uses zero-shot cloning; voice param is ignored (controlled by promptWav)
        return "zero_shot"
    return default_voice

def _create_silence(path: Path, duration_s: float):
    """Create a silent WAV file using ffmpeg."""
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r=24000:cl=mono",
        "-t", str(duration_s),
        "-acodec", "pcm_s16le",
        str(path),
    ], check=True, capture_output=True)

# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AutoVideo TTS Router")
    parser.add_argument("blocks_json",  help="Path to blocks.json")
    parser.add_argument("block_id",     help="Block ID to synthesize (e.g. B03)")
    parser.add_argument("out_dir",      help="Output directory for wav/vtt files")
    parser.add_argument("--config",     help="Path to video-agent-config.json", default="video-agent-config.json")
    parser.add_argument("--provider",   help="Force provider: auto|edge|cosyvoice", default="auto")
    args = parser.parse_args()

    # Load blocks.json
    blocks_data = json.loads(Path(args.blocks_json).read_text())
    block = next((b for b in blocks_data["blocks"] if b["id"] == args.block_id), None)
    if not block:
        print(f"ERROR: Block {args.block_id} not found in {args.blocks_json}", file=sys.stderr)
        sys.exit(1)

    # Load config
    config = {}
    config_path = Path(args.config)
    if config_path.exists():
        config = json.loads(config_path.read_text())

    # Override provider
    if args.provider != "auto":
        config["_strategy_override"] = args.provider

    voice = config.get("voice", "zh-CN-YunxiNeural")
    out_dir = Path(args.out_dir)

    result = synth_block(block, config, out_dir, voice)

    # Write meta
    meta_path = out_dir / f"{args.block_id}.meta.json"
    meta_path.write_text(json.dumps(asdict(result), indent=2))

    if not result.success:
        print(f"ERROR: TTS failed for {args.block_id}: {result.error}", file=sys.stderr)
        sys.exit(1)

    print(f"OK: {args.block_id} → {result.wav_path} ({result.duration_s:.2f}s, provider={result.provider_used})")

if __name__ == "__main__":
    main()
