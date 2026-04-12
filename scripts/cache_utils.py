#!/usr/bin/env python3
"""
AutoVideo Global Asset Cache — Python utilities (audio side).

Cache layout:
  ~/.autovideo-cache/
    manifest.json
    audio/{md5}.wav
    audio/{md5}.vtt
    audio/{md5}.meta.json

Hash inputs for audio:
  - narration text (whitespace-normalised)
  - TTS voice name
  - TTS provider name (edge / cosyvoice / azure / ...)

Usage (as library):
  from cache_utils import AudioCache
  cache = AudioCache()
  h = cache.compute_hash(text, voice, provider)
  hit = cache.lookup(h)
  if hit:
      shutil.copy(hit['wav'], dest_wav)
  else:
      ... generate ...
      cache.store(h, wav, vtt, meta, title="块标题", project="/home/...", provider="edge")
"""

import fcntl
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

CACHE_DIR = Path.home() / ".autovideo-cache"


# ── Hash computation ──────────────────────────────────────────────────────────

def compute_audio_hash(narration_text: str, voice: str, provider: str) -> str:
    """
    Deterministic MD5 for an audio asset.
    Inputs: narration text (whitespace-normalised) + voice + provider.
    """
    normalised = " ".join(narration_text.strip().split())
    payload = json.dumps(
        {"type": "audio", "narration": normalised, "voice": voice, "provider": provider},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


# ── Manifest helpers (file-locked for parallel TTS safety) ───────────────────

def _manifest_path(cache_dir: Path) -> Path:
    return cache_dir / "manifest.json"


def _read_manifest(cache_dir: Path) -> dict:
    mp = _manifest_path(cache_dir)
    if not mp.exists():
        return {"version": 1, "entries": {}}
    try:
        return json.loads(mp.read_text("utf-8"))
    except Exception:
        return {"version": 1, "entries": {}}


def _write_manifest(manifest: dict, cache_dir: Path) -> None:
    mp = _manifest_path(cache_dir)
    tmp = mp.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(mp)


def _with_manifest_lock(cache_dir: Path, fn):
    """Run fn(manifest) → manifest under an exclusive file lock."""
    lock_path = cache_dir / "manifest.lock"
    cache_dir.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            manifest = _read_manifest(cache_dir)
            updated = fn(manifest)
            if updated is not None:
                _write_manifest(updated, cache_dir)
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


# ── AudioCache ────────────────────────────────────────────────────────────────

class AudioCache:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self.cache_dir = cache_dir
        self.audio_dir = cache_dir / "audio"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)

    def compute_hash(self, narration_text: str, voice: str, provider: str) -> str:
        return compute_audio_hash(narration_text, voice, provider)

    def lookup(self, hash_val: str) -> Optional[dict]:
        """
        Returns {'wav': path, 'vtt': path, 'meta': path|None} on cache hit,
        or None on miss (silently, even if files are partially present).
        """
        wav = self.audio_dir / f"{hash_val}.wav"
        vtt = self.audio_dir / f"{hash_val}.vtt"
        if not wav.exists() or not vtt.exists():
            return None

        meta_path = self.audio_dir / f"{hash_val}.meta.json"
        self._increment_hit(hash_val)

        return {
            "wav":  str(wav),
            "vtt":  str(vtt),
            "meta": str(meta_path) if meta_path.exists() else None,
        }

    def store(
        self,
        hash_val: str,
        wav_path: str,
        vtt_path: str,
        meta_path: Optional[str],
        title: str,
        project: str,
        provider: str,
    ) -> None:
        """Copy generated audio files into the global cache, update manifest."""
        dest_wav  = self.audio_dir / f"{hash_val}.wav"
        dest_vtt  = self.audio_dir / f"{hash_val}.vtt"
        dest_meta = self.audio_dir / f"{hash_val}.meta.json"

        shutil.copy2(wav_path, dest_wav)
        shutil.copy2(vtt_path, dest_vtt)
        if meta_path and Path(meta_path).exists():
            shutil.copy2(meta_path, dest_meta)

        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        def update(manifest):
            manifest["entries"][hash_val] = {
                "type":      "audio",
                "title":     title,
                "project":   project,
                "provider":  provider,
                "createdAt": now,
                "hitCount":  0,
                "lastHitAt": None,
                "files": {
                    "wav": f"audio/{hash_val}.wav",
                    "vtt": f"audio/{hash_val}.vtt",
                },
            }
            return manifest

        _with_manifest_lock(self.cache_dir, update)

    def _increment_hit(self, hash_val: str) -> None:
        """Best-effort hit-count update; never raises."""
        try:
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

            def update(manifest):
                if hash_val in manifest.get("entries", {}):
                    e = manifest["entries"][hash_val]
                    e["hitCount"]  = e.get("hitCount", 0) + 1
                    e["lastHitAt"] = now
                    return manifest
                return None  # no write needed if entry missing

            _with_manifest_lock(self.cache_dir, update)
        except Exception:
            pass
