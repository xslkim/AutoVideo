#!/usr/bin/env node
/**
 * AutoVideo v2 — Subtitle builder (Stage 2 helper)
 *
 * Each non-empty line in the narration text becomes one subtitle entry.
 * Timing (startMs / endMs) is distributed proportionally by character count
 * to guarantee every line gets a non-overlapping display window.
 * The VTT file is used only to determine the total audio duration.
 *
 * Usage:
 *   node measure-subtitle.mjs <blocks.json> <block-id> <vtt-file> <out-subtitles.json>
 *
 * Output: JSON array of { text, startMs, endMs }
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── VTT parser (used only to get total duration) ─────────────────────────────

function parseVTT(vttContent) {
  const entries = [];
  const lines = vttContent.split('\n');
  let i = 0;
  while (i < lines.length) {
    const tm = lines[i].match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (tm) {
      entries.push({
        startMs: vttTimeToMs(tm[1]),
        endMs:   vttTimeToMs(tm[2]),
      });
    }
    i++;
  }
  return entries;
}

function vttTimeToMs(ts) {
  const [h, m, s] = ts.replace(',', '.').split(':');
  return Math.round((parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)) * 1000);
}

// ─── Main logic ───────────────────────────────────────────────────────────────

function buildSubtitles(narration, totalDurationMs) {
  const { text: fullText } = narration;

  // Split into non-empty lines — each line = one subtitle
  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  if (totalDurationMs <= 0) {
    // No timing info: return stubs with zero times
    return lines.map(text => ({ text, startMs: 0, endMs: 0 }));
  }

  // Proportional distribution by character count
  const totalChars = lines.reduce((s, l) => s + l.length, 0) || 1;
  const subtitles = [];
  let cumMs = 0;

  for (const text of lines) {
    const durMs = Math.round((text.length / totalChars) * totalDurationMs);
    subtitles.push({
      text,
      startMs: cumMs,
      endMs:   cumMs + durMs,
    });
    cumMs += durMs;
  }

  // Last entry gets any rounding remainder
  if (subtitles.length > 0) {
    subtitles[subtitles.length - 1].endMs = totalDurationMs;
  }

  return subtitles;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const [,, blocksPath, blockId, vttPath, outPath] = process.argv;

if (!blocksPath || !blockId || !vttPath || !outPath) {
  console.error('Usage: node measure-subtitle.mjs <blocks.json> <B00> <B00.vtt> <out.json>');
  process.exit(1);
}

const blocks = JSON.parse(fs.readFileSync(blocksPath, 'utf-8'));
const block  = blocks.blocks.find(b => b.id === blockId);
if (!block) {
  console.error(`Block ${blockId} not found in ${blocksPath}`);
  process.exit(1);
}

if (!block.narration.text.trim()) {
  fs.writeFileSync(outPath, '[]', 'utf-8');
  console.log(`[measure-subtitle] ${blockId}: no narration → empty subtitles`);
  process.exit(0);
}

// Get total duration from VTT
let totalDurationMs = 0;
if (fs.existsSync(vttPath)) {
  const entries = parseVTT(fs.readFileSync(vttPath, 'utf-8'));
  if (entries.length > 0) {
    totalDurationMs = entries[entries.length - 1].endMs;
  }
} else {
  // Try meta.json for duration
  const metaPath = vttPath.replace(/\.vtt$/, '.meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      totalDurationMs = Math.round((meta.duration_s ?? 0) * 1000);
    } catch {}
  }
  if (totalDurationMs === 0) {
    console.warn(`[measure-subtitle] VTT not found: ${vttPath} — timing will be zero`);
  }
}

const subtitles = buildSubtitles(block.narration, totalDurationMs);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(subtitles, null, 2), 'utf-8');
console.log(`[measure-subtitle] ${blockId}: ${subtitles.length} subtitle lines → ${outPath} (total ${totalDurationMs}ms)`);
