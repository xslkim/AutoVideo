/**
 * Read Claude Code settings from ~/.claude/settings.json
 *
 * When using cc-switch or Claude Code CLI, authentication and model
 * configuration are stored here rather than in environment variables.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ClaudeSettings {
  authToken: string;
  baseUrl: string;
  model: string;
}

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

/**
 * Read Claude Code settings from ~/.claude/settings.json.
 * Returns null if the file doesn't exist or lacks required fields.
 */
export function readClaudeSettings(): ClaudeSettings | null {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(raw);
    const env = settings.env ?? {};

    const authToken = env.ANTHROPIC_AUTH_TOKEN ?? "";
    const baseUrl = env.ANTHROPIC_BASE_URL ?? "";
    const model = env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "";

    if (!authToken || !baseUrl) {
      return null;
    }

    return { authToken, baseUrl, model };
  } catch {
    return null;
  }
}

/**
 * Resolve Claude credentials from multiple sources in priority order:
 * 1. Environment variables (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 * 2. ~/.claude/settings.json (cc-switch / Claude Code config)
 */
export function resolveClaudeCredentials(): ClaudeSettings | null {
  // 1. Check environment variables first
  const envToken = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? "";
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL ?? "";

  if (envToken) {
    return {
      authToken: envToken,
      baseUrl: envBaseUrl || "https://api.anthropic.com",
      model: process.env.ANTHROPIC_MODEL ?? "",
    };
  }

  // 2. Fall back to ~/.claude/settings.json
  return readClaudeSettings();
}
