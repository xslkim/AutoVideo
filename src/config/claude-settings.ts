/**
 * Read Claude Code settings from ~/.claude/settings.json
 *
 * When using cc-switch or Claude Code CLI, authentication and model
 * configuration are stored here rather than in environment variables.
 *
 * Credential resolution priority:
 *   1. Env vars (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 *   2. ~/.claude/settings.json → env.ANTHROPIC_AUTH_TOKEN  (cc-switch API key mode)
 *   3. ~/.claude/.credentials.json → claudeAiOauth.accessToken  (Claude Pro OAuth mode)
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
const CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

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
 * Read OAuth credentials from ~/.claude/.credentials.json.
 * Used when Claude Code is logged in via `claude login` (Claude Pro / OAuth flow).
 * Returns null if the file is missing, expired, or malformed.
 */
export function readClaudeOAuthCredentials(): ClaudeSettings | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken) return null;

    // Reject if the token is already expired
    if (oauth.expiresAt && Date.now() > oauth.expiresAt) return null;

    return {
      authToken: oauth.accessToken as string,
      baseUrl: "https://api.anthropic.com",
      model: "",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve Claude credentials from multiple sources in priority order:
 * 1. Environment variables (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 * 2. ~/.claude/settings.json → env field  (cc-switch API key mode)
 * 3. ~/.claude/.credentials.json          (Claude Pro OAuth / `claude login`)
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

  // 2. Try ~/.claude/settings.json (cc-switch API key mode)
  const fromSettings = readClaudeSettings();
  if (fromSettings) return fromSettings;

  // 3. Try ~/.claude/.credentials.json (Claude Pro OAuth)
  return readClaudeOAuthCredentials();
}
