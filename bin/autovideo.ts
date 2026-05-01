#!/usr/bin/env npx tsx

import { Command } from "commander";
import { compileCommand } from "../src/cli/compile";
import { ttsCommand } from "../src/cli/tts";
import { visualsCommand } from "../src/cli/visuals";
import { renderCommand } from "../src/cli/render";
import { previewCommand } from "../src/cli/preview";
import { buildCommand } from "../src/cli/build";
import { cacheCommand } from "../src/cli/cache";
import { doctorCommand } from "../src/cli/doctor";
import { initCommand } from "../src/cli/init";

const program = new Command();

program
  .name("autovideo")
  .description("Compile Markdown teaching scripts into MP4 videos")
  .version("0.1.0");

// ── One-command pipeline ──────────────────────────────────────────
program
  .command("build")
  .description("Run all stages: compile → tts → visuals → render")
  .argument("<project>", "path to project.json")
  .option("--out <dir>", "output directory")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .option("--dry-run", "show what would be done without executing")
  .option("--meta <key=value...>", "override meta fields (e.g., --meta title=Foo aspect=16:9)")
  .action(async (project, opts) => {
    await buildCommand(project, opts);
  });

// ── Individual stages ─────────────────────────────────────────────
program
  .command("compile")
  .description("Parse Markdown DSL → script.json")
  .argument("<project>", "path to project.json")
  .option("--out <dir>", "output directory")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .option("--dry-run", "show what would be done without executing")
  .option("--meta <key=value...>", "override meta fields")
  .action(async (project, opts) => {
    await compileCommand(project, opts);
  });

program
  .command("tts")
  .description("Generate audio from narration lines")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only process specified block(s), comma-separated")
  .option("--force", "ignore cache, force regeneration")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .option("--dry-run", "show what would be done without executing")
  .action(async (script, opts) => {
    await ttsCommand(script, opts);
  });

program
  .command("visuals")
  .description("Generate React components from visual descriptions")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only process specified block(s), comma-separated")
  .option("--force", "ignore cache, force regeneration")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .option("--dry-run", "show what would be done without executing")
  .action(async (script, opts) => {
    await visualsCommand(script, opts);
  });

program
  .command("render")
  .description("Render blocks to MP4 and concatenate")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only render specified block(s), comma-separated")
  .option("--force", "ignore cache, force re-render")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .option("--dry-run", "show what would be done without executing")
  .action(async (script, opts) => {
    await renderCommand(script, opts);
  });

program
  .command("preview")
  .description("Open Remotion Studio for interactive preview")
  .argument("<script>", "path to script.json")
  .option("--block <id>", "open studio focused on a specific block")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .action(async (script, opts) => {
    await previewCommand(script, opts);
  });

// ── Utilities ─────────────────────────────────────────────────────
program
  .command("cache")
  .description("Manage build cache")
  .argument("[action]", "stats | clean")
  .option("--type <type>", "filter by cache type: audio | component | partial")
  .option("--older-than <duration>", "only evict entries older than duration (e.g., 30d, 12h)")
  .option("--stale", "only evict entries with stale prompt/remotion version")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "detailed logging")
  .action(async (action, opts) => {
    await cacheCommand(action, opts);
  });

program
  .command("doctor")
  .description("Check environment and dependencies")
  .option("--config <file>", "path to autovideo.config.json")
  .action(async (opts) => {
    await doctorCommand(opts);
  });

program
  .command("init")
  .description("Create a new project from the starter template")
  .argument("<dir>", "target directory for the new project")
  .option("--verbose", "detailed logging")
  .action(async (dir, opts) => {
    await initCommand(dir, opts);
  });

program.parse();