/**
 * Partial cache key — libraryHash is part of the partial identity: two keys
 * that differ only in libraryHash must not hit the same cached MP4.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CacheStore, type PartialKey } from "../../src/cache/store.js";

function makeKey(libraryHash: string): PartialKey {
  return {
    componentHash: "component-1",
    audioHash: "audio-1",
    theme: "dark-code",
    width: 1920,
    height: 1080,
    fps: 30,
    enter: "fade",
    exit: "fade",
    remotionVersion: "4.0.380",
    libraryHash,
  };
}

describe("PartialKey libraryHash", () => {
  let cacheDir = "";

  afterEach(() => {
    if (cacheDir) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      cacheDir = "";
    }
  });

  it("produces a different cache entry when only libraryHash changes", async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-cache-test-"));
    const store = new CacheStore({
      cacheDir,
      maxSizeGB: 1,
      evictTrigger: "manual",
    });

    const partial = path.join(cacheDir, "partial.mp4");
    fs.writeFileSync(partial, "fake mp4");

    await store.put("partial", makeKey("lib-hash-a"), partial, makeKey("lib-hash-a"));

    // Same everything except libraryHash → miss.
    expect(await store.get("partial", makeKey("lib-hash-b"))).toBeNull();
    // Identical key → hit.
    expect(await store.get("partial", makeKey("lib-hash-a"))).not.toBeNull();
  });
});
