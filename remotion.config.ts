/**
 * AutoVideo — Remotion configuration
 */

import { Config } from "@remotion/cli/config";

// Set keyframe interval to 1 so every partial mp4 starts with an IDR frame
// This is needed for ffmpeg concat stream copy to work correctly
Config.setVideoImageFormat("jpeg");