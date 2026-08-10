/**
 * AutoVideo — pronunciation lint
 *
 * Scans compiled narration for Latin terms that no dictionary rule rewrote
 * and that look likely to be mispronounced by a Chinese TTS voice:
 * camelCase brands, ALL_CAPS acronyms, dotted file names, version strings,
 * and mixed alphanumeric identifiers.
 *
 * The lint never blocks the build — it prints suggested dict.md lines so a
 * suspicious reading is caught at compile time instead of by ear after
 * synthesis. Terms the heuristics cannot guess a reading for (person names,
 * brands with irregular readings) are marked `needsLLM` for
 * `autovideo dict suggest`.
 */

import type { Block } from "../types/script.js";
import { applyPronunciation, type PronunciationRule } from "./pronounce.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LintFinding {
  /** The uncovered term as it appears in ttsText */
  term: string;
  /** Number of narration lines containing the term */
  occurrences: number;
  /** Heuristic suggestion for the right-hand side, when one could be derived */
  suggestion?: string;
  /** True when no heuristic applies and `autovideo dict suggest` should handle it */
  needsLLM: boolean;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/**
 * A Latin token worth checking: letters and digits joined by `.`, `_`, `-`,
 * `/`, or `+` (so `llama.cpp`, `Q4_K_M`, `C/C++` are single tokens). At least
 * one letter is required.
 */
const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[._\-/+][A-Za-z0-9]+)*\+*/g;

/**
 * Two or more adjacent Capitalized words — likely a person or place name
 * ("Georgi Gerganov", "San Francisco"). TTS transliteration of these is the
 * least predictable case, so they're surfaced for the LLM suggester.
 */
const PROPER_NOUN = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b/g;

/** Matches when a rule — literal or regex — would rewrite this exact term. */
function ruleMatchesTerm(term: string, rules: PronunciationRule[]): boolean {
  return applyPronunciation(term, rules) !== term;
}

// ---------------------------------------------------------------------------
// Heuristic suggestions
// ---------------------------------------------------------------------------

/** "GGUF" → "G G U F" */
function spellOut(term: string): string {
  return term.split("").join(" ");
}

/** "PagedAttention" → "Paged Attention", "vLLM" → "v L L M" */
function splitCamel(term: string): string {
  return term
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/** Expand one separator-joined token: `llama.cpp` → `llama C plus plus`. */
function expandCompound(term: string): string | undefined {
  // X.cpp / X.ts / X.js / X.vue / X.py — file-like names
  const file = /^([A-Za-z][A-Za-z0-9]*)\.(cpp|py|ts|js|vue|rs|go|java|rb)$/i.exec(term);
  if (file) {
    const [, stem, ext] = file;
    const extReading: Record<string, string> = {
      cpp: "C plus plus",
      py: "py",
      ts: "T S",
      js: "J S",
      vue: "view",
      rs: "rust",
      go: "go",
      java: "java",
      rb: "ruby",
    };
    return `${stem} ${extReading[ext.toLowerCase()]}`;
  }

  // Version / quantization strings: Q4_K_M → Q 4 K M, V1_2 → V 1 2
  if (/^[A-Z]\d(_[A-Z0-9])+$/i.test(term)) {
    return term
      .replace(/([A-Za-z])(\d)/, "$1 $2") // split the leading letter from its digit
      .replace(/_/g, " ");
  }

  // Hyphenated or slashed compounds: TensorRT-LLM, C/C++
  if (/[-/]/.test(term)) {
    const parts = term.split(/[-/]/).filter(Boolean);
    const read = parts.map((p) =>
      /^[A-Z0-9]{2,}$/.test(p) ? spellOut(p) : /^[A-Z]/.test(p) && /[a-z]/.test(p) ? splitCamel(p) : p,
    );
    return read.join(" ");
  }

  return undefined;
}

/**
 * Best-effort reading for an uncovered term. Returns undefined when no
 * heuristic fits — those go to the LLM suggester.
 */
export function suggestReading(term: string): string | undefined {
  // Pure ALL_CAPS acronym (≥3 letters): GGUF, HTTP, KV
  if (/^[A-Z][A-Z0-9]{2,}$/.test(term)) return spellOut(term);

  // File-like / version / hyphenated compounds
  const compound = expandCompound(term);
  if (compound) return compound;

  // camelCase / PascalCase brand: PagedAttention → Paged Attention.
  // Only when the result still contains a lowercase letter — a split that
  // yields only single letters means it was really an acronym.
  if (/[a-z][A-Z]/.test(term)) {
    const split = splitCamel(term);
    if (split.split(" ").some((w) => w.length > 1)) return split;
  }

  return undefined;
}

/** Person-name-like: two or more capitalized words — leave to the LLM. */
export function looksLikeProperNoun(term: string): boolean {
  return /^[A-Z][a-z]+$/.test(term);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Collect suspicious uncovered Latin terms from all narration lines.
 * `blocks` are the already-compiled script blocks (so `speakText` is set);
 * a term counts as covered when any rule fires on it directly.
 */
export function lintPronunciation(blocks: Block[], rules: PronunciationRule[]): LintFinding[] {
  const counts = new Map<string, number>();

  for (const block of blocks) {
    for (const line of block.narration.lines) {
      // Multi-word proper nouns first so "Georgi Gerganov" is counted once
      // as a unit rather than as two standalone words.
      PROPER_NOUN.lastIndex = 0;
      for (const match of line.ttsText.matchAll(PROPER_NOUN)) {
        counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
      }

      LATIN_TOKEN.lastIndex = 0;
      for (const match of line.ttsText.matchAll(LATIN_TOKEN)) {
        const term = match[0];
        if (term.length < 2) continue;
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }

  const findings: LintFinding[] = [];
  for (const [term, occurrences] of counts) {
    if (ruleMatchesTerm(term, rules)) continue;

    // Plain lowercase or single capitalized English words ("server", "local")
    // read fine — only flag forms a Chinese voice is likely to mangle.
    const suspicious =
      /[._\-/+]/.test(term) || // compound: llama.cpp, Q4_K_M, C/C++
      /^[A-Z][A-Z0-9]{2,}$/.test(term) || // ALL_CAPS acronym
      /[a-z][A-Z]/.test(term) || // camelCase / PascalCase mix
      /\d/.test(term) || // contains digits: Q4, v2, ROS2
      /^[A-Z][a-z]+( [A-Z][a-z]+)+$/.test(term); // multi-word proper noun
    if (!suspicious) continue;

    const suggestion = suggestReading(term);
    findings.push({ term, occurrences, suggestion, needsLLM: suggestion === undefined });
  }

  // Most-used terms are the most damaging when misread — surface them first.
  findings.sort((a, b) => b.occurrences - a.occurrences);
  return findings;
}

/**
 * Render findings as a human-readable report, or null when there is nothing
 * to report. Suggested lines are ready to paste into dict.md.
 */
export function formatPronunciationLint(findings: LintFinding[]): string | null {
  if (findings.length === 0) return null;

  const lines = [
    `[pronounce] ${findings.length} 个未被词典覆盖的可疑词（按出现频次排序）:`,
    ...findings.map((f) => {
      const suggestion = f.suggestion
        ? `${f.term} => ${f.suggestion}`
        : `需要 LLM 建议: autovideo dict suggest`;
      return `  ${f.term} ×${f.occurrences}  ${suggestion}`;
    }),
    `把上面的行追加到 dict.md 后重新 build 即可生效。`,
  ];
  return lines.join("\n");
}
