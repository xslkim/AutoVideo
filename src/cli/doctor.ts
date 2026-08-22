#!/usr/bin/env node
/**
 * autovideo doctor — Environment health-check.
 *
 * Implements §7 "autovideo doctor" check table (11 items).
 * Outputs a table of PASS / WARN / FAIL with fix guidance.
 *
 * Exit codes:
 *   0 = all PASS
 *   1 = at least one WARN but zero FAIL
 *   2 = at least one FAIL
 */

import { execFile } from "node:child_process";
import { existsSync, accessSync, constants, mkdirSync, readdirSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import * as http from "node:http";
import { loadConfig } from "../config/load.js";
import type { AutoVideoConfig } from "../config/defaults.js";
import { resolveClaudeCredentials } from "../config/claude-settings.js";
import {
  resolveAgentProvider,
  defaultCliBinary,
  checkCliVersion,
} from "../ai/agent/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Status = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
  fix: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promisified execFile */
function run(
  cmd: string,
  args: string[] = [],
  opts: import("node:child_process").ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000, ...opts }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
      });
    });
  });
}

/** HTTP GET returning status code (rejects on network error) */
function httpGetStatus(url: string, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // drain
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

/** Expand ~ in paths */
function expandTilde(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/** Format bytes as human-readable */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Extract major.minor from a version string like "ffmpeg version 5.1.2" */
function parseVersion(ver: string): number[] {
  const m = ver.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return [0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] ?? "0", 10)];
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkNode(): Promise<CheckResult> {
  const major = parseInt(process.version.slice(1).split(".")[0], 10);
  if (major >= 20) {
    return { name: "Node.js version", status: "PASS", detail: process.version, fix: "" };
  }
  return {
    name: "Node.js version",
    status: "FAIL",
    detail: `${process.version} (need ≥ 20)`,
    fix: "Install Node.js ≥ 20 via nvm or nodesource.",
  };
}

export async function checkFfmpeg(): Promise<CheckResult> {
  const res = await run("ffmpeg", ["-version"]).catch(() => null);
  if (!res || res.code !== 0) {
    return {
      name: "ffmpeg",
      status: "FAIL",
      detail: "not found",
      fix: "Install ffmpeg: sudo apt-get install ffmpeg",
    };
  }
  const line = res.stdout.split("\n")[0] ?? "";
  const [major] = parseVersion(line);
  if (major >= 5) {
    return { name: "ffmpeg", status: "PASS", detail: line.trim(), fix: "" };
  }
  if (major >= 4) {
    return {
      name: "ffmpeg",
      status: "WARN",
      detail: `${line.trim()} (≥ 5.0 recommended; 4.x loudnorm JSON may be unreliable)`,
      fix: "Upgrade ffmpeg to ≥ 5.0: sudo apt-get install ffmpeg",
    };
  }
  return {
    name: "ffmpeg",
    status: "FAIL",
    detail: `${line.trim()} (need ≥ 5.0)`,
    fix: "Upgrade ffmpeg to ≥ 5.0: sudo apt-get install ffmpeg",
  };
}

export async function checkChromium(): Promise<CheckResult> {
  try {
    // Dynamic import for ESM-only @remotion/renderer
    const renderer = await import("@remotion/renderer");
    if (typeof renderer.ensureBrowser === "function") {
      await renderer.ensureBrowser();
    }
    return { name: "Chromium", status: "PASS", detail: "available (Remotion)", fix: "" };
  } catch (err: any) {
    return {
      name: "Chromium",
      status: "FAIL",
      detail: `not available: ${err?.message ?? err}`,
      fix: "Run `npx remotion browser ensure` or install chromium-browser.",
    };
  }
}

async function checkCJKFonts(): Promise<CheckResult> {
  try {
    // Try importing the NotoSansSC font module
    await import("@remotion/google-fonts/NotoSansSC");
    return {
      name: "CJK fonts",
      status: "PASS",
      detail: "@remotion/google-fonts/NotoSansSC importable",
      fix: "",
    };
  } catch {
    return {
      name: "CJK fonts",
      status: "WARN",
      detail: "@remotion/google-fonts/NotoSansSC import failed",
      fix: "Install package: npm install @remotion/google-fonts. Or install system font: sudo apt-get install fonts-noto-cjk",
    };
  }
}

export async function checkVoxCPMService(config: AutoVideoConfig): Promise<CheckResult> {
  const endpoint = config.voxcpm.endpoint;
  try {
    const code = await httpGetStatus(`${endpoint}/health`);
    if (code >= 200 && code < 400) {
      return { name: "VoxCPM2 service", status: "PASS", detail: `${endpoint}/health → ${code}`, fix: "" };
    }
    return {
      name: "VoxCPM2 service",
      status: "WARN",
      detail: `${endpoint}/health → HTTP ${code}`,
      fix: `Start the VoxCPM2 service. Run: bash third_servers/voxcpm-tts/start.sh (see third_servers/voxcpm-tts/README.md)`,
    };
  } catch {
    return {
      name: "VoxCPM2 service",
      status: "WARN",
      detail: `unreachable at ${endpoint}`,
      fix: `Start the VoxCPM2 service. Run: bash third_servers/voxcpm-tts/start.sh (see third_servers/voxcpm-tts/README.md)`,
    };
  }
}

async function checkCosyVoiceService(config: AutoVideoConfig): Promise<CheckResult> {
  const endpoint = config.cosyvoice.endpoint;
  try {
    const code = await httpGetStatus(`${endpoint}/health`);
    if (code >= 200 && code < 400) {
      return { name: "CosyVoice3 service", status: "PASS", detail: `${endpoint}/health → ${code}`, fix: "" };
    }
    return {
      name: "CosyVoice3 service",
      status: "WARN",
      detail: `${endpoint}/health → HTTP ${code}`,
      fix: code === 503
        ? `The model may still be loading (or failed to load) — check logs/cosyvoice.log and retry. Otherwise start the service: bash third_servers/cosyvoice-tts/start.sh`
        : `Start the CosyVoice3 service. Run: bash third_servers/cosyvoice-tts/start.sh (see third_servers/cosyvoice-tts/README.md)`,
    };
  } catch {
    return {
      name: "CosyVoice3 service",
      status: "WARN",
      detail: `unreachable at ${endpoint}`,
      fix: `Start the CosyVoice3 service. Run: bash third_servers/cosyvoice-tts/start.sh (see third_servers/cosyvoice-tts/README.md)`,
    };
  }
}

async function checkCosyVoiceModel(config: AutoVideoConfig): Promise<CheckResult> {
  const modelDir = expandTilde(config.cosyvoice.modelDir);
  const configPath = join(modelDir, "config.json");
  if (existsSync(configPath)) {
    return {
      name: "CosyVoice3 model weights",
      status: "PASS",
      detail: configPath,
      fix: "",
    };
  }
  // Also check if the directory itself exists (model files may have different config names)
  if (existsSync(modelDir)) {
    try {
      const files = readdirSync(modelDir);
      if (files.length > 0) {
        return {
          name: "CosyVoice3 model weights",
          status: "PASS",
          detail: `${modelDir} (${files.length} file(s))`,
          fix: "",
        };
      }
    } catch {
      // ignore
    }
  }
  return {
    name: "CosyVoice3 model weights",
    status: "FAIL",
    detail: `not found at ${modelDir}`,
    fix: "Download the Fun-CosyVoice3-0.5B weights, then set cosyvoice.modelDir in autovideo.config.json to the weights dir. Run: bash third_servers/cosyvoice-tts/install.sh",
  };
}

async function checkVoxCPMModel(config: AutoVideoConfig): Promise<CheckResult> {
  const modelDir = expandTilde(config.voxcpm.modelDir);
  const configPath = join(modelDir, "config.json");
  if (existsSync(configPath)) {
    return {
      name: "VoxCPM2 model weights",
      status: "PASS",
      detail: configPath,
      fix: "",
    };
  }
  // Also check if the directory itself exists (model files may have different config names)
  if (existsSync(modelDir)) {
    try {
      const files = readdirSync(modelDir);
      if (files.length > 0) {
        return {
          name: "VoxCPM2 model weights",
          status: "PASS",
          detail: `${modelDir} (${files.length} file(s))`,
          fix: "",
        };
      }
    } catch {
      // ignore
    }
  }
  return {
    name: "VoxCPM2 model weights",
    status: "FAIL",
    detail: `not found at ${modelDir}`,
    fix: "Download VoxCPM2 weights, then set voxcpm.modelDir in autovideo.config.json to the weights dir. Run: bash install.sh",
  };
}

async function checkClaudeCredentials(config: AutoVideoConfig): Promise<CheckResult> {
  const provider = resolveAgentProvider(config.anthropic);
  if (provider !== "anthropic-api") {
    const cliPath = config.anthropic.cliPath || defaultCliBinary(provider);
    const cli = await checkCliVersion(cliPath);
    if (cli.ok) {
      return {
        name: "Agent CLI",
        status: "PASS",
        detail: `${provider} 可用（${cliPath}${cli.message ? `, ${cli.message}` : ""}）`,
        fix: "",
      };
    }
    return {
      name: "Agent CLI",
      status: "FAIL",
      detail: `${provider} 不可用: ${cli.message}`,
      fix: `确认 ${cliPath} 已安装并在 PATH 中，或在配置中设置 anthropic.cliPath。`,
    };
  }

  const creds = resolveClaudeCredentials();
  if (!creds) {
    return {
      name: "Claude credentials",
      status: "FAIL",
      detail: "no credentials found",
      fix: "Set ANTHROPIC_AUTH_TOKEN env var, or configure ~/.claude/settings.json via cc-switch.",
    };
  }
  return {
    name: "Claude credentials",
    status: "PASS",
    detail: `configured (baseUrl: ${creds.baseUrl})`,
    fix: "",
  };
}

async function checkClaudeApiConnectivity(config: AutoVideoConfig): Promise<CheckResult> {
  if (resolveAgentProvider(config.anthropic) !== "anthropic-api") {
    return {
      name: "Claude API connectivity",
      status: "PASS",
      detail: "skipped (CLI provider)",
      fix: "",
    };
  }

  const creds = resolveClaudeCredentials();
  if (!creds) {
    return {
      name: "Claude API connectivity",
      status: "WARN",
      detail: "skipped (no credentials)",
      fix: "Configure Claude credentials first.",
    };
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({
      apiKey: creds.authToken,
      baseURL: creds.baseUrl,
    });
    const model = config.anthropic.model || creds.model || "claude-sonnet-4-6";
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return {
      name: "Claude API connectivity",
      status: "PASS",
      detail: "ping succeeded",
      fix: "",
    };
  } catch (err: any) {
    const status = err?.status ?? err?.statusCode;
    if (status === 401) {
      return {
        name: "Claude API connectivity",
        status: "WARN",
        detail: `reachable but auth failed (HTTP ${status})`,
        fix: "Check your credentials are valid.",
      };
    }
    if (status && status >= 400 && status < 500) {
      return {
        name: "Claude API connectivity",
        status: "PASS",
        detail: `reachable (HTTP ${status})`,
        fix: "",
      };
    }
    return {
      name: "Claude API connectivity",
      status: "WARN",
      detail: `unreachable: ${err?.message ?? err}`,
      fix: "Check network connectivity and API endpoint.",
    };
  }
}

async function checkCacheDirWritable(config: AutoVideoConfig): Promise<CheckResult> {
  const cacheDir = expandTilde(config.cache.dir);
  try {
    // Ensure directory exists
    mkdirSync(cacheDir, { recursive: true });
    // Check read/write
    accessSync(cacheDir, constants.R_OK | constants.W_OK);
    return {
      name: "Cache directory",
      status: "PASS",
      detail: `${cacheDir} (RW)`,
      fix: "",
    };
  } catch (err: any) {
    return {
      name: "Cache directory",
      status: "FAIL",
      detail: `${cacheDir}: ${err?.message ?? err}`,
      fix: `Create and chmod the directory: mkdir -p ${cacheDir} && chmod +rw ${cacheDir}`,
    };
  }
}

async function checkDiskSpace(): Promise<CheckResult> {
  try {
    const stats = statfsSync(".");
    const availableBytes = stats.bavail * stats.bsize;
    const gb = availableBytes / (1024 ** 3);

    if (gb < 1) {
      return {
        name: "Disk space",
        status: "FAIL",
        detail: `${fmtBytes(availableBytes)} available (need ≥ 1 GB)`,
        fix: "Free up disk space. At least 5 GB recommended.",
      };
    }
    if (gb < 5) {
      return {
        name: "Disk space",
        status: "WARN",
        detail: `${fmtBytes(availableBytes)} available (recommend ≥ 5 GB)`,
        fix: "Consider freeing more disk space for video rendering.",
      };
    }
    return {
      name: "Disk space",
      status: "PASS",
      detail: `${fmtBytes(availableBytes)} available`,
      fix: "",
    };
  } catch {
    // statfsSync not available on some platforms; fallback
    // Try df command
    const res = await run("df", ["-P", "."]).catch(() => null);
    if (res && res.code === 0) {
      const lines = res.stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1] ?? "";
      const parts = lastLine.split(/\s+/);
      // Format: filesystem blocks used available capacity mount
      const availKB = parseInt(parts[3] ?? "0", 10);
      const gb = availKB / (1024 ** 2);
      if (gb < 1) {
        return {
          name: "Disk space",
          status: "FAIL",
          detail: `${gb.toFixed(2)} GB available (need ≥ 1 GB)`,
          fix: "Free up disk space. At least 5 GB recommended.",
        };
      }
      if (gb < 5) {
        return {
          name: "Disk space",
          status: "WARN",
          detail: `${gb.toFixed(2)} GB available (recommend ≥ 5 GB)`,
          fix: "Consider freeing more disk space for video rendering.",
        };
      }
      return {
        name: "Disk space",
        status: "PASS",
        detail: `${gb.toFixed(2)} GB available`,
        fix: "",
      };
    }
    return {
      name: "Disk space",
      status: "WARN",
      detail: "could not determine",
      fix: "Ensure at least 5 GB free disk space for video rendering.",
    };
  }
}

async function checkPrlimitUnshare(): Promise<CheckResult> {
  // Only required on Linux
  if (platform() !== "linux") {
    return {
      name: "prlimit / unshare",
      status: "PASS",
      detail: `skipped (non-Linux: ${platform()})`,
      fix: "",
    };
  }

  const prlimit = await run("which", ["prlimit"]).catch(() => null);
  const unshare = await run("which", ["unshare"]).catch(() => null);

  const hasPrlimit = prlimit && prlimit.code === 0;
  const hasUnshare = unshare && unshare.code === 0;

  if (hasPrlimit && hasUnshare) {
    return {
      name: "prlimit / unshare",
      status: "PASS",
      detail: `prlimit: ${prlimit!.stdout.trim()}, unshare: ${unshare!.stdout.trim()}`,
      fix: "",
    };
  }
  const missing: string[] = [];
  if (!hasPrlimit) missing.push("prlimit");
  if (!hasUnshare) missing.push("unshare");

  return {
    name: "prlimit / unshare",
    status: "FAIL",
    detail: `missing: ${missing.join(", ")}`,
    fix: "Install util-linux: sudo apt-get install util-linux",
  };
}

// ---------------------------------------------------------------------------
// Main doctor function
// ---------------------------------------------------------------------------

export async function doctorAction(): Promise<number> {
  const { config } = loadConfig();

  const checks: CheckResult[] = [];

  // Run all checks sequentially for clear output ordering
  checks.push(await checkNode());
  checks.push(await checkFfmpeg());
  checks.push(await checkChromium());
  checks.push(await checkCJKFonts());
  // Check the engine selected by tts.provider; the other engine's service is
  // expected to be offline (the two cannot share the GPU anyway).
  if ((config.tts?.provider ?? "voxcpm") === "cosyvoice") {
    checks.push(await checkCosyVoiceService(config));
    checks.push(await checkCosyVoiceModel(config));
  } else {
    checks.push(await checkVoxCPMService(config));
    checks.push(await checkVoxCPMModel(config));
  }
  checks.push(await checkClaudeCredentials(config));
  checks.push(await checkClaudeApiConnectivity(config));
  checks.push(await checkCacheDirWritable(config));
  checks.push(await checkDiskSpace());
  checks.push(await checkPrlimitUnshare());

  // Determine table column widths
  const nameW = Math.max(...checks.map((c) => c.name.length), 4);
  const statusW = 4; // WARN is longest
  const detailW = Math.max(...checks.map((c) => c.detail.length), 6);

  // Print header
  const header = `| ${"Check".padEnd(nameW)} | ${"Status".padEnd(statusW)} | ${"Detail".padEnd(detailW)} |`;
  const sep = `| ${"-".repeat(nameW)} | ${"-".repeat(statusW)} | ${"-".repeat(detailW)} |`;

  console.log(header);
  console.log(sep);

  let hasWarn = false;
  let hasFail = false;

  for (const c of checks) {
    const statusIcon = c.status;
    const line = `| ${c.name.padEnd(nameW)} | ${statusIcon.padEnd(statusW)} | ${c.detail.padEnd(detailW)} |`;
    console.log(line);

    if (c.status === "FAIL") hasFail = true;
    if (c.status === "WARN") hasWarn = true;
  }

  console.log();

  // Print fix guidance for non-PASS items
  const fixable = checks.filter((c) => c.status !== "PASS" && c.fix);
  if (fixable.length > 0) {
    console.log("Fix guidance:");
    for (const c of fixable) {
      const icon = c.status === "FAIL" ? "✗" : "⚠";
      console.log(`  ${icon} ${c.name}: ${c.fix}`);
    }
    console.log();
  }

  // Summary
  const passCount = checks.filter((c) => c.status === "PASS").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const failCount = checks.filter((c) => c.status === "FAIL").length;

  console.log(`Summary: ${passCount} PASS, ${warnCount} WARN, ${failCount} FAIL`);

  if (hasFail) return 2;
  if (hasWarn) return 1;
  return 0;
}

/**
 * Run as a CLI command handler.
 * Exits the process with the appropriate exit code.
 */
export async function doctorCommand(): Promise<void> {
  const code = await doctorAction();
  process.exit(code);
}