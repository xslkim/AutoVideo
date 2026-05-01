/**
 * AutoVideo — Remotion configuration
 *
 * Allows the entry point to be overridden via REMOTION_ENTRY env var.
 * This lets preview.ts use a different root (remotion-root-preview.tsx)
 * while render.ts uses its own root (remotion-root-render.tsx).
 *
 * When no env var is set, defaults to remotion/Root.tsx for development.
 */

import { Config } from "@remotion/cli/config";

// Allow entry point override via env var
const entry = process.env.REMOTION_ENTRY ?? "remotion/Root.tsx";
Config.setEntryPoint(entry);

// Set keyframe interval to 1 so every partial mp4 starts with an IDR frame
// This is needed for ffmpeg concat stream copy to work correctly (PRD §6.4 step 6)
Config.setVideoImageFormat("jpeg");