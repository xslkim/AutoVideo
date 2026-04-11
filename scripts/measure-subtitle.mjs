#!/usr/bin/env node
/**
 * AutoVideo v2 — Subtitle splitter (Stage 2 helper)
 *
 * Reads a block's narration text + VTT word timestamps,
 * splits into single-line subtitle segments that fit within
 * the safe-area pixel width using Canvas text measurement.
 *
 * Usage:
 *   node measure-subtitle.mjs <blocks.json> <block-id> <vtt-file> <out-subtitles.json>
 *
 * Output: JSON array of SubtitleEntry (see block.schema.json)
 *
 * Fallback: if canvas is not available, uses char-count estimation.
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUBTITLE_SAFE_AREA_W_RATIO = 0.9;   // fraction of video width
const SUBTITLE_PADDING_PX = 40;            // left+right combined
const SUBTITLE_FONT_SIZE = {
  '16:9': 48,
  '9:16': 40,
  '1:1':  44,
};
const CHAR_WIDTH_ESTIMATE = {
  // fallback: chars per line when canvas unavailable
  '16:9': 22,
  '9:16': 14,
  '1:1':  17,
};

// ─── VTT parser ───────────────────────────────────────────────────────────────

function parseVTT(vttContent) {
  const entries = [];
  const lines = vttContent.split('\n');
  let i = 0;
  while (i < lines.length) {
    const timingLine = lines[i];
    const tm = timingLine.match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (tm) {
      const startMs = vttTimeToMs(tm[1]);
      const endMs   = vttTimeToMs(tm[2]);
      // Collect text lines
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

// ─── Canvas measurement (optional) ────────────────────────────────────────────

let canvasAvailable = false;
let createCanvas;

try {
  const canvasModule = await import('canvas');
  createCanvas = canvasModule.createCanvas;
  canvasAvailable = true;
} catch {
  // canvas not installed — will use char-count fallback
}

function createMeasurer(fontFamily, fontSize) {
  if (!canvasAvailable) return null;
  const cv = createCanvas(1, 1);
  const ctx = cv.getContext('2d');
  ctx.font = `${fontSize}px "${fontFamily}", "Noto Sans SC", sans-serif`;
  return (text) => ctx.measureText(text).width;
}

function estimateWidth(text, aspect) {
  // Fallback: CJK chars = 1 unit, ASCII = 0.5 unit
  let units = 0;
  for (const ch of text) {
    units += ch.charCodeAt(0) > 0x2E7F ? 1 : 0.5;
  }
  const limit = CHAR_WIDTH_ESTIMATE[aspect] ?? 20;
  // Return a normalized value vs limit
  return (units / limit) * 100; // percentage of limit
}

// ─── Splitter ─────────────────────────────────────────────────────────────────

/** Break text into segments that fit maxPx, aligned to word/punctuation boundaries */
function splitToLines(text, maxPx, measureFn, aspect) {
  // Punctuation-preferred split points (after these chars)
  const BREAK_AFTER = /[，。！？、；,.!?;]/;

  const segments = [];
  let current = '';

  const fits = (s) => {
    if (measureFn) return measureFn(s) <= maxPx;
    return estimateWidth(s, aspect) <= 100;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const candidate = current + ch;

    if (fits(candidate)) {
      current = candidate;
      // If at a natural break point and near the limit, consider splitting
      if (BREAK_AFTER.test(ch) && !fits(current + (text[i+1] ?? ''))) {
        // We're at a good break point and the next char won't fit — cut here
        if (current.trim()) segments.push(current.trim());
        current = '';
      }
    } else {
      // Doesn't fit — look back for a break point
      let cutAt = -1;
      for (let j = current.length - 1; j >= Math.max(0, current.length - 8); j--) {
        if (BREAK_AFTER.test(current[j])) { cutAt = j + 1; break; }
      }
      if (cutAt > 0) {
        segments.push(current.slice(0, cutAt).trim());
        current = current.slice(cutAt) + ch;
      } else {
        // No nice break — hard cut at current
        if (current.trim()) segments.push(current.trim());
        current = ch;
      }
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

// ─── Map emphasis positions through split ─────────────────────────────────────

function mapEmphases(originalText, segmentText, globalEmphases, offset) {
  return globalEmphases
    .map(e => ({
      start: Math.max(0, e.start - offset),
      end:   Math.max(0, e.end   - offset),
    }))
    .filter(e => e.start < segmentText.length && e.end > 0)
    .map(e => ({
      start: Math.max(0, e.start),
      end:   Math.min(segmentText.length, e.end),
    }))
    .filter(e => e.start < e.end);
}

// ─── Main logic ───────────────────────────────────────────────────────────────

function buildSubtitles(narration, vttEntries, aspect, resolution) {
  const fontSize = SUBTITLE_FONT_SIZE[aspect] ?? 48;
  const maxPx = resolution.w * SUBTITLE_SAFE_AREA_W_RATIO - SUBTITLE_PADDING_PX;
  const measureFn = createMeasurer('Noto Sans SC', fontSize);

  if (!canvasAvailable) {
    console.warn('[measure-subtitle] canvas not available, using char-count estimation');
  }

  const { text: fullText, emphases } = narration;

  // Determine time ranges from VTT
  // VTT word-level entries: aggregate into character positions
  // Simple approach: map each segment to a time range by character proportion
  const totalDuration = vttEntries.length > 0
    ? vttEntries[vttEntries.length - 1].endMs
    : 0;

  // Split the full text into subtitle lines
  const lines = splitToLines(fullText, maxPx, measureFn, aspect);

  // Assign time ranges proportionally (we'll use VTT word-level later if available)
  const totalChars = fullText.length || 1;
  const subtitles = [];
  let charOffset = 0;

  for (const line of lines) {
    const lineStart = fullText.indexOf(line, charOffset);
    const lineEnd = lineStart + line.length;
    charOffset = lineEnd;

    const startMs = Math.round((lineStart / totalChars) * totalDuration);
    const endMs   = Math.round((lineEnd   / totalChars) * totalDuration);

    const lineEmphases = mapEmphases(fullText, line, emphases, lineStart);

    subtitles.push({
      text: line,
      startMs,
      endMs,
      emphases: lineEmphases,
    });
  }

  // Refine timing using VTT if available (word-level alignment)
  if (vttEntries.length > 0 && subtitles.length > 0) {
    refineWithVTT(subtitles, fullText, vttEntries);
  }

  return subtitles;
}

/** Refine subtitle startMs/endMs using VTT word timestamps */
function refineWithVTT(subtitles, fullText, vttEntries) {
  // Build a position→ms map from VTT
  let textPos = 0;
  const posMap = []; // {pos, ms}

  for (const entry of vttEntries) {
    const idx = fullText.indexOf(entry.text, textPos);
    if (idx !== -1) {
      posMap.push({ pos: idx, startMs: entry.startMs, endMs: entry.endMs });
      textPos = idx + entry.text.length;
    }
  }

  if (posMap.length === 0) return;

  const totalDuration = posMap[posMap.length - 1].endMs;

  for (const sub of subtitles) {
    // Find the first VTT entry that overlaps this subtitle's text position
    const subStart = fullText.indexOf(sub.text);
    const subEnd   = subStart + sub.text.length;

    const firstMatch = posMap.find(p => p.pos >= subStart);
    const lastMatch  = [...posMap].reverse().find(p => p.pos + (p.endMs - p.startMs) <= subEnd + 10);

    if (firstMatch) sub.startMs = firstMatch.startMs;
    if (lastMatch)  sub.endMs   = lastMatch.endMs;
  }
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

const subtitles = buildSubtitles(
  block.narration,
  vttEntries,
  blocks.meta.aspect,
  blocks.meta.resolution
);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(subtitles, null, 2), 'utf-8');
console.log(`[measure-subtitle] ${blockId}: ${subtitles.length} subtitle lines → ${outPath}`);
