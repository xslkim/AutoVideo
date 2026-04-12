#!/usr/bin/env node
/**
 * AutoVideo v2 — Stage 3 code preprocessor
 *
 * Reads source code files referenced in blocks.json (type: code),
 * applies shiki syntax highlighting, and writes tokenized lines back
 * into each block's spec.__lines field.
 *
 * Usage:
 *   node preprocess-code.mjs <blocks.json> <source-samples-dir>
 *
 * Modifies blocks.json in-place: adds spec.__lines to all code blocks.
 *
 * Token format:
 *   __lines: Array<{ raw: string; tokens: Array<{ text: string; color: string }> }>
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHighlighter } from 'shiki';

const SHIKI_THEME = 'github-dark';

// Map of file extension → shiki language id
const EXT_LANG_MAP = {
  '.py':   'python',
  '.js':   'javascript',
  '.ts':   'typescript',
  '.tsx':  'tsx',
  '.jsx':  'jsx',
  '.go':   'go',
  '.rs':   'rust',
  '.java': 'java',
  '.cpp':  'cpp',
  '.c':    'c',
  '.h':    'c',
  '.hpp':  'cpp',
  '.cs':   'csharp',
  '.rb':   'ruby',
  '.sh':   'bash',
  '.md':   'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml':  'yaml',
  '.toml': 'toml',
  '.sql':  'sql',
};

// ─── Tokenize with shiki ──────────────────────────────────────────────────────

async function tokenizeCode(code, language, highlighter) {
  const lines = code.split('\n');

  let tokens;
  try {
    const result = highlighter.codeToTokens(code, { lang: language, theme: SHIKI_THEME });
    tokens = result.tokens; // Array<Array<{ content: string; color: string }>>
  } catch {
    // Unknown language — return plain tokens
    return lines.map(raw => ({ raw, tokens: [{ text: raw, color: '#e6edf3' }] }));
  }

  return lines.map((raw, i) => {
    const lineTokens = (tokens[i] ?? []).map(t => ({
      text: t.content,
      color: t.color ?? '#e6edf3',
    }));
    return { raw, tokens: lineTokens.length > 0 ? lineTokens : [{ text: raw, color: '#e6edf3' }] };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [,, blocksPath, samplesDir] = process.argv;

if (!blocksPath || !samplesDir) {
  console.error('Usage: node preprocess-code.mjs <blocks.json> <source-samples-dir>');
  process.exit(1);
}

const blocksData = JSON.parse(fs.readFileSync(blocksPath, 'utf-8'));
const codeBlocks = blocksData.blocks.filter(b => b.visual?.content?.type === 'code');

if (codeBlocks.length === 0) {
  console.log('[preprocess-code] No code blocks found, nothing to do.');
  process.exit(0);
}

console.log(`[preprocess-code] Processing ${codeBlocks.length} code block(s)...`);

// Collect all languages needed
const langs = new Set(['python', 'javascript', 'typescript', 'bash', 'json']);
for (const block of codeBlocks) {
  const spec = block.visual.content.spec;
  const ext = path.extname(spec.source || '').toLowerCase();
  const lang = spec.language !== 'auto' ? spec.language : (EXT_LANG_MAP[ext] ?? 'text');
  if (lang && lang !== 'text') langs.add(lang);
}

const highlighter = await createHighlighter({
  themes: [SHIKI_THEME],
  langs: [...langs],
});

let modified = 0;
for (const block of blocksData.blocks) {
  if (block.visual?.content?.type !== 'code') continue;

  const spec = block.visual.content.spec;
  const sourceFile = spec.source;
  if (!sourceFile) {
    console.warn(`[preprocess-code] ${block.id}: no source file specified, skipping`);
    continue;
  }

  const srcPath = path.join(samplesDir, sourceFile);
  if (!fs.existsSync(srcPath)) {
    console.warn(`[preprocess-code] ${block.id}: source file not found: ${srcPath}`);
    continue;
  }

  const fullCode = fs.readFileSync(srcPath, 'utf-8');

  // Apply range if specified
  let codeSlice = fullCode;
  if (spec.range) {
    const allLines = fullCode.split('\n');
    const [start, end] = spec.range;
    codeSlice = allLines.slice(start - 1, end).join('\n');
  }

  const ext = path.extname(sourceFile).toLowerCase();
  const lang = (spec.language && spec.language !== 'auto')
    ? spec.language
    : (EXT_LANG_MAP[ext] ?? 'text');

  const lines = await tokenizeCode(codeSlice, lang, highlighter);
  spec.__lines = lines;
  modified++;

  const rangeStr = spec.range ? ` [${spec.range[0]}-${spec.range[1]}]` : '';
  console.log(`[preprocess-code] ${block.id}: ${sourceFile}${rangeStr} → ${lines.length} lines (lang: ${lang})`);
}

fs.writeFileSync(blocksPath, JSON.stringify(blocksData, null, 2), 'utf-8');
console.log(`[preprocess-code] Done. Modified ${modified} block(s) in ${blocksPath}`);

highlighter.dispose();
