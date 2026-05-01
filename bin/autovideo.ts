#!/usr/bin/env node
import { Command } from "commander";

const notImplemented = (cmdName: string) => {
  console.error(`${cmdName}: not implemented`);
  process.exit(1);
};

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
  .action(() => notImplemented("tts"));

program
  .command("visuals")
  .description("Generate React components from visual descriptions via Claude")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only process specified blocks (comma-separated)")
  .option("--force", "ignore cache, force regeneration")
  .option("--config <file>", "path to config file")
  .action(() => notImplemented("visuals"));

program
  .command("render")
  .description("Render blocks to MP4 via Remotion + ffmpeg concat")
  .argument("<script>", "path to script.json")
  .option("--block <ids>", "only render specified blocks (comma-separated)")
  .option("--force", "ignore cache, force re-render")
  .option("--config <file>", "path to config file")
  .action(() => notImplemented("render"));

program
  .command("preview")
  .description("Open Remotion Studio for interactive preview")
  .argument("<script>", "path to script.json")
  .option("--block <id>", "preview a specific block")
  .option("--config <file>", "path to config file")
  .action(() => notImplemented("preview"));

program
  .command("cache")
  .description("Manage cache: stats or clean")
  .argument("[action]", "stats or clean")
  .option("--type <type>", "cache type: audio | component | partial")
  .option("--older-than <duration>", "clean entries older than duration (e.g. 30d, 12h)")
  .option("--stale", "clean stale entries only")
  .action(() => notImplemented("cache"));

program
  .command("doctor")
  .description("Check environment and dependencies")
  .action(() => notImplemented("doctor"));

program
  .command("init")
  .description("Generate a starter project template")
  .argument("<dir>", "target directory")
  .action(() => notImplemented("init"));

program.parse();
