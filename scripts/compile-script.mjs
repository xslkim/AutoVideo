#!/usr/bin/env node
/**
 * AutoVideo v2 — Stage 1 compiler
 * Converts v2 markdown script → blocks.json
 *
 * Usage:
 *   node compile-script.mjs <script.md> <out-blocks.json> [<aspect>]
 *
 * aspect: 16:9 (default) | 9:16 | 1:1
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Rect presets ────────────────────────────────────────────────────────────

// NOTE: all presets keep y + h ≤ 0.80 to avoid overlapping the subtitle strip (y≥0.82).
const RECT_PRESETS = {
  'fullscreen':   { x: 0,    y: 0,    w: 1,    h: 1    },
  // safe: near-full usable area, leaves subtitle gap at bottom
  'safe':         { x: 0.03, y: 0.03, w: 0.94, h: 0.77 },
  // center-70: medium card — replaced old center-60 which was too small
  'center-60':    { x: 0.10, y: 0.08, w: 0.80, h: 0.70 },
  // center-80: large card, almost full width
  'center-80':    { x: 0.04, y: 0.04, w: 0.92, h: 0.76 },
  // split layouts
  'left-half':    { x: 0.02, y: 0.05, w: 0.47, h: 0.73 },
  'right-half':   { x: 0.51, y: 0.05, w: 0.47, h: 0.73 },
  'top-half':     { x: 0.04, y: 0.03, w: 0.92, h: 0.38 },
  'bottom-half':  { x: 0.04, y: 0.43, w: 0.92, h: 0.37 },
  // code: slightly wider than before
  'code-left':    { x: 0.01, y: 0.03, w: 0.57, h: 0.77 },
  'code-right':   { x: 0.42, y: 0.03, w: 0.57, h: 0.77 },
};

// ─── Animation enter/exit defaults by type ───────────────────────────────────

const TYPE_ENTER_DEFAULTS = {
  image:     'blur-in',
  code:      'zoom-in',
  animation: 'fade',
  icon:      'scale',
  lottie:    'fade',
  video:     'fade',
  textcard:  'fade-up',
};

const TYPE_EXIT_DEFAULTS = {
  image:     'fade',
  code:      'fade',
  animation: 'fade',
  icon:      'fade',
  lottie:    'fade',
  video:     'fade',
  textcard:  'fade-down',
};

// ─── Resolution table ─────────────────────────────────────────────────────────

const RESOLUTIONS = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1':  { w: 1080, h: 1080 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRect(val) {
  if (!val) return RECT_PRESETS['safe'];
  const trimmed = val.trim();
  if (RECT_PRESETS[trimmed]) return { ...RECT_PRESETS[trimmed] };
  // Try JSON object: {x:0.1,y:0.1,w:0.8,h:0.8}
  try {
    const obj = JSON.parse(trimmed.replace(/([a-z]+):/g, '"$1":'));
    if ('x' in obj && 'y' in obj && 'w' in obj && 'h' in obj) return obj;
  } catch {}
  console.warn(`[WARN] Unknown rect preset: "${trimmed}", using "safe"`);
  return { ...RECT_PRESETS['safe'] };
}

function resolveAnimation(preset, type, isEnter, duration) {
  let p = preset;
  if (!p || p === 'auto') {
    p = isEnter ? (TYPE_ENTER_DEFAULTS[type] ?? 'fade') : (TYPE_EXIT_DEFAULTS[type] ?? 'fade');
  }
  return {
    preset: p,
    duration: duration ?? (isEnter ? 0.5 : 0.3),
    easing: isEnter ? 'ease-out' : 'ease-in',
  };
}

/** Strip markdown bold markers and return { plain, emphases } */
function parseEmphases(text) {
  const emphases = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '*' && text[i+1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        const word = text.slice(i + 2, end);
        emphases.push({ start: plain.length, end: plain.length + word.length, word });
        plain += word;
        i = end + 2;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  return { plain, emphases };
}

/** Parse pause hints from text, return { cleanText, pauseAfter } */
function parsePauses(text) {
  let pauseAfter = 0;
  // （长停顿）→ 2s, （停顿）/（pause）→ 1s
  const cleaned = text
    .replace(/（长停顿）/g, () => { pauseAfter += 2; return ''; })
    .replace(/（停顿）/g, () => { pauseAfter += 1; return ''; })
    .replace(/\(pause\)/gi, () => { pauseAfter += 1; return ''; });
  return { cleanText: cleaned.trim(), pauseAfter };
}

/** Extract blockquote lines ("> ...") from text, return { lines, rest } */
function extractBlockquotes(text) {
  const resultLines = [];
  const restLines = [];
  for (const line of text.split('\n')) {
    if (/^\s*>+\s*/.test(line)) {
      resultLines.push(line.replace(/^\s*>+\s*/, '').trim());
    } else {
      restLines.push(line);
    }
  }
  return { quotedLines: resultLines, rest: restLines.join('\n') };
}

/** Parse @range: "30-50" or "30" → [30, 50] | null */
function parseRange(val) {
  if (!val) return null;
  const m = val.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!m) return null;
  return [parseInt(m[1]), m[2] ? parseInt(m[2]) : parseInt(m[1])];
}

/** Parse explicit duration like "4s", "4", "3.5s" → number (seconds) */
function parseDuration(val) {
  if (!val) return null;
  return parseFloat(val.replace(/s$/, ''));
}

// ─── YAML frontmatter parser (no deps) ───────────────────────────────────────

function parseFrontmatter(src) {
  const lines = src.split('\n');
  if (lines[0].trim() !== '---') return { meta: {}, body: src };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) return { meta: {}, body: src };
  const yamlLines = lines.slice(1, endIdx);
  const meta = {};
  for (const line of yamlLines) {
    const m = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const body = lines.slice(endIdx + 1).join('\n');
  return { meta, body };
}

// ─── Build content spec ───────────────────────────────────────────────────────

function buildContentSpec(type, directives, narrationRaw, title) {
  switch (type) {
    case 'image': {
      const { quotedLines, rest } = extractBlockquotes(narrationRaw);
      return {
        spec: {
          src: directives['src'] ?? directives['source'] ?? '',
          source: directives['src'] ? 'user' : 'ai-generated',
          fit: directives['fit'] ?? 'contain',
          ...(directives['ken-burns'] ? { kenBurns: { from: 1.0, to: 1.08, anchor: 'center' } } : {}),
          altText: quotedLines.join(' ') || title,
        },
        narrationRest: rest,
      };
    }

    case 'code': {
      const highlights = (directives['highlight'] || directives['highlights'] || '')
        .split(',').filter(Boolean).map(s => ({ line: parseInt(s.trim()), color: 'accent' }));
      return {
        spec: {
          source: directives['source'] ?? directives['src'] ?? '',
          range: parseRange(directives['range']),
          language: directives['language'] ?? directives['lang'] ?? 'auto',
          theme: 'from-global',
          reveal: {
            mode: directives['reveal'] ?? 'line-by-line',
            linesPerSecond: parseInt(directives['speed'] ?? '3'),
            cursor: directives['cursor'] !== 'false',
          },
          highlights: highlights.filter(h => !isNaN(h.line)),
          annotations: [],
        },
        narrationRest: narrationRaw,
      };
    }

    case 'animation': {
      // Extract inline timeline hints: [Ns: description] or [N.Ns: description]
      // These are visual cues for the AI animator, NOT narration for TTS.
      const { timeline: inlineTimeline, narrationOnly } = extractInlineTimeline(narrationRaw);
      const timeline = inlineTimeline.length > 0
        ? inlineTimeline
        : parseTimeline(directives['timeline'] ?? '');

      return {
        spec: {
          // Keep full raw text (including [Ns:] hints) as description for AI component generation
          description: `[Block: ${title}]\n${narrationRaw.trim()}`,
          timeline,
          componentPath: null, // Filled in by Stage 3
        },
        // TTS only receives the actual spoken narration (no [Ns:] lines)
        narrationRest: narrationOnly,
      };
    }

    case 'icon': {
      const iconName = directives['icon'] ?? directives['src'] ?? 'lucide:circle';
      return {
        spec: {
          name: iconName,
          size: parseFloat(directives['size'] ?? '0.3'),
          color: directives['color'] ?? 'accent',
          stroke: parseFloat(directives['stroke'] ?? '2'),
          anim: directives['anim'] ?? 'none',
        },
        narrationRest: narrationRaw,
      };
    }

    case 'lottie': {
      return {
        spec: {
          src: directives['src'] ?? directives['source'] ?? '',
          loop: directives['loop'] !== 'false',
          speed: parseFloat(directives['speed'] ?? '1.0'),
        },
        narrationRest: narrationRaw,
      };
    }

    case 'video': {
      return {
        spec: {
          src: directives['src'] ?? directives['source'] ?? '',
          muted: directives['muted'] !== 'false',
          startTime: parseFloat(directives['start'] ?? '0'),
          speed: parseFloat(directives['speed'] ?? '1.0'),
        },
        narrationRest: narrationRaw,
      };
    }

    case 'textcard':
    default: {
      const { quotedLines, rest } = extractBlockquotes(narrationRaw);
      // Also extract # heading lines as card content
      const restLines = rest.split('\n');
      const headingLines = [];
      const nonHeadingLines = [];
      for (const line of restLines) {
        const h = line.match(/^#{1,3}\s+(.+)/);
        if (h) headingLines.push({ text: h[1], style: 'hero' });
        else nonHeadingLines.push(line);
      }
      const allDisplayLines = [
        ...headingLines,
        ...quotedLines.map(l => ({ text: l, style: directives['style'] ?? 'body' })),
      ];
      return {
        spec: {
          lines: allDisplayLines.length > 0
            ? allDisplayLines
            : [{ text: title, style: 'hero' }],
          align: directives['align'] ?? 'center',
          background: directives['background'] ?? 'theme.bg-deep',
        },
        narrationRest: nonHeadingLines.join('\n'),
      };
    }
  }
}

/** Parse simple timeline string "0s: do thing; 2s: do other" */
/**
 * Extract inline timeline hints from animation block body text.
 *
 * Inline format (one or more lines):
 *   [0s: 屏幕中央显示大标题 "GPT = ?"，带脉冲动画]
 *   [2.5s: 标题变为 "GPT = 下一个词预测器"，
 *    文字高亮闪烁后稳定]
 *
 * Returns:
 *   timeline    — array of { at: number, do: string }
 *   narrationOnly — the text with all [Ns: ...] blocks removed
 */
function extractInlineTimeline(text) {
  // Find all [Ns: ...] blocks using balanced-bracket counting,
  // so that nested brackets like [4, 12, 12, 0] inside descriptions work correctly.
  const startRe = /\[(\d+(?:\.\d+)?)s:/g;
  const found = [];
  let m;

  while ((m = startRe.exec(text)) !== null) {
    const at       = parseFloat(m[1]);
    const bodyStart = m.index + m[0].length;
    let depth = 1, i = bodyStart;
    while (i < text.length && depth > 0) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') depth--;
      i++;
    }
    const body = text.slice(bodyStart, i - 1).trim().replace(/\n[ \t]*/g, ' ');
    found.push({ at, do: body, start: m.index, end: i });
  }

  // Build narration-only by removing found ranges
  const parts = [];
  let pos = 0;
  for (const f of found) {
    if (f.start > pos) parts.push(text.slice(pos, f.start));
    pos = f.end;
  }
  parts.push(text.slice(pos));

  const narrationOnly = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  return { timeline: found.map(({ at, do: d }) => ({ at, do: d })), narrationOnly };
}

function parseTimeline(val) {
  if (!val) return [];
  return val.split(';').map(s => {
    const m = s.trim().match(/^(\d+(?:\.\d+)?)s?\s*[:：]\s*(.+)$/);
    if (!m) return null;
    return { at: parseFloat(m[1]), do: m[2].trim() };
  }).filter(Boolean);
}

/** Build narration object from raw text */
function buildNarration(rawText) {
  const { cleanText, pauseAfter } = parsePauses(rawText);
  const { plain, emphases } = parseEmphases(cleanText);
  return {
    text: plain.trim(),
    emphases,
    hints: {
      pauseAfter,
      rate: 1.0,
      style: 'neutral',
    },
  };
}

// ─── Main compiler ────────────────────────────────────────────────────────────

function compile(src, cliMeta = {}) {
  // CLI meta overrides everything; frontmatter is still parsed for backward compat
  const { meta: fileMeta, body } = parseFrontmatter(src);

  const mergedMeta = { ...fileMeta, ...Object.fromEntries(
    Object.entries(cliMeta).filter(([, v]) => v !== undefined && v !== '')
  )};

  const finalAspect = mergedMeta.aspect ?? '16:9';
  const finalResolution = RESOLUTIONS[finalAspect] ?? RESOLUTIONS['16:9'];

  // Split body by >>> markers
  const rawBlocks = body.split(/^>>>\s*/m);

  // rawBlocks[0] is pre-first-block text → IGNORED (blocks-only input)
  // rawBlocks[1..] each start with the block title on first line

  const blocks = [];
  let blockIdx = 0;

  for (let i = 0; i < rawBlocks.length; i++) {
    const chunk = rawBlocks[i];
    if (!chunk.trim()) continue;

    // Skip pre-block text (anything before the first >>> marker)
    if (i === 0) continue;

    const lines = chunk.split('\n');
    const title = lines[0].trim();
    const bodyLines = lines.slice(1);
    if (!title) continue;

    // Parse @directives
    const directives = {};
    let directivesEnd = 0;
    for (let j = 0; j < bodyLines.length; j++) {
      const line = bodyLines[j];
      const dm = line.match(/^@(\w[\w-]*)\s*:\s*(.*)$/);
      if (dm) {
        directives[dm[1].toLowerCase()] = dm[2].trim();
        directivesEnd = j + 1;
      } else if (line.trim() === '' && directivesEnd > 0) {
        break;
      } else if (!line.trim() && directivesEnd === 0) {
        // leading blank lines before directives - skip
      } else if (directivesEnd === 0 && !line.startsWith('@')) {
        break; // no directives section
      }
    }

    // Remaining lines after directives (skip leading blank line separator)
    let contentLines = bodyLines.slice(directivesEnd);
    if (contentLines.length > 0 && contentLines[0].trim() === '') {
      contentLines = contentLines.slice(1);
    }
    const narrationRaw = contentLines.join('\n');

    // Determine block type
    const type = (directives['type'] ?? 'animation').toLowerCase();

    // Build content spec
    const { spec: contentSpec, narrationRest } = buildContentSpec(type, directives, narrationRaw, title);

    // Parse narration
    const narration = buildNarration(narrationRest);

    // Explicit duration (for no-narration blocks)
    const explicitDuration = parseDuration(directives['duration']);

    const id = `B${String(blockIdx).padStart(2, '0')}`;
    blockIdx++;

    const block = {
      id,
      title,
      narration,
      visual: {
        rect: parseRect(directives['rect']),
        enter: resolveAnimation(directives['enter'], type, true, parseDuration(directives['enter-duration'])),
        content: { type, spec: contentSpec },
        exit:  resolveAnimation(directives['exit'],  type, false, parseDuration(directives['exit-duration'])),
      },
      // timing filled in by Stage 2
      timing: {
        audioPath: null,
        vttPath: null,
        ttsDuration: null,
        enterDuration: null,
        holdDuration: explicitDuration ?? null,
        exitDuration: null,
        totalDuration: null,
        startFrame: null,
        frames: null,
        provider: null,
      },
      // subtitles filled in by Stage 2 (subtitle-split)
      subtitles: [],
      artifacts: {
        componentPath: null,
        assetFiles: [],
        thumbnailPath: null,
      },
      status: {
        tts: narration.text.trim() ? 'pending' : 'skipped',
        component: 'pending',
        render: 'pending',
      },
    };

    blocks.push(block);
  }

  if (blocks.length === 0) {
    throw new Error('No blocks parsed from script. Check the markdown format (>>> markers required).');
  }

  return {
    version: '2.0',
    meta: {
      title:      mergedMeta.title ?? 'Untitled',
      aspect:     finalAspect,
      resolution: finalResolution,
      fps:        parseInt(mergedMeta.fps ?? '30'),
      theme:      mergedMeta.theme ?? 'dark-code',
      voice:      mergedMeta.voice ?? 'zh-CN-YunxiNeural',
    },
    blocks,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

// ── Parse CLI args ──
import { parseArgs } from 'util';

const { values: cliArgs, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    title:  { type: 'string' },
    aspect: { type: 'string' },
    theme:  { type: 'string' },
    voice:  { type: 'string' },
    fps:    { type: 'string' },
  },
  allowPositionals: true,
  strict: false,
});

const scriptPath = positionals[0];
const outPath    = positionals[1];

if (!scriptPath || !outPath) {
  console.error('Usage: node compile-script.mjs <script.md> <blocks.json> [--title T] [--aspect 16:9] [--theme dark-code] [--voice V]');
  process.exit(1);
}

if (!fs.existsSync(scriptPath)) {
  console.error(`ERROR: Script file not found: ${scriptPath}`);
  process.exit(1);
}

try {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  const result = compile(src, cliArgs);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`[compile-script] OK: ${result.blocks.length} blocks → ${outPath}`);
  console.log(`  Title: ${result.meta.title}`);
  console.log(`  Aspect: ${result.meta.aspect} (${result.meta.resolution.w}×${result.meta.resolution.h})`);
  console.log(`  Blocks:`);
  for (const b of result.blocks) {
    const hasNarr = b.narration.text.trim().length > 0 ? '🎙' : '🔇';
    console.log(`    ${b.id}  ${hasNarr}  [${b.visual.content.type}]  ${b.title}`);
  }
} catch (err) {
  console.error(`[compile-script] FAILED: ${err.message}`);
  process.exit(1);
}
