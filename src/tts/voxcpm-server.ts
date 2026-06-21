/**
 * AutoVideo — VoxCPM server health check
 *
 * The framework connects to the voxcpm2-api TTS server purely over HTTP; it
 * never spawns the service itself. Start/stop the server via
 * `third_servers/voxcpm-tts/` (see its README.md).
 *
 * (PRD §6.2.1 — formerly auto-started the server; now endpoint-only so the
 * framework is portable across machines.)
 */

import { VoxcpmClient } from "./voxcpm-client.js";

export interface VoxcpmServerOptions {
  /** Base URL of the voxcpm2-api server, e.g. "http://127.0.0.1:8000" */
  endpoint: string;
}

/**
 * Verify the VoxCPM server is reachable. Throws an actionable error (pointing
 * at the deployment docs) if it isn't — the framework does not auto-start it.
 *
 * Always returns `{ started: false }` on success: the server is available but
 * not managed by this process.
 */
export async function ensureVoxcpmServer(
  client: VoxcpmClient,
  opts: VoxcpmServerOptions,
  verbose = false,
): Promise<{ started: boolean }> {
  const healthy = await client.isHealthy();
  if (healthy) {
    if (verbose) console.log(`[tts] VoxCPM server reachable at ${opts.endpoint}`);
    return { started: false };
  }
  throw new Error(
    `VoxCPM server is not reachable at ${opts.endpoint}.\n` +
      "Start it first — see third_servers/voxcpm-tts/README.md, or run `autovideo doctor`.",
  );
}
