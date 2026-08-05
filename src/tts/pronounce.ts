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
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 * Load `dict.md` from a project directory. Returns an empty rule set when the
 * file is absent — the dictionary is entirely optional.
 */
export function loadPronunciationDict(projectDir: string): PronunciationRule[] {
  const dictPath = join(projectDir, DICT_FILENAME);
  if (!existsSync(dictPath)) return [];
  return parsePronunciationDict(readFileSync(dictPath, "utf-8"));
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

/**
 * Rewrite `text` for synthesis by applying every rule in order.
 *
 * Replacements are not re-scanned, so a rule cannot trigger another rule.
 */
export function applyPronunciation(text: string, rules: PronunciationRule[]): string {
  let out = text;
  for (const rule of rules) {
    out = rule.isRegex
      ? out.replace(new RegExp(rule.pattern, rule.flags || "g"), rule.replacement)
      : replaceLiteral(out, rule.pattern, rule.replacement);
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
