/**
 * AutoVideo — Pronunciation dictionary
 *
 * Chinese narration in technical videos is full of Latin terms ("零偏 bias",
 * "Allan 方差", "cam0"). A cloned Chinese voice reads those inconsistently:
 * the same acronym can come out spelled, transliterated, or mangled depending
 * on the surrounding context. This module lets the author pin the reading of
 * such terms once per project.
 *
 * The rewritten string is used for synthesis only — subtitles keep the
 * original text, so nothing the viewer reads changes.
 *
 * Dictionary file: `dict.md` next to `meta.md` in the project directory.
 *
 *   # comments start with '#'
 *   IMU        => I M U
 *   cam0       => cam 零
 *   /(\d+)fps/i => $1 帧每秒
 *
 * A left-hand side wrapped in slashes is a regular expression (with optional
 * trailing flags); everything else is a literal.
 *
 * ── Inline pinyin mode (CosyVoice3 pronunciation inpainting) ─────────────
 *
 * For Chinese polyphones, "replace with a homophone" (回调 => 回掉) changes
 * the text the engine sees. CosyVoice3 natively supports hotfix pinyin tags —
 * the upstream example turns 给予 into [j][ǐ]予… i.e. the target character is
 * replaced by bracketed pinyin syllable tokens ([initial][final+tone]).
 * With the optional pinyin mode enabled (off by default), a literal rule
 * whose RHS is pure pinyin syllables annotates instead of replacing:
 *
 *   给予 => ji3 yu3        # → [j][ǐ][y][ǔ] in the synthesized text
 *   回调 => hui2 diao4     # tone marks (huí diào) also accepted
 *
 * One syllable per CJK character of the term; rules with a plain-text RHS
 * keep their replacement behavior, so existing dictionaries work unchanged.
 * Enable with `AUTOVIDEO_PRONOUNCE_PINYIN=1` or by passing
 * `{ mode: "pinyin" }` to applyPronunciation. Only CosyVoice3 understands
 * these tags — leave the mode off for other engines.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PronunciationRule {
  /** Literal term or regex source, as written in dict.md */
  pattern: string;
  /** Replacement text; `$1`-style backreferences work for regex rules */
  replacement: string;
  /** Whether `pattern` is a regex source rather than a literal */
  isRegex: boolean;
  /** Regex flags (regex rules only) */
  flags: string;
  /** 1-based line number in dict.md, for error messages */
  line: number;
}

export class PronunciationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PronunciationError";
  }
}

/** Default dictionary file name, resolved relative to the project directory. */
export const DICT_FILENAME = "dict.md";

/**
 * Repository-level shared dictionary, at the repository root next to
 * package.json. Distributed with git so every project on every machine sees
 * the same base rules.
 */
export const REPO_DICT_FILENAME = "dict.global.md";

/** Machine-level dictionary directory name under the XDG config home. */
const MACHINE_DICT_DIR = join(os.homedir(), ".config", "autovideo");

/**
 * Framework built-in dictionary, lowest precedence of all layers.
 *
 * Holds rules that should hold for every project on every machine even when
 * no dict file exists — currently Chinese polyphones that TTS voices
 * consistently misread (字幕保持原文，仅合成文本被改写).
 */
const BUILTIN_DICT = `
回调 => 回掉
`;

/** Parse the built-in rule set. */
function loadBuiltinRules(): PronunciationRule[] {
  return parsePronunciationDict(BUILTIN_DICT);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const RULE_SEPARATOR = "=>";
const REGEX_RULE = /^\/(.*)\/([gimsuy]*)$/;

/**
 * Parse dict.md content into rules.
 *
 * Literal rules are sorted longest-first so that a specific term ("cam0")
 * wins over a prefix of it ("cam"). Regex rules keep their authored order and
 * always run after the literals.
 */
export function parsePronunciationDict(content: string): PronunciationRule[] {
  const literals: PronunciationRule[] = [];
  const regexes: PronunciationRule[] = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "" || raw.startsWith("#")) continue;

    const sep = raw.indexOf(RULE_SEPARATOR);
    if (sep < 0) {
      throw new PronunciationError(
        `${DICT_FILENAME}:${i + 1}: expected "<term> ${RULE_SEPARATOR} <reading>", got: ${raw}`,
      );
    }

    const lhs = raw.slice(0, sep).trim();
    const rhs = raw.slice(sep + RULE_SEPARATOR.length).trim();

    if (lhs === "") {
      throw new PronunciationError(`${DICT_FILENAME}:${i + 1}: empty term`);
    }

    const asRegex = REGEX_RULE.exec(lhs);
    if (asRegex) {
      const [, source, flags] = asRegex;
      try {
        new RegExp(source, flags);
      } catch (err) {
        throw new PronunciationError(
          `${DICT_FILENAME}:${i + 1}: invalid regex /${source}/${flags}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      regexes.push({ pattern: source, replacement: rhs, isRegex: true, flags, line: i + 1 });
    } else {
      literals.push({ pattern: lhs, replacement: rhs, isRegex: false, flags: "", line: i + 1 });
    }
  }

  literals.sort((a, b) => b.pattern.length - a.pattern.length);
  return [...literals, ...regexes];
}

/**
 * Load `dict.md` from a single directory. Returns an empty rule set when the
 * file is absent — the dictionary is entirely optional.
 */
export function loadPronunciationDict(dictDir: string): PronunciationRule[] {
  return loadDictFile(join(dictDir, DICT_FILENAME));
}

/** Load one dictionary file by absolute path; absent file → empty rule set. */
function loadDictFile(dictPath: string): PronunciationRule[] {
  if (!existsSync(dictPath)) return [];
  return parsePronunciationDict(readFileSync(dictPath, "utf-8"));
}

/**
 * Load the effective rule set for a project by layering up to four sources,
 * lowest precedence first:
 *
 *   0. framework built-in rules (BUILTIN_DICT, e.g. Chinese polyphones)
 *   1. repo-level `dict.global.md` (found by walking up from the project dir)
 *   2. machine-level `~/.config/autovideo/dict.md`
 *   3. project-level `<projectDir>/dict.md`
 *
 * All matching rules are merged and re-sorted by `mergeRules`, so a project
 * can override a global literal by writing the same term again (the later,
 * i.e. more local, source wins).
 */
export function loadPronunciationDicts(projectDir: string): PronunciationRule[] {
  const layers: PronunciationRule[][] = [loadBuiltinRules()];

  const repoDict = findUp(projectDir, REPO_DICT_FILENAME);
  if (repoDict) layers.push(loadDictFile(join(repoDict, REPO_DICT_FILENAME)));

  if (existsSync(join(MACHINE_DICT_DIR, DICT_FILENAME))) {
    layers.push(loadPronunciationDict(MACHINE_DICT_DIR));
  }

  layers.push(loadPronunciationDict(projectDir));

  return mergeRules(layers);
}

/**
 * Merge rule layers (lowest precedence first) into one list.
 *
 * Literals are keyed by their pattern: a later layer's literal replaces an
 * earlier one with the same pattern. Regex rules are all kept, in layer
 * order. The final list matches the shape `parsePronunciationDict` produces:
 * literals longest-first, then regexes in authored order.
 */
function mergeRules(layers: PronunciationRule[][]): PronunciationRule[] {
  const literals = new Map<string, PronunciationRule>();
  const regexes: PronunciationRule[] = [];

  for (const layer of layers) {
    for (const rule of layer) {
      if (rule.isRegex) {
        regexes.push(rule);
      } else {
        literals.set(rule.pattern, rule);
      }
    }
  }

  const mergedLiterals = [...literals.values()].sort(
    (a, b) => b.pattern.length - a.pattern.length,
  );
  return [...mergedLiterals, ...regexes];
}

/**
 * Walk up from `startDir` looking for a directory that contains `filename`.
 * Returns the containing directory, or null when the filesystem root is
 * reached without a match.
 */
function findUp(startDir: string, filename: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, filename))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/** True when the character is ASCII alphanumeric or an underscore. */
function isAsciiWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Replace every occurrence of a literal term.
 *
 * Terms made of ASCII characters only match at word boundaries, so `IMU` does
 * not fire inside `IMUX`. CJK terms have no such notion and match anywhere.
 */
function replaceLiteral(text: string, term: string, replacement: string): string {
  const asciiTerm = /^[A-Za-z0-9_]+$/.test(term);
  if (!asciiTerm) {
    return text.split(term).join(replacement);
  }

  const re = new RegExp(escapeRegex(term), "g");
  return text.replace(re, (match, offset: number) => {
    const before = text[offset - 1];
    const after = text[offset + match.length];
    if (isAsciiWordChar(before) || isAsciiWordChar(after)) return match;
    return replacement;
  });
}

// ---------------------------------------------------------------------------
// Inline pinyin mode (CosyVoice3 pronunciation inpainting)
// ---------------------------------------------------------------------------

/**
 * How a literal rule with a pinyin RHS is applied.
 *   "replace" (default): the RHS is plain spoken text (回调 => 回掉).
 *   "pinyin": a pure-pinyin RHS becomes CosyVoice3 hotfix tags — each CJK
 *   character of the term is replaced by its [initial][final+tone] tokens
 *   (给予 => ji3 yu3 turns 给予 into [j][ǐ][y][ǔ], matching the upstream
 *   CosyVoice3 example "报道[j][ǐ]予"). Rules with a plain-text RHS keep
 *   their replacement behavior either way; regex rules always replace.
 */
export type PronunciationApplyMode = "replace" | "pinyin";

/**
 * Resolve the effective apply mode: an explicit argument wins, then the
 * AUTOVIDEO_PRONOUNCE_PINYIN env var ("1"/"true"/"yes"/"on"), then the
 * backward-compatible default "replace".
 */
export function resolvePronunciationMode(
  mode?: PronunciationApplyMode,
): PronunciationApplyMode {
  if (mode) return mode;
  const env = process.env.AUTOVIDEO_PRONOUNCE_PINYIN?.trim().toLowerCase();
  return env && ["1", "true", "yes", "on"].includes(env) ? "pinyin" : "replace";
}

/** Tone-mark tables: base vowel → marks for tones 1–4 (5/0 = neutral, unmarked). */
const TONE_MARKS: Record<string, string[]> = {
  a: ["ā", "á", "ǎ", "à"],
  o: ["ō", "ó", "ǒ", "ò"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  u: ["ū", "ú", "ǔ", "ù"],
  ü: ["ǖ", "ǘ", "ǚ", "ǜ"],
};

const MARKED_TO_BASE: Record<string, string> = Object.fromEntries(
  Object.entries(TONE_MARKS).flatMap(([base, marks]) =>
    marks.map((mark) => [mark, base]),
  ),
);

/** Mandarin finals in their canonical written form (iu/ui/un abbreviations included). */
const PINYIN_FINALS = new Set([
  "a", "ai", "an", "ang", "ao",
  "o", "ong", "ou",
  "e", "ei", "en", "eng", "er",
  "i", "ia", "ian", "iang", "iao", "ie", "in", "ing", "iong", "iu",
  "u", "ua", "uai", "uan", "uang", "ue", "ui", "un", "uo",
  "ü", "üan", "üe", "ün",
]);

/** Longest-first initials; y/w double as zero-initial spellings (yin, wu). */
const PINYIN_INITIALS = [
  "zh", "ch", "sh",
  "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
  "j", "q", "x", "r", "z", "c", "s", "y", "w",
];

interface PinyinSyllable {
  initial: string;
  /** Final with its tone mark applied (unmarked for the neutral tone) */
  finalMarked: string;
}

/** Place the tone mark: a/o/e win in that order; otherwise the last vowel. */
function applyToneMark(finalPlain: string, tone: number): string {
  if (tone < 1 || tone > 4) return finalPlain;
  let vowelIndex = -1;
  for (const v of ["a", "o", "e"]) {
    const idx = finalPlain.indexOf(v);
    if (idx >= 0) {
      vowelIndex = idx;
      break;
    }
  }
  if (vowelIndex < 0) {
    for (let i = finalPlain.length - 1; i >= 0; i--) {
      if (TONE_MARKS[finalPlain[i]]) {
        vowelIndex = i;
        break;
      }
    }
  }
  if (vowelIndex < 0) return finalPlain;
  const base = finalPlain[vowelIndex];
  return (
    finalPlain.slice(0, vowelIndex) + TONE_MARKS[base][tone - 1] + finalPlain.slice(vowelIndex + 1)
  );
}

/**
 * Parse one pinyin syllable — tone-number ("diao4", "lv4") or tone-marked
 * ("diào", "lǜ") — into its CosyVoice3 hotfix halves. Returns null when the
 * token is not a valid syllable.
 */
export function parsePinyinSyllable(token: string): PinyinSyllable | null {
  let s = token.trim().toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü");
  if (s === "") return null;

  // Tone: trailing digit 1–5, or one tone-marked vowel — never both.
  let tone = 0;
  const digit = /([0-5])$/.exec(s);
  if (digit) {
    tone = Number(digit[1]);
    s = s.slice(0, -1);
  }
  let plain = "";
  for (const ch of s) {
    const base = MARKED_TO_BASE[ch];
    if (base) {
      if (tone !== 0) return null; // double tone marking
      tone = TONE_MARKS[base].indexOf(ch) + 1;
      plain += base;
    } else {
      plain += ch;
    }
  }

  const initial = PINYIN_INITIALS.find((ini) => plain.startsWith(ini)) ?? "";
  let finalPlain = plain.slice(initial.length);
  // ü is written u after j/q/x/y (juan, que, xun, yuan): the CosyVoice3
  // vocab only carries the u-forms of those finals.
  if (["j", "q", "x", "y"].includes(initial)) finalPlain = finalPlain.replace(/ü/g, "u");
  if (!PINYIN_FINALS.has(finalPlain)) return null;

  let finalMarked = applyToneMark(finalPlain, tone);
  // The only üe final token in the CosyVoice3 vocab is [vè].
  if (finalMarked === "üè") finalMarked = "vè";
  return { initial, finalMarked };
}

/** Hotfix token form of one syllable: `[j][ǐ]`, or `[àn]` when zero-initial. */
function bracketSyllable(syl: PinyinSyllable): string {
  return (syl.initial ? `[${syl.initial}]` : "") + `[${syl.finalMarked}]`;
}

/**
 * True when every whitespace-separated token of `rhs` parses as a pinyin
 * syllable — the signal that the rule wants inline annotation in pinyin mode.
 * Exported so lint (src/tts/lint.ts) can skip such rules in its
 * RHS-stability scan.
 */
export function isPinyinReplacement(rhs: string): boolean {
  const tokens = rhs.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => parsePinyinSyllable(t) !== null);
}

const CJK_ONLY = /^[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+$/;

/**
 * Build the hotfix replacement for a literal term: one bracketed syllable per
 * CJK character, the character dropped — exactly the upstream CosyVoice3
 * "hotfix" form (对报道[j][ǐ]予好评).
 */
function annotateTermWithPinyin(rule: PronunciationRule): string {
  if (!CJK_ONLY.test(rule.pattern)) {
    throw new PronunciationError(
      `${DICT_FILENAME}:${rule.line}: pinyin RHS "${rule.replacement}" only works for ` +
        `pure-Chinese terms, but "${rule.pattern}" contains non-CJK characters`,
    );
  }
  const syllables = rule.replacement.trim().split(/\s+/).filter(Boolean);
  const chars = [...rule.pattern];
  if (syllables.length !== chars.length) {
    throw new PronunciationError(
      `${DICT_FILENAME}:${rule.line}: pinyin RHS "${rule.replacement}" has ` +
        `${syllables.length} syllable(s) but "${rule.pattern}" has ${chars.length} ` +
        `character(s) — write one syllable per character (e.g. ${chars
          .map(() => "x1")
          .join(" ")})`,
    );
  }
  return chars
    .map((_, i) => {
      const syl = parsePinyinSyllable(syllables[i]);
      // isPinyinReplacement already validated every token, so this cannot
      // be null — assert loudly anyway rather than emit a broken tag.
      if (!syl) {
        throw new PronunciationError(
          `${DICT_FILENAME}:${rule.line}: invalid pinyin syllable "${syllables[i]}"`,
        );
      }
      return bracketSyllable(syl);
    })
    .join("");
}

/**
 * Rewrite `text` for synthesis by applying every rule in order.
 *
 * Replacements are not re-scanned, so a rule cannot trigger another rule.
 *
 * `options.mode` (default: resolvePronunciationMode(), i.e. "replace" unless
 * AUTOVIDEO_PRONOUNCE_PINYIN is set) switches literal rules with a pure-pinyin
 * RHS from replacement to CosyVoice3 inline annotation. Regex rules always
 * replace — pinyin inpainting is a per-term feature.
 */
export function applyPronunciation(
  text: string,
  rules: PronunciationRule[],
  options?: { mode?: PronunciationApplyMode },
): string {
  const mode = resolvePronunciationMode(options?.mode);
  let out = text;
  for (const rule of rules) {
    if (rule.isRegex) {
      out = out.replace(new RegExp(rule.pattern, rule.flags || "g"), rule.replacement);
    } else if (mode === "pinyin" && isPinyinReplacement(rule.replacement)) {
      out = replaceLiteral(out, rule.pattern, annotateTermWithPinyin(rule));
    } else {
      out = replaceLiteral(out, rule.pattern, rule.replacement);
    }
  }
  return out;
}

/**
 * Short stable hash of the rule set, for cache keys. Rewriting the dictionary
 * has to invalidate previously synthesized audio.
 */
export function computeDictVersion(rules: PronunciationRule[]): string {
  if (rules.length === 0) return "none";
  const canonical = rules
    .map((r) => `${r.isRegex ? `/${r.pattern}/${r.flags}` : r.pattern}=>${r.replacement}`)
    .join("\n");
  return crypto.createHash("md5").update(canonical).digest("hex").slice(0, 12);
}
