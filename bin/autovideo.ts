#!/usr/bin/env npx tsx

import { Command } from "commander";
import { resolve } from "node:path";
import { compile } from "../src/cli/compile.js";
import { tts } from "../src/cli/tts.js";
import { visuals } from "../src/cli/visuals.js";
import { render } from "../src/cli/render.js";
import { preview } from "../src/cli/preview.js";
import { buildCommand } from "../src/cli/build.js";
import { registerCacheCommand } from "../src/cli/cache.js";
import { doctorCommand } from "../src/cli/doctor.js";
import { initCommand } from "../src/cli/init.js";
import { dictSuggestCommand } from "../src/cli/dict.js";
import { loadConfig } from "../src/config/load.js";

const program = new Command();

program
  .name("autovideo")
  .description("Compile Markdown teaching scripts into MP4 videos")
  .version("0.1.0");

function getConfig(configPath?: string, cacheDir?: string) {
  return loadConfig({ configPath, cacheDir }).config;
}

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
  .option("--meta <key=value...>", "override meta fields")
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
  .option("--verbose", "detailed logging")
  .option("--dry-run", "show what would be done without executing")
  .option("--meta <key=value...>", "override meta fields")
  .action(async (project, opts) => {
    const { outDir } = await compile({
      projectPath: project,
      outDir: opts.out,
      configPath: opts.config,
      metaArgs: opts.meta,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
    });
    if (opts.verbose) console.log("Compiled:", outDir);
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
  .action(async (scriptPath, opts) => {
    const config = getConfig(opts.config, opts.cacheDir);
    const blockIds = opts.block ? opts.block.split(",") : undefined;
    const result = await tts({
      scriptPath,
      config,
      blockIds,
      force: opts.force,
      verbose: opts.verbose,
      dryRun: opts.dryRun,
    });
    console.log(`TTS: ${result.apiCalls} API calls, ${result.cacheHits} cache hits`);
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
  .action(async (scriptPath, opts) => {
    const config = getConfig(opts.config, opts.cacheDir);
    const blockIds = opts.block ? opts.block.split(",") : undefined;
    const result = await visuals({
      scriptPath,
      config,
      blockIds,
      force: opts.force,
      verbose: opts.verbose,
      dryRun: opts.dryRun,
    });
    console.log(`Visuals: ${result.apiCalls} API calls, ${result.cacheHits} cache hits`);
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
  .action(async (scriptPath, opts) => {
    const config = getConfig(opts.config, opts.cacheDir);
    const blockIds = opts.block ? opts.block.split(",") : undefined;
    const result = await render({
      scriptPath,
      config,
      blockIds,
      force: opts.force,
      verbose: opts.verbose,
      dryRun: opts.dryRun,
    });
    console.log(`Render: ${result.renders} renders, ${result.cacheHits} cache hits`);
  });

program
  .command("preview")
  .description("Open Remotion Studio for interactive preview")
  .argument("<script>", "path to script.json")
  .option("--block <id>", "open studio focused on a specific block")
  .option("--config <file>", "path to autovideo.config.json")
  .option("--verbose", "detailed logging")
  .action(async (scriptPath, opts) => {
    const blockIds = opts.block ? [opts.block] : undefined;
    await preview({
      scriptPath,
      blockIds,
      configPath: opts.config,
      verbose: opts.verbose,
    });
  });

// ── Utilities ─────────────────────────────────────────────────────
registerCacheCommand(program);

program
  .command("doctor")
  .description("Check environment and dependencies")
  .action(async () => {
    await doctorCommand();
  });

program
  .command("init")
  .description("Create a new project from the starter template")
  .argument("<dir>", "target directory for the new project")
  .option("--verbose", "detailed logging")
  .action(async (dir, opts) => {
    await initCommand(dir, opts);
  });

const dict = program.command("dict").description("Pronunciation dictionary helpers");
dict
  .command("suggest")
  .description("Ask an LLM how to read terms the heuristics can't handle, append as comments to dict.md")
  .argument("<project>", "path to project.json")
  .option("--verbose", "detailed logging")
  .action(async (project, opts) => {
    await dictSuggestCommand(project, opts);
  });

program.parse();
