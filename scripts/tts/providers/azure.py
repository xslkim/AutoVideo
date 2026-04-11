"""
Azure Speech TTS provider — cloud fallback for mixed Chinese-English content.
Requires: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables.
pip install azure-cognitiveservices-speech
"""
import os
import subprocess
import json
import re
import tempfile
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


@dataclass
class TTSResult:
    wav_path: str
    vtt_path: str
    provider_used: str
    duration_s: float
    success: bool
    error: Optional[str] = None


# SSML template for Azure multilingual synthesis
SSML_TEMPLATE = """<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts"
       xml:lang="zh-CN">
  <voice name="{voice}">
    <mstts:express-as style="{style}">
      <prosody rate="{rate}">
        {body}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>"""


class AzureTTSProvider:
    name = "azure"

    def __init__(self):
        self._sdk_available = None

    def is_available(self) -> bool:
        key    = os.environ.get("AZURE_SPEECH_KEY", "")
        region = os.environ.get("AZURE_SPEECH_REGION", "")
        if not key or not region:
            return False
        if self._sdk_available is None:
            try:
                import azure.cognitiveservices.speech  # noqa
                self._sdk_available = True
            except ImportError:
                self._sdk_available = False
        return self._sdk_available

    def synth(self, *, text: str, voice: str, out_wav: Path, out_vtt: Path,
              emphases=None, hints=None) -> TTSResult:
        import azure.cognitiveservices.speech as speechsdk

        emphases = emphases or []
        hints    = hints or {}

        key    = os.environ["AZURE_SPEECH_KEY"]
        region = os.environ.get("AZURE_SPEECH_REGION", "eastasia")

        style = hints.get("style", "neutral")
        rate  = hints.get("rate", 1.0)
        rate_str = f"{int((rate - 1) * 100):+d}%" if rate != 1.0 else "0%"

        ssml_body = self._build_ssml_body(text, emphases)
        ssml = SSML_TEMPLATE.format(
            voice=voice,
            style=style,
            rate=rate_str,
            body=ssml_body,
        )

        speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
        speech_config.speech_synthesis_output_format = (
            speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
        )
        speech_config.request_word_level_timestamps()

        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(out_wav))
        synthesizer  = speechsdk.SpeechSynthesizer(
            speech_config=speech_config,
            audio_config=audio_config,
        )

        result = synthesizer.speak_ssml_async(ssml).get()

        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            details = speechsdk.CancellationDetails.from_result(result)
            raise RuntimeError(f"Azure synthesis failed: {details.error_details}")

        # Extract word-level timing from result
        word_boundaries = []
        def on_word_boundary(evt):
            word_boundaries.append({
                "word":    evt.text,
                "startMs": evt.audio_offset // 10000,  # 100-ns ticks → ms
                "endMs":   (evt.audio_offset + evt.duration) // 10000,
            })

        synthesizer.synthesis_word_boundary.connect(on_word_boundary)

        # Write VTT
        vtt_content = self._build_vtt(word_boundaries)
        out_vtt.write_text(vtt_content, encoding="utf-8")

        duration = self._get_duration(out_wav)
        return TTSResult(
            wav_path=str(out_wav),
            vtt_path=str(out_vtt),
            provider_used="azure",
            duration_s=duration,
            success=True,
        )

    def _build_ssml_body(self, text: str, emphases: list) -> str:
        """Wrap emphasized words in <emphasis> tags."""
        if not emphases:
            return self._escape_xml(text)

        result = []
        last = 0
        for e in sorted(emphases, key=lambda x: x["start"]):
            result.append(self._escape_xml(text[last:e["start"]]))
            word = text[e["start"]:e["end"]]
            result.append(f'<emphasis level="moderate">{self._escape_xml(word)}</emphasis>')
            last = e["end"]
        result.append(self._escape_xml(text[last:]))
        return "".join(result)

    def _escape_xml(self, s: str) -> str:
        return (s.replace("&", "&amp;")
                 .replace("<", "&lt;")
                 .replace(">", "&gt;")
                 .replace('"', "&quot;"))

    def _build_vtt(self, word_boundaries: list) -> str:
        lines = ["WEBVTT", ""]
        for wb in word_boundaries:
            start = self._ms_to_vtt(wb["startMs"])
            end   = self._ms_to_vtt(wb["endMs"])
            lines.append(f"{start} --> {end}")
            lines.append(wb["word"])
            lines.append("")
        return "\n".join(lines)

    def _ms_to_vtt(self, ms: int) -> str:
        h  = ms // 3600000
        m  = (ms % 3600000) // 60000
        s  = (ms % 60000) // 1000
        ms = ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"

    def _get_duration(self, wav_path: Path) -> float:
        try:
            result = subprocess.run([
                "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(wav_path),
            ], capture_output=True, text=True, timeout=10)
            return float(result.stdout.strip())
        except Exception:
            return 0.0
