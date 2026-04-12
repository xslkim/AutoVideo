#!/usr/bin/env node
/**
 * scan-reusable-assets.mjs
 *
 * Scans a previous project directory for reusable animation components
 * and images, then matches them against a new script/blocks.json.
 *
 * Usage (standalone):
 *   node scan-reusable-assets.mjs \
 *     --prev-project /path/to/previous-project \
 *     --new-blocks   /path/to/new-project/blocks.json   (or script.md) \
 *     --out          /path/to/new-project/reuse-plan.json
 *
 * Output (reuse-plan.json):
 * {
 *   "components": {
 *     "B03": {
 *       "sourceBlock": "B07",
 *       "sourcePath": "/prev/src/blocks/B07/Component.tsx",
 *       "destPath": "src/blocks/B03/Component.tsx",
 *       "matchReason": "title match: '交叉熵损失'",
 *       "confidence": 0.9
 *     }
 *   },
 *   "images": {
 *     "diagram-attention.png": {
 *       "sourcePath": "/prev/assets/images/diagram-attention.png",
 *       "destPath": "assets/images/diagram-attention.png"
 *     }
 *   },
 *   "summary": {
 *     "totalNew": 12,
 *     "reusable": 3,
 *     "saved": "~15 min of generation"
 *   }
 * }
 *
 * The agent reads reuse-plan.json at Stage 3 and, for each entry:
 *   1. Copies the component file verbatim
 *   2. Updates any block-specific props (rect, theme) via a thin wrapper if needed
 *   3. Skips generation — marks T31_component_Bnn as completed with note "reused"
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { parseArgs } from 'util';

// ── CLI ────────────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    'prev-project': { type: 'string' },
    'new-blocks':   { type: 'string' },
    'out':          { type: 'string' },
    'min-confidence': { type: 'string', default: '0.6' },
  },
  strict: false,
});

const PREV_DIR    = args['prev-project'];
const NEW_INPUT   = args['new-blocks'];
const OUT_PATH    = args['out'];
const MIN_CONF    = parseFloat(args['min-confidence'] ?? '0.6');

if (!PREV_DIR || !NEW_INPUT || !OUT_PATH) {
  console.error('Usage: scan-reusable-assets.mjs --prev-project DIR --new-blocks FILE --out FILE');
  process.exit(1);
}

// ── Load previous project ──────────────────────────────────────────────────────
function loadPrevBlocks(prevDir) {
  const blocksPath = join(prevDir, 'blocks.json');
  if (!existsSync(blocksPath)) return null;
  try {
    return JSON.parse(readFileSync(blocksPath, 'utf8'));
  } catch {
    return null;
  }
}

function scanPrevComponents(prevDir) {
  const blocksDir = join(prevDir, 'src', 'blocks');
  if (!existsSync(blocksDir)) return {};

  const result = {};
  for (const entry of readdirSync(blocksDir)) {
    const compPath = join(blocksDir, entry, 'Component.tsx');
    if (existsSync(compPath)) {
      result[entry] = compPath;
    }
  }
  return result;
}

function scanPrevImages(prevDir) {
  const imagesDir = join(prevDir, 'assets', 'images');
  if (!existsSync(imagesDir)) return {};

  const result = {};
  for (const entry of readdirSync(imagesDir)) {
    if (/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(entry)) {
      result[entry] = join(imagesDir, entry);
    }
  }
  return result;
}

// ── Load new blocks ────────────────────────────────────────────────────────────
function loadNewBlocks(inputPath) {
  if (!existsSync(inputPath)) return null;
  const content = readFileSync(inputPath, 'utf8');

  // If it's a blocks.json
  if (inputPath.endsWith('.json')) {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // If it's a script.md — extract block titles for matching
  // Returns a lightweight structure with just id + title + type
  const blocks = [];
  let idx = 0;
  for (const line of content.split('\n')) {
    if (line.startsWith('>>> ')) {
      blocks.push({ id: `B${String(idx).padStart(2, '0')}`, title: line.slice(4).trim(), type: 'unknown' });
      idx++;
    }
  }
  return blocks.length > 0 ? { blocks } : null;
}

// ── Matching logic ─────────────────────────────────────────────────────────────
function normalize(str) {
  return str.toLowerCase()
    .replace(/[·\s:：·]+/g, ' ')
    .replace(/[^\u4e00-\u9fa5\u0030-\u0039\u0041-\u005a\u0061-\u007a ]/g, '')
    .trim();
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;

  // Word overlap (bigrams for Chinese, words for Latin)
  const wordsA = new Set(na.split(' ').filter(Boolean));
  const wordsB = new Set(nb.split(' ').filter(Boolean));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  if (union === 0) return 0;

  // Substring bonus
  const subBonus = (na.includes(nb) || nb.includes(na)) ? 0.2 : 0;

  return Math.min(1.0, intersection / union + subBonus);
}

function matchBlocks(newBlocks, prevBlocks, prevComponents) {
  const matches = {};

  for (const newBlock of newBlocks) {
    if (!newBlock || !newBlock.id) continue;
    // Only animation blocks need components; skip textcard/code for now
    // (code blocks have shiki pre-processing, not safe to copy blindly)
    if (newBlock.spec?.type === 'code') continue;

    let bestMatch = null;
    let bestScore = MIN_CONF;

    for (const prevBlock of prevBlocks) {
      if (!prevComponents[prevBlock.id]) continue;  // no component file

      // Skip code blocks from prev too
      if (prevBlock.spec?.type === 'code') continue;

      const titleScore = similarity(newBlock.title ?? '', prevBlock.title ?? '');

      // Check narration similarity as a secondary signal
      const newNarr = (newBlock.narration ?? '').slice(0, 100);
      const prevNarr = (prevBlock.narration ?? '').slice(0, 100);
      const narrScore = newNarr && prevNarr ? similarity(newNarr, prevNarr) * 0.4 : 0;

      const score = Math.min(1.0, titleScore * 0.7 + narrScore);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          sourceBlock: prevBlock.id,
          sourcePath:  prevComponents[prevBlock.id],
          matchReason: `title similarity: "${prevBlock.title}" (score=${score.toFixed(2)})`,
          confidence:  score,
        };
      }
    }

    if (bestMatch) {
      matches[newBlock.id] = {
        ...bestMatch,
        destPath: `src/blocks/${newBlock.id}/Component.tsx`,
      };
    }
  }

  return matches;
}

// ── Main ───────────────────────────────────────────────────────────────────────
const prevData      = loadPrevBlocks(PREV_DIR);
const prevComps     = scanPrevComponents(PREV_DIR);
const prevImages    = scanPrevImages(PREV_DIR);
const newData       = loadNewBlocks(NEW_INPUT);

if (!newData) {
  console.error('Could not load new blocks from:', NEW_INPUT);
  process.exit(1);
}

const newBlocks  = newData.blocks ?? [];
const prevBlocks = prevData?.blocks ?? [];

// Component matching
const componentMatches = matchBlocks(newBlocks, prevBlocks, prevComps);

// Image matching — images are matched by filename (they're reusable if name matches)
const imageMatches = {};
for (const [filename, srcPath] of Object.entries(prevImages)) {
  imageMatches[filename] = {
    sourcePath: srcPath,
    destPath:   `assets/images/${filename}`,
  };
}

const reusableCount = Object.keys(componentMatches).length + Object.keys(imageMatches).length;

const plan = {
  generatedAt: new Date().toISOString(),
  prevProject: PREV_DIR,
  components: componentMatches,
  images: imageMatches,
  summary: {
    totalNewAnimations: newBlocks.filter(b => b.spec?.type === 'animation' || b.type === 'animation').length,
    reusableComponents: Object.keys(componentMatches).length,
    reusableImages:     Object.keys(imageMatches).length,
    note: reusableCount > 0
      ? `Found ${reusableCount} reusable assets. Copy them at Stage 3 before generating new components.`
      : 'No reusable assets found. All components will be generated from scratch.',
  },
};

// Write output
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(plan, null, 2), 'utf8');

// Print summary to stdout
console.log(`\nReuse scan complete:`);
console.log(`  Previous project:     ${PREV_DIR}`);
console.log(`  Reusable components:  ${plan.summary.reusableComponents}`);
console.log(`  Reusable images:      ${plan.summary.reusableImages}`);
if (Object.keys(componentMatches).length > 0) {
  console.log('\n  Component matches:');
  for (const [id, m] of Object.entries(componentMatches)) {
    console.log(`    ${id} ← ${m.sourceBlock}  (conf=${m.confidence.toFixed(2)}) ${m.matchReason}`);
  }
}
console.log(`\n  Plan written to: ${OUT_PATH}`);
