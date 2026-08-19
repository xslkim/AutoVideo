import { stripVisualComments } from '../../src/parser/assets.js';

/** Match relative asset paths in script.md (allows spaces / Unicode in filenames). */
export const SCRIPT_ASSET_REF_REGEX =
  /\.\/[^)\n]+?\.(?:png|jpe?g|gif|webp|svg|wav|mp4)\b/gi;

/** Collect unique `./…ext` paths referenced in a script markdown file. */
export function extractScriptAssetRefs(scriptContent: string): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  // HTML comments are documentation-only: paths inside them are not assets.
  for (const match of stripVisualComments(scriptContent).matchAll(SCRIPT_ASSET_REF_REGEX)) {
    const ref = match[0];
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}
