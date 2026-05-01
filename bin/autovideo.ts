#!/usr/bin/env node
import { Command } from "commander";
import { registerCacheCommand } from "../src/cli/cache.js";
import { build } from "../src/cli/build.js";
import { tts } from "../src/cli/tts.js";
import { visuals } from "../src/cli/visuals.js";
import { render } from "../src/cli/render.js";
import { preview } from "../src/cli/preview.js";
import { loadConfig } from "../src/config/load.js";

const notImplemented = (cmdName: string) => {
  console.error(`${cmdName}: not implemented`);
  process.exit(1);
};

function parseBlockIds(val: string | undefined): string[] | undefined {
  if (!val) return undefined;
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

const program = new Command();

program
  .name("autovideo")
  .description("Compile Markdown teaching scripts into MP4 videos")
  .version("0.1.0");

program
  .command("build")
  .description("Run full pipeline: compile → tts → visuals → render")
  .argument("<project>", "path to project.json")
  .option("--out <dir>", "output directory")
  .option("--config <file>", "path to config file")
  .option("--meta <key=value...>", "override meta fields (e.g. --meta title=Foo aspect=16:9)")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .allowUnknownOption(false)
  .action(async (projectPath: string, opts) => {
    // PRD §7: build does NOT accept --block
    if (process.argv.includes("--block")) {
      console.error(
        "Error: 'build' does not accept --block.\n" +
        "Use step commands for partial rebuilds, e.g.:\n" +
        "  autovideo render script.json --block B03"
      );
      process.exit(1);
    }
    try {
      const result = await build({
        projectPath,
        outDir: opts.out,
        configPath: opts.config,
        metaArgs: opts.meta,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
      console.log("Build complete:", result.outDir);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("tts")
  .description("Generate audio + subtitle timings from narration")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "comma-separated block IDs to process")
  .option("--force", "ignore cache")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .action(async (scriptPath: string, opts) => {
    try {
      const blockIds = parseBlockIds(opts.block);
      await tts({
        scriptPath,
        blockIds,
        force: opts.force,
        configPath: opts.config,
        cacheDir: opts.cacheDir,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("visuals")
  .description("Generate React components from visual descriptions via Claude")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "comma-separated block IDs to process")
  .option("--force", "ignore cache")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .action(async (scriptPath: string, opts) => {
    try {
      const blockIds = parseBlockIds(opts.block);
      await visuals({
        scriptPath,
        blockIds,
        force: opts.force,
        configPath: opts.config,
        cacheDir: opts.cacheDir,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("render")
  .description("Render blocks to MP4 partials and concatenate")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "comma-separated block IDs to re-render")
  .option("--force", "ignore cache")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .action(async (scriptPath: string, opts) => {
    try {
      const blockIds = parseBlockIds(opts.block);
      await render({
        scriptPath,
        blockIds,
        force: opts.force,
        configPath: opts.config,
        cacheDir: opts.cacheDir,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("preview")
  .description("Open Remotion Studio for interactive preview")
  .argument("<script>", "path to script.json")
  .option("--block <id>", "specific block to preview")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .action(async (scriptPath: string, opts) => {
    try {
      await preview({
        scriptPath,
        blockId: opts.block,
        configPath: opts.config,
        cacheDir: opts.cacheDir,
        verbose: opts.verbose,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

// cache command — delegates to registerCacheCommand which adds subcommands
registerCacheCommand(program as Command);

program
  .command("doctor")
  .description("Check environment and dependencies")
  .action(async () => {
    const { doctorCommand } = await import("../src/cli/doctor.js");
    await doctorCommand();
  });

program
  .command("init")
  .description("Generate a template project")
  .argument("<dir>", "target directory")
  .action(async (_dir: string, _opts) => {
    notImplemented("init");
  });

program.parse();