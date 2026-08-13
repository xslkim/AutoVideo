/**
 * AutoVideo — `autovideo dict suggest <projectDir>`
 *
 * The compile-time lint flags suspicious Latin terms; most get a heuristic
 * reading for free, but person names and irregularly-read brands
 * ("Ollama", "Georgi Gerganov") have no reliable rule. This command sends
 * those terms to Claude and appends its answers to the project dict.md as a
 * commented block — nothing takes effect until the author uncomments it.
 */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { readProject } from "../parser/project.js";
import { createAgentDriver } from "../ai/agent/index.js";
import { parseAndMergeBlocks } from "../parser/blocks.js";
import { loadPronunciationDicts, DICT_FILENAME } from "../tts/pronounce.js";
import { lintPronunciation, type LintFinding } from "../tts/lint.js";
import { resolveClaudeCredentials } from "../config/claude-settings.js";
import type { Block } from "../types/script.js";

const PROMPT = `You are helping configure a Chinese text-to-speech voice for technical videos. For each English term below, give the string a Chinese TTS engine should speak instead so it sounds natural to a Chinese developer audience.

Rules:
- Acronyms are spelled out letter by letter: "GGUF" → "G G U F"
- English words that have a standard reading keep it: "PagedAttention" → "Paged Attention"
- Person names are transliterated into Chinese: "Georgi Gerganov" → "格奥尔基·格加诺夫"
- Brands with a community reading use that: "Ollama" → "Oh llama"
- Reply with one line per term, exactly: <term> => <reading>
- No commentary, no numbering, no code fences.

Terms:
{TERMS}`;

export interface DictSuggestOptions {
  verbose?: boolean;
}

export async function dictSuggestCommand(
  projectPath: string,
  options: DictSuggestOptions = {},
): Promise<void> {
  // Reuse the compile-time pipeline so the term list matches what lint saw.
  const project = readProject(projectPath);
  const rules = loadPronunciationDicts(project.projectDir);
  const rawBlocks = parseAndMergeBlocks(project.blockPaths);

  const blocks = rawBlocks.map(
    (raw): Block => ({
      id: raw.id,
      title: raw.title,
      enter: raw.enter,
      exit: raw.exit,
      visualMode: raw.visualMode,
      visual: { description: raw.visualDescription },
      narration: { lines: raw.narrationLines },
    }),
  );

  const needsLLM = lintPronunciation(blocks, rules).filter((f: LintFinding) => f.needsLLM);
  if (needsLLM.length === 0) {
    console.log("没有需要 LLM 建议的词（所有可疑词都有启发式读法，见 compile 输出）。");
    return;
  }

  const creds = resolveClaudeCredentials();
  if (!creds) {
    throw new Error(
      "找不到 Claude 凭据。请设置 ANTHROPIC_AUTH_TOKEN，或通过 claude login 登录。",
    );
  }

  const driver = createAgentDriver({
    apiKey: creds.authToken,
    baseURL: creds.baseUrl || undefined,
    model: creds.model || "claude-sonnet-4-6",
  });

  const termList = needsLLM.map((f) => f.term).join("\n");
  if (options.verbose) console.log(`[dict suggest] 查询 ${needsLLM.length} 个词: ${termList}`);

  const { text } = await driver.generateText({
    user: PROMPT.replace("{TERMS}", termList),
    maxTokens: 1024,
  });

  const suggested = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("=>"));
  if (suggested.length === 0) {
    console.warn("LLM 没有返回可用的建议，原始输出：\n" + text);
    return;
  }

  const dictPath = join(project.projectDir, DICT_FILENAME);
  const header = `\n# ── auto-suggested by \`autovideo dict suggest\` (${new Date().toISOString().slice(0, 10)}) ──\n# review 后去掉行首 '# ' 即生效\n`;
  const body = suggested.map((l) => `# ${l}`).join("\n") + "\n";

  if (!existsSync(dictPath)) {
    // Preserve the project's existing dict.md when present; otherwise start one.
    appendFileSync(dictPath, `# Pronunciation dictionary\n`, "utf-8");
  }
  appendFileSync(dictPath, header + body, "utf-8");

  console.log(`已把 ${suggested.length} 条建议以注释形式追加到 ${dictPath}：`);
  for (const line of suggested) console.log(`  ${line}`);
  console.log("确认读法后删除行首 '# '，再重新 build 即可生效。");
}
