/**
 * CacheStore — Global cache for audio, component, and partial artifacts.
 *
 * Directory layout (§11.1):
 *   {cache-dir}/
 *     manifest.json
 *     audio/{hash}.wav
 *     components/{hash}.tsx
 *     partials/{hash}.mp4
 *
 * Manifest format follows §11.3.
 * Uses proper-lockfile for safe concurrent access.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import lockfile from "proper-lockfile";
import ms from "ms";

// ── Types ────────────────────────────────────────────────────────────────

export type CacheType = "audio" | "component" | "partial" | "images";

/** Manifest entry key → type-specific key details */
export interface AudioKey {
  ttsText: string;
  voiceRefHash: string;
  cfgValue: number;
  inferenceTimesteps: number;
  denoise: boolean;
  voxcpmModelVersion: string;
}

export interface ComponentKey {
  descriptionHash: string;
  theme: string;
  width: number;
  height: number;
  promptVersion: string;
  assetHashesJson: string;
  claudeModel: string;
}

export interface PartialKey {
  componentHash: string;
  audioHash: string;
  theme: string;
  width: number;
  height: number;
  fps: number;
  enter: string;
  exit: string;
  remotionVersion: string;
}

export interface ImageKey {
  prompt: string;
  model: string;
  size: string;
  baseURL: string;
  provider: string;
  numSteps?: number;
  cfgScale?: number;
}

export type CacheKey = AudioKey | ComponentKey | PartialKey | ImageKey;

export interface ManifestEntry {
  type: CacheType;
  file: string;
  key: CacheKey;
  createdAt: string;
  lastHitAt: string;
  hitCount: number;
}

export type Manifest = Record<string, ManifestEntry>;

export interface CacheStoreOptions {
  cacheDir: string;
  maxSizeGB: number;
  evictTrigger?: "stage-start" | "manual";
}

export interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  byType: {
    audio: { count: number; sizeBytes: number };
    component: { count: number; sizeBytes: number };
    partial: { count: number; sizeBytes: number };
    images: { count: number; sizeBytes: number };
  };
}

export interface CleanOptions {
  type?: CacheType;
  olderThan?: string; // parsed by ms library (30d, 12h, 1w, 90m)
  stale?: (entry: ManifestEntry) => boolean;
}

// ── Helper: deterministic hash key ───────────────────────────────────────

function hashKey(type: CacheType, keyObj: CacheKey): string {
  const json = JSON.stringify(keyObj);
  const hash = crypto.createHash("md5").update(json).digest("hex").slice(0, 16);
  return `${type}:${hash}`;
}

// ── Helper: extension for cache type ─────────────────────────────────────

function extForType(type: CacheType): string {
  switch (type) {
    case "audio":
      return ".wav";
    case "component":
      return ".tsx";
    case "partial":
      return ".mp4";
    case "images":
      return ".png";
  }
}

// ── Helper: subdirectory for cache type ──────────────────────────────────

function dirForType(type: CacheType): string {
  switch (type) {
    case "audio":
      return "audio";
    case "component":
      return "components";
    case "partial":
      return "partials";
    case "images":
      return "images";
  }
}

// ── Helper: evict priority (lower = evict first) ────────────────────────
const EVICT_PRIORITY: Record<CacheType, number> = {
  partial: 0,
  component: 1,
  audio: 2,
  images: 3,
};

// ── Helper: ensure directory exists ──────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── CacheStore class ─────────────────────────────────────────────────────

export class CacheStore {
  private readonly cacheDir: string;
  private readonly maxSizeBytes: number;
  private readonly evictTrigger: "stage-start" | "manual";
  private readonly manifestPath: string;

  constructor(opts: CacheStoreOptions) {
    this.cacheDir = path.resolve(
      opts.cacheDir.replace(/^~/, () => process.env.HOME || "~"),
    );
    this.maxSizeBytes = opts.maxSizeGB * 1024 * 1024 * 1024;
    this.evictTrigger = opts.evictTrigger ?? "stage-start";
    this.manifestPath = path.join(this.cacheDir, "manifest.json");

    // Ensure base directories exist
    ensureDir(this.cacheDir);
    for (const t of ["audio", "components", "partials", "images"] as const) {
      ensureDir(path.join(this.cacheDir, t));
    }

    // Initialize manifest if absent
    if (!fs.existsSync(this.manifestPath)) {
      fs.writeFileSync(this.manifestPath, "{}", "utf-8");
    }
  }

  // ── Core read / write ──────────────────────────────────────────────

  /**
   * Look up a cached artifact by type + key.
   * Returns the absolute file path on hit, or null on miss.
   * Updates lastHitAt and hitCount on hit.
   */
  async get(type: CacheType, key: CacheKey): Promise<string | null> {
    const id = hashKey(type, key);
    return this._withLock(async () => {
      const manifest = this._readManifest();
      const entry = manifest[id];
      if (!entry) return null;

      const filePath = path.join(this.cacheDir, entry.file);
      if (!fs.existsSync(filePath)) {
        // File disappeared — clean stale entry
        delete manifest[id];
        this._writeManifest(manifest);
        return null;
      }

      // Update hit metadata
      entry.lastHitAt = new Date().toISOString();
      entry.hitCount += 1;
      this._writeManifest(manifest);

      return filePath;
    });
  }

  /**
   * Store a file in the cache. Copies `file` into the cache directory.
   * `keyMetadata` is the type-specific key object stored in manifest.
   */
  async put(
    type: CacheType,
    key: CacheKey,
    file: string,
    keyMetadata: CacheKey,
  ): Promise<string> {
    const id = hashKey(type, key);
    const hashPart = id.split(":")[1];
    const ext = extForType(type);
    const relFile = `${dirForType(type)}/${hashPart}${ext}`;
    const absFile = path.join(this.cacheDir, relFile);

    return this._withLock(async () => {
      const manifest = this._readManifest();

      // Copy file into cache
      fs.copyFileSync(file, absFile);

      // Upsert manifest entry
      manifest[id] = {
        type,
        file: relFile,
        key: keyMetadata,
        createdAt: manifest[id]?.createdAt ?? new Date().toISOString(),
        lastHitAt: new Date().toISOString(),
        hitCount: manifest[id]?.hitCount ?? 0,
      };
      this._writeManifest(manifest);

      return absFile;
    });
  }

  // ── Stats ──────────────────────────────────────────────────────────

  /**
   * Return aggregate stats about the cache.
   */
  async stats(): Promise<CacheStats> {
    return this._withLock(async () => {
      const manifest = this._readManifest();
      const stats: CacheStats = {
        totalEntries: 0,
        totalSizeBytes: 0,
        byType: {
          audio: { count: 0, sizeBytes: 0 },
          component: { count: 0, sizeBytes: 0 },
          partial: { count: 0, sizeBytes: 0 },
          images: { count: 0, sizeBytes: 0 },
        },
      };

      for (const [, entry] of Object.entries(manifest)) {
        const t = entry.type as CacheType;
        const filePath = path.join(this.cacheDir, entry.file);
        let size = 0;
        try {
          size = fs.statSync(filePath).size;
        } catch {
          // File missing — skip
        }
        stats.totalEntries += 1;
        stats.totalSizeBytes += size;
        stats.byType[t].count += 1;
        stats.byType[t].sizeBytes += size;
      }

      return stats;
    });
  }

  // ── Clean ──────────────────────────────────────────────────────────

  /**
   * Remove entries matching the given options.
   */
  async clean(opts: CleanOptions = {}): Promise<number> {
    return this._withLock(async () => {
      const manifest = this._readManifest();
      let removed = 0;

      const olderThanMs =
        opts.olderThan != null ? ms(opts.olderThan) : null;

      if (olderThanMs !== null && typeof olderThanMs !== "number") {
        throw new Error(`Invalid --older-than value: ${opts.olderThan}`);
      }

      const now = Date.now();

      for (const [id, entry] of Object.entries(manifest)) {
        // Filter by type
        if (opts.type && entry.type !== opts.type) continue;

        // Filter by age
        if (olderThanMs !== null) {
          const age = now - new Date(entry.createdAt).getTime();
          if (age < olderThanMs) continue;
        }

        // Filter by stale predicate
        if (opts.stale && !opts.stale(entry)) continue;

        // Remove file
        const filePath = path.join(this.cacheDir, entry.file);
        try {
          fs.unlinkSync(filePath);
        } catch {
          // File already gone
        }

        delete manifest[id];
        removed += 1;
      }

      this._writeManifest(manifest);
      return removed;
    });
  }

  // ── Eviction ───────────────────────────────────────────────────────

  /**
   * Check total cache size and evict LRU entries if over maxSizeGB.
   * Eviction order: partials first, then components, then audio.
   * Within each type, evict by lastHitAt ascending (LRU).
   *
   * @param stageName - current stage name; used to decide if eviction should run
   *   (only tts / visuals / render trigger eviction when evictTrigger="stage-start").
   * @returns number of entries evicted
   */
  async evictIfOverLimit(stageName?: string): Promise<number> {
    // Check trigger policy
    if (this.evictTrigger === "stage-start" && stageName) {
      const allowedStages = ["tts", "visuals", "render"];
      if (!allowedStages.includes(stageName)) {
        return 0;
      }
    }

    return this._withLock(async () => {
      const manifest = this._readManifest();
      const totalSize = this._computeTotalSize(manifest);

      if (totalSize <= this.maxSizeBytes) return 0;

      // Sort entries by eviction priority: type (partial→component→audio), then lastHitAt ascending
      const entries = Object.entries(manifest).sort((a, b) => {
        const priA = EVICT_PRIORITY[a[1].type as CacheType];
        const priB = EVICT_PRIORITY[b[1].type as CacheType];
        if (priA !== priB) return priA - priB; // lower priority number evicted first
        return (
          new Date(a[1].lastHitAt).getTime() -
          new Date(b[1].lastHitAt).getTime()
        );
      });

      let evicted = 0;
      let freedBytes = 0;

      for (const [id, entry] of entries) {
        if (totalSize - freedBytes <= this.maxSizeBytes) break;

        const filePath = path.join(this.cacheDir, entry.file);
        let fileSize = 0;
        try {
          fileSize = fs.statSync(filePath).size;
          fs.unlinkSync(filePath);
        } catch {
          // File already gone
        }

        delete manifest[id];
        freedBytes += fileSize;
        evicted += 1;
      }

      this._writeManifest(manifest);
      return evicted;
    });
  }

  // ── Manifest helpers ───────────────────────────────────────────────

  private _readManifest(): Manifest {
    try {
      const raw = fs.readFileSync(this.manifestPath, "utf-8");
      return JSON.parse(raw) as Manifest;
    } catch {
      return {};
    }
  }

  private _writeManifest(manifest: Manifest): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  private _computeTotalSize(manifest: Manifest): number {
    let total = 0;
    for (const entry of Object.values(manifest)) {
      try {
        total += fs.statSync(path.join(this.cacheDir, entry.file)).size;
      } catch {
        // File missing
      }
    }
    return total;
  }

  // ── Locking ────────────────────────────────────────────────────────

  /**
   * Run `fn` while holding a lock on the manifest file.
   * Uses proper-lockfile with retry options for concurrency safety.
   */
  private async _withLock<T>(fn: () => T): Promise<T> {
    // Ensure manifest file exists before locking
    if (!fs.existsSync(this.manifestPath)) {
      fs.writeFileSync(this.manifestPath, "{}", "utf-8");
    }

    const release = await lockfile.lock(this.manifestPath, {
      retries: {
        retries: 10,
        minTimeout: 50,
        maxTimeout: 500,
      },
      stale: 10000, // consider lock stale after 10s
    });

    try {
      return fn();
    } finally {
      await release();
    }
  }

  /** Expose the cache dir path for external consumers */
  get dir(): string {
    return this.cacheDir;
  }
}