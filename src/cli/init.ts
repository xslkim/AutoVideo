import * as path from "path";
import * as fs from "fs";

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
  const candidates = [
    path.resolve(process.cwd(), "templates/starter"),
    path.resolve(__dirname, "../../templates/starter"),
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

  console.log(`✓ Project initialized in ${targetDir}/`);
  console.log();
  console.log("Next steps:");
  console.log(`  1. Place your reference voice file (B00.wav) in ${targetDir}/`);
  console.log("     (10–30 seconds of clear speech in WAV format)");
  console.log("  2. Set your API key:");
  console.log('     export ANTHROPIC_API_KEY="sk-ant-..."');
  console.log("  3. Check your environment:");
  console.log("     autovideo doctor");
  console.log("  4. Build the video:");
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