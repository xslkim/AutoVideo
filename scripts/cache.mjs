#!/usr/bin/env node
/**
 * AutoVideo Global Asset Cache — Node.js utility (components + shiki)
 *
 * Cache layout:
 *   ~/.autovideo-cache/
 *     manifest.json
 *     components/{md5}.tsx
 *     shiki/{md5}.json
 *
 * Hash inputs:
 *   component — block title + full spec (all fields except narration/timing/subtitles)
 *               + actual source-file lines for code-type blocks
 *   shiki     — source file content at lines + lang + highlights + code-theme
 *
 * CLI usage:
 *   # Compute hash (prints hash to stdout)
 *   node cache.mjs hash --type component --block-json path/to/block.json [--source-dir ./src/data/source-samples]
 *   node cache.mjs hash --type shiki --source-file ./microgpt.py --range 153-172 \
 *                       --lang python --highlights 156,157,163 --code-theme github-dark
 *
 *   # Lookup (exits 0 + prints JSON on hit, exits 1 on miss)
 *   node cache.mjs lookup --hash abc123 --type component
 *
 *   # Store a generated file
 *   node cache.mjs store --hash abc123 --type component --file src/blocks/B03/Component.tsx \
 *                        --title "交叉熵" --project /home/ubuntu/teaching-video-xxx
 *   node cache.mjs store --hash abc123 --type shiki --file /tmp/shiki-out.json \
 *                        --title "训练循环代码" --project /home/ubuntu/teaching-video-xxx
 *
 *   # Show statistics
 *   node cache.mjs stats
 */

import { createHash }                                       from 'crypto';
import { readFileSync, writeFileSync, copyFileSync,
         existsSync, mkdirSync, readdirSync, statSync }    from 'fs';
import { join, resolve, dirname }                           from 'path';
import { homedir }                                          from 'os';
import { parseArgs }                                        from 'util';

const CACHE_DIR      = join(homedir(), '.autovideo-cache');
const MANIFEST_PATH  = join(CACHE_DIR, 'manifest.json');
const COMPONENTS_DIR = join(CACHE_DIR, 'components');
const SHIKI_DIR      = join(CACHE_DIR, 'shiki');

// ── Canonical JSON (sorted keys) for stable hashing ──────────────────────────

function sortedStringify(val) {
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(sortedStringify).join(',') + ']';
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + sortedStringify(val[k])).join(',') + '}';
}

function md5(str) {
  return createHash('md5').update(str, 'utf8').digest('hex');
}

// ── Hash computation ──────────────────────────────────────────────────────────

/**
 * Compute hash for a component block.
 * Excludes: narration, timing, subtitles (audio-only, don't affect visual).
 * Excludes: id (block id can differ across projects for same content).
 * For code blocks: also hashes actual source file lines (not just range params).
 */
function computeComponentHash(block, sourceDir) {
  const { title, spec } = block;

  // Build a canonical visual spec — omit fields that don't affect rendering
  const visualSpec = { ...spec };
  // narration is at block level, not in spec, but remove if somehow nested
  delete visualSpec.narration;

  const payload = { title, spec: visualSpec };

  // For code blocks: include actual source content (so changing source invalidates cache)
  if (spec?.type === 'code' && spec?.source && spec?.range && sourceDir) {
    const sourceFile = join(resolve(sourceDir), spec.source);
    if (existsSync(sourceFile)) {
      const lines = readFileSync(sourceFile, 'utf8').split('\n');
      const [rawStart, rawEnd] = String(spec.range).split('-').map(Number);
      const start = Math.max(1, rawStart || 1);
      const end   = rawEnd || start;
      payload._sourceContent = lines.slice(start - 1, end).join('\n');
    }
  }

  return md5(sortedStringify(payload));
}

/**
 * Compute hash for a shiki preprocessing result.
 */
function computeShikiHash({ sourceFile, range, lang, highlights, codeTheme }) {
  if (!existsSync(sourceFile)) {
    throw new Error(`Source file not found: ${sourceFile}`);
  }
  const lines = readFileSync(sourceFile, 'utf8').split('\n');
  const [rawStart, rawEnd] = String(range).split('-').map(Number);
  const start = Math.max(1, rawStart || 1);
  const end   = rawEnd || start;
  const content = lines.slice(start - 1, end).join('\n');

  const payload = {
    type: 'shiki',
    sourceContent: content,
    lang,
    highlights: (highlights || '').split(',').map(Number).filter(Boolean).sort((a, b) => a - b),
    codeTheme,
  };
  return md5(sortedStringify(payload));
}

// ── Manifest (simple read/write — Node.js is single-threaded per process) ────

function ensureDirs() {
  for (const d of [CACHE_DIR, COMPONENTS_DIR, SHIKI_DIR]) {
    mkdirSync(d, { recursive: true });
  }
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return { version: 1, entries: {} };
  try { return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); }
  catch { return { version: 1, entries: {} }; }
}

function writeManifest(manifest) {
  ensureDirs();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

function now() {
  return new Date().toISOString();
}

// ── Lookup ────────────────────────────────────────────────────────────────────

function lookup(hashVal, type) {
  let cachedFile;
  if (type === 'component') cachedFile = join(COMPONENTS_DIR, `${hashVal}.tsx`);
  else if (type === 'shiki') cachedFile = join(SHIKI_DIR,      `${hashVal}.json`);
  else throw new Error(`Unknown type: ${type}`);

  if (!existsSync(cachedFile)) return null;

  // Update hit count
  try {
    const manifest = readManifest();
    if (manifest.entries[hashVal]) {
      manifest.entries[hashVal].hitCount  = (manifest.entries[hashVal].hitCount || 0) + 1;
      manifest.entries[hashVal].lastHitAt = now();
      writeManifest(manifest);
    }
  } catch { /* best-effort */ }

  return { hit: true, file: cachedFile, type };
}

// ── Store ─────────────────────────────────────────────────────────────────────

function store(hashVal, type, srcFile, title, project) {
  ensureDirs();

  if (!existsSync(srcFile)) throw new Error(`Source file not found: ${srcFile}`);

  let destFile;
  if (type === 'component') destFile = join(COMPONENTS_DIR, `${hashVal}.tsx`);
  else if (type === 'shiki') destFile = join(SHIKI_DIR,     `${hashVal}.json`);
  else throw new Error(`Unknown type: ${type}`);

  copyFileSync(srcFile, destFile);

  const manifest = readManifest();
  manifest.entries[hashVal] = {
    type,
    title:     title || '',
    project:   project || '',
    createdAt: now(),
    hitCount:  0,
    lastHitAt: null,
    files:     type === 'component'
      ? { component: `components/${hashVal}.tsx` }
      : { shiki:     `shiki/${hashVal}.json`     },
  };
  writeManifest(manifest);
  return destFile;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats() {
  const manifest = readManifest();
  const entries = Object.entries(manifest.entries || {});
  const byType = {};
  let totalBytes = 0;

  for (const [hash, entry] of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;

    // Sum file sizes
    const files = Object.values(entry.files || {});
    for (const rel of files) {
      const abs = join(CACHE_DIR, rel);
      if (existsSync(abs)) {
        try { totalBytes += statSync(abs).size; } catch { /* ok */ }
      }
    }
  }

  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`AutoVideo cache: ${CACHE_DIR}`);
  console.log(`Total entries: ${entries.length}  (${mb} MB)`);
  for (const [type, count] of Object.entries(byType)) {
    const hits = entries
      .filter(([, e]) => e.type === type)
      .reduce((s, [, e]) => s + (e.hitCount || 0), 0);
    console.log(`  ${type.padEnd(12)} ${count} entries, ${hits} total hits`);
  }

  // Top 5 most-hit
  const sorted = entries.sort(([, a], [, b]) => (b.hitCount || 0) - (a.hitCount || 0)).slice(0, 5);
  if (sorted.length > 0) {
    console.log('\nTop reused:');
    for (const [hash, e] of sorted) {
      console.log(`  ${hash.slice(0, 8)}  ${e.type.padEnd(10)}  hits=${e.hitCount}  "${e.title}"`);
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const cmd  = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log('Usage: cache.mjs <hash|lookup|store|stats> [options]');
    process.exit(0);
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      type:        { type: 'string' },
      'block-json':{ type: 'string' },
      'source-dir':{ type: 'string' },
      'source-file':{ type: 'string' },
      range:       { type: 'string' },
      lang:        { type: 'string' },
      highlights:  { type: 'string', default: '' },
      'code-theme':{ type: 'string', default: 'github-dark' },
      hash:        { type: 'string' },
      file:        { type: 'string' },
      title:       { type: 'string', default: '' },
      project:     { type: 'string', default: '' },
    },
    strict: false,
  });

  if (cmd === 'hash') {
    const type = values.type;
    if (type === 'component') {
      if (!values['block-json']) { console.error('--block-json required'); process.exit(1); }
      const block = JSON.parse(readFileSync(values['block-json'], 'utf8'));
      const h = computeComponentHash(block, values['source-dir']);
      process.stdout.write(h + '\n');

    } else if (type === 'shiki') {
      const h = computeShikiHash({
        sourceFile: values['source-file'],
        range:      values.range,
        lang:       values.lang,
        highlights: values.highlights,
        codeTheme:  values['code-theme'],
      });
      process.stdout.write(h + '\n');

    } else {
      console.error('--type must be component or shiki'); process.exit(1);
    }

  } else if (cmd === 'lookup') {
    const { hash: hashVal, type } = values;
    if (!hashVal || !type) { console.error('--hash and --type required'); process.exit(1); }
    const result = lookup(hashVal, type);
    if (result) {
      console.log(JSON.stringify(result));
    } else {
      console.log(JSON.stringify({ hit: false }));
      process.exit(1);
    }

  } else if (cmd === 'store') {
    const { hash: hashVal, type, file, title, project } = values;
    if (!hashVal || !type || !file) { console.error('--hash, --type, --file required'); process.exit(1); }
    const dest = store(hashVal, type, file, title, project);
    console.log(`Stored: ${dest}`);

  } else if (cmd === 'stats') {
    stats();

  } else {
    console.error(`Unknown command: ${cmd}`); process.exit(1);
  }
}

main();
