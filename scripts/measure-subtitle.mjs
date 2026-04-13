#!/usr/bin/env node
/**
 * AutoVideo v2 — Subtitle builder (Stage 2 helper)
 *
 * Each non-empty line in the narration text becomes one subtitle entry.
 * Timing (startMs / endMs) is computed from VTT word-level timestamps.
 * If VTT is unavailable, timing is distributed proportionally by char count.
 *
 * Usage:
 *   node measure-subtitle.mjs <blocks.json> <block-id> <vtt-file> <out-subtitles.json>
 *
 * Output: JSON array of { text, startMs, endMs, emphases }
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── VTT parser ───────────────────────────────────────────────────────────────

function parseVTT(vttContent) {
  const entries = [];
  const lines = vttContent.split('\n');
  let i = 0;
  while (i < lines.length) {
    const tm = lines[i].match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (tm) {
      const startMs = vttTimeToMs(tm[1]);
      const endMs   = vttTimeToMs(tm[2]);
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) entries.push({ startMs, endMs, text });
    } else {
      i++;
    }
  }
  return entries;
}

function vttTimeToMs(ts) {
  const [h, m, s] = ts.replace(',', '.').split(':');
  return Math.round((parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)) * 1000);
}

// ─── Emphasis mapping ─────────────────────────────────────────────────────────

function mapEmphases(segmentText, globalEmphases, segmentOffset) {
  return globalEmphases
    .map(e => ({
      start: Math.max(0, e.start - segmentOffset),
      end:   Math.max(0, e.end   - segmentOffset),
    }))
    .filter(e => e.start < segmentText.length && e.end > 0)
    .map(e => ({
      start: Math.max(0, e.start),
      end:   Math.min(segmentText.length, e.end),
    }))
    .filter(e => e.start < e.end);
}

// ─── Build subtitle timing from VTT word entries ──────────────────────────────

/**
 * Build a character-position → ms map from VTT entries by fuzzy-matching
 * VTT text against the full narration text.
 */
function buildPosMap(fullText, vttEntries) {
  const posMap = []; // { pos, startMs, endMs, len }
  let searchFrom = 0;

  for (const entry of vttEntries) {
    // Normalize for matching: strip whitespace-only differences
    const needle = entry.text.replace(/\s+/g, '');
    if (!needle) continue;

    // Search in a normalized version of fullText from current position
    let bestIdx = -1;
    let bestScore = 0;

    // Try exact substring match first
    const idx = fullText.indexOf(entry.text, searchFrom);
    if (idx !== -1) {
      posMap.push({ pos: idx, startMs: entry.startMs, endMs: entry.endMs, len: entry.text.length });
      searchFrom = idx + entry.text.length;
      continue;
    }

    // Fallback: try matching without whitespace
    const stripped = fullText.slice(searchFrom);
    let strippedIdx = 0;
    let origIdx = searchFrom;
    let matchStart = -1;

    for (let si = 0; si < stripped.length && strippedIdx < needle.length; si++) {
      const ch = stripped[si];
      if (/\s/.test(ch)) { origIdx++; continue; }
      if (ch === needle[strippedIdx]) {
        if (strippedIdx === 0) matchStart = origIdx;
        strippedIdx++;
      } else {
        strippedIdx = 0;
        matchStart = -1;
      }
      origIdx++;
    }

    if (strippedIdx === needle.length && matchStart !== -1) {
      posMap.push({ pos: matchStart, startMs: entry.startMs, endMs: entry.endMs, len: origIdx - matchStart });
      searchFrom = origIdx;
    }
  }

  return posMap;
}

/**
 * Given a subtitle line's start/end position in fullText, find its
 * startMs/endMs from the VTT position map.
 */
function findTimingForRange(lineStart, lineEnd, posMap, totalDuration, totalChars) {
  // Find first VTT entry overlapping lineStart
  let startMs = null;
  let endMs   = null;

  for (const p of posMap) {
    const pEnd = p.pos + p.len;
    // This entry overlaps our line range
    if (pEnd > lineStart && p.pos < lineEnd) {
      if (startMs === null) startMs = p.startMs;
      endMs = p.endMs;
    }
    if (p.pos >= lineEnd) break;
  }

  // Fallback: proportional by character position
  if (startMs === null) startMs = Math.round((lineStart / totalChars) * totalDuration);
  if (endMs === null)   endMs   = Math.round((lineEnd   / totalChars) * totalDuration);

  return { startMs, endMs };
}

// ─── Main logic ───────────────────────────────────────────────────────────────

function buildSubtitles(narration, vttEntries) {
  const { text: fullText, emphases } = narration;

  // Split narration into lines; filter out empty lines
  const rawLines = fullText.split('\n');
  const lines = [];
  let charOffset = 0;

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    // Find the actual position of this line in fullText (accounting for \n)
    const linePos = fullText.indexOf(raw, charOffset);
    if (linePos === -1) {
      charOffset += raw.length + 1;
      continue;
    }
    charOffset = linePos + raw.length + 1;

    if (!trimmed) continue; // skip empty lines

    lines.push({
      text: trimmed,
      posStart: linePos + (raw.length - raw.trimStart().length), // skip leading spaces
      posEnd:   linePos + raw.length - (raw.length - raw.trimEnd().length),
    });
  }

  if (lines.length === 0) return [];

  // Compute total duration
  const totalDuration = vttEntries.length > 0
    ? vttEntries[vttEntries.length - 1].endMs
    : 0;
  const totalChars = fullText.length || 1;

  // Build position→ms map from VTT
  const posMap = vttEntries.length > 0 ? buildPosMap(fullText, vttEntries) : [];

  // Build subtitle entries
  const subtitles = [];
  for (const line of lines) {
    const { startMs, endMs } = findTimingForRange(
      line.posStart, line.posEnd, posMap, totalDuration, totalChars
    );
    const lineEmphases = mapEmphases(line.text, emphases, line.posStart);

    subtitles.push({
      text: line.text,
      startMs,
      endMs,
      emphases: lineEmphases,
    });
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

let vttEntries = [];
if (fs.existsSync(vttPath)) {
  vttEntries = parseVTT(fs.readFileSync(vttPath, 'utf-8'));
} else {
  console.warn(`[measure-subtitle] VTT file not found: ${vttPath} — using proportional timing`);
}

const subtitles = buildSubtitles(block.narration, vttEntries);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(subtitles, null, 2), 'utf-8');
console.log(`[measure-subtitle] ${blockId}: ${subtitles.length} subtitle lines → ${outPath}`);
