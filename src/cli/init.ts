import * as path from "path";
import * as fs from "fs";
import { slugify } from "../utils/slugify.js";

/**
 * autovideo init <dir>
 *
 * Copies the templates/starter directory to the target directory.
 * Creates the target directory if it doesn't exist.
 * Errors if the target directory already exists and is not empty.
 */
export async function initCommand(
  targetDir: string,
  options?: { verbose?: boolean }
): Promise<void> {
  const resolvedTarget = path.resolve(targetDir);

  // Find template directory - look in several candidate locations:
  // 1. Relative to package.json (development mode)
  // 2. Relative to this source file
  // (__dirname is CJS-only; guard it so `tsx` ESM mode doesn't throw while
  // eagerly evaluating the array.)
  const candidates = [
    path.resolve(process.cwd(), "templates/starter"),
    ...(typeof __dirname !== "undefined"
      ? [path.resolve(__dirname, "../../templates/starter")]
      : []),
  ];

  let templateDir: string | undefined;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      templateDir = candidate;
      break;
    }
  }

  if (!templateDir) {
    throw new Error(
      `Template directory not found. Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}`
    );
  }

  // Check if target already exists and is non-empty
  if (fs.existsSync(resolvedTarget)) {
    const entries = fs.readdirSync(resolvedTarget);
    if (entries.length > 0) {
      throw new Error(
        `Target directory "${targetDir}" already exists and is not empty. ` +
          `Please remove it or choose a different directory.`
      );
    }
  } else {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  if (options?.verbose) {
    console.log(`Copying template from ${templateDir} to ${resolvedTarget}`);
  }

  // Copy all files from template to target
  copyDirRecursive(templateDir, resolvedTarget);

  // Write an explicit lowercase slug into meta.md. Both the CLI
  // (slugify(title)) and the Web UI (slug || project name) derive the build
  // directory from this — an explicit slug keeps them pointing at the same
  // build/<slug>/ directory.
  const metaPath = path.join(resolvedTarget, "meta.md");
  if (fs.existsSync(metaPath)) {
    const slug = slugify(path.basename(resolvedTarget));
    const lines = fs.readFileSync(metaPath, "utf-8").split("\n");
    const slugIdx = lines.findIndex((l) => l.startsWith("slug:"));
    if (slugIdx >= 0) {
      lines[slugIdx] = `slug: ${slug}`;
    } else {
      const titleIdx = lines.findIndex((l) => l.startsWith("title:"));
      if (titleIdx >= 0) lines.splice(titleIdx + 1, 0, `slug: ${slug}`);
    }
    fs.writeFileSync(metaPath, lines.join("\n"), "utf-8");
    if (options?.verbose) {
      console.log(`Set slug: ${slug}`);
    }
  }

  console.log(`✓ Project initialized in ${targetDir}/`);
  console.log();
  console.log("Next steps:");
  console.log(`  1. Place your reference voice file (B00.wav) in ${targetDir}/`);
  console.log("     (10–30 seconds of clear speech in WAV format)");
  console.log("  2. Check your environment:");
  console.log("     autovideo doctor");
  console.log("  3. Build the video:");
  console.log(`     cd ${targetDir} && autovideo build project.json`);
}

/**
 * Recursively copy a directory.
 */
function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}