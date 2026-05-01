#!/usr/bin/env node
import { Command } from "commander";
import { registerCacheCommand } from "../src/cli/cache.js";
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
  .action(() => notImplemented("build"));

program
  .command("compile")
  .description("Compile Markdown DSL into script.json IR")
  .argument("<project>", "path to project.json")
  .option("--out <dir>", "output directory")
  .option("--config <file>", "path to config file")
  .action(() => notImplemented("compile"));

program
  .command("tts")
  .description("Generate audio + subtitle timings from narration")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only process specified blocks (comma-separated)")
  .option("--force", "ignore cache, force regeneration")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .action(async (opts, cmd) => {
    const scriptPath = cmd.args[0];
    const { config } = loadConfig({
      configPath: opts.config,
      cacheDir: opts.cacheDir,
    });
    try {
      const result = await tts({
        scriptPath,
        config,
        blockIds: parseBlockIds(opts.block),
        force: opts.force,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
      console.log("TTS complete:", result);
    } catch (err: any) {
      console.error(`tts failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("visuals")
  .description("Generate React components from visual descriptions")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only process specified blocks (comma-separated)")
  .option("--force", "ignore cache, force regeneration")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .action(async (opts, cmd) => {
    const scriptPath = cmd.args[0];
    const { config } = loadConfig({
      configPath: opts.config,
      cacheDir: opts.cacheDir,
    });
    try {
      const result = await visuals({
        scriptPath,
        config,
        blockIds: parseBlockIds(opts.block),
        force: opts.force,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
      console.log("Visuals complete:", result);
    } catch (err: any) {
      console.error(`visuals failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("render")
  .description("Render blocks to MP4 partials and concatenate")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only render specified blocks (comma-separated)")
  .option("--force", "ignore cache, force re-render")
  .option("--config <file>", "path to config file")
  .option("--cache-dir <dir>", "override cache directory")
  .option("--verbose", "verbose logging")
  .option("--dry-run", "show plan without executing")
  .action(async (opts, cmd) => {
    const scriptPath = cmd.args[0];
    const { config } = loadConfig({
      configPath: opts.config,
      cacheDir: opts.cacheDir,
    });
    try {
      const result = await render({
        scriptPath,
        config,
        blockIds: parseBlockIds(opts.block),
        force: opts.force,
        verbose: opts.verbose,
        dryRun: opts.dryRun,
      });
      if (result) {
        console.log("Render complete:", result);
      }
    } catch (err: any) {
      console.error(`render failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("preview")
  .description("Open Remotion Studio for interactive block preview")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "focus on specified block (first ID becomes default)")
  .option("--port <port>", "port for Remotion Studio", parseInt)
  .option("--config <file>", "path to config file")
  .option("--verbose", "verbose logging")
  .action(async (opts, cmd) => {
    const scriptPath = cmd.args[0];
    try {
      await preview({
        scriptPath,
        blockIds: parseBlockIds(opts.block),
        port: opts.port,
        configPath: opts.config,
        verbose: opts.verbose,
      });
    } catch (err: any) {
      console.error(`preview failed: ${err.message}`);
      process.exit(1);
    }
  });

registerCacheCommand(program);

program.parse();