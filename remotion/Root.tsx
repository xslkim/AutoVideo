/**
 * AutoVideo — Remotion Root (test / preview)
 *
 * Registers test compositions for SubtitleOverlay acceptance testing.
 * Run with:  npx remotion studio remotion/Root.tsx
 */

import React from "react";
import {
  Composition,
  registerRoot,
  useCurrentFrame,
  useVideoConfig,
  AbsoluteFill,
} from "remotion";
import { SubtitleOverlay } from "./components/SubtitleOverlay.js";
import { getTheme } from "./engine/theme.js";

// ---------------------------------------------------------------------------
// Test data — mimics a block with multiple narration lines and highlights
// ---------------------------------------------------------------------------

const TEST_LINES = [
  {
    text: "这是**重要**的概念",
    ttsText: "这是重要的概念",
    highlights: [{ start: 2, end: 4 }], // "重要"
  },
  {
    text: "另一个没有高亮的句子",
    ttsText: "另一个没有高亮的句子",
    highlights: [],
  },
  {
    text: "AutoVideo 支持**多段**高亮和**测试**",
    ttsText: "AutoVideo 支持多段高亮和测试",
    highlights: [
      { start: 12, end: 14 }, // "多段"
      { start: 17, end: 19 }, // "测试"
    ],
  },
];

// Timings: 3 lines, each 2000ms with 200ms gaps between them
const TEST_LINE_TIMINGS = [
  { lineIndex: 0, startMs: 0, endMs: 2000 },
  { lineIndex: 1, startMs: 2200, endMs: 4200 },
  { lineIndex: 2, startMs: 4400, endMs: 6400 },
];

const theme = getTheme("dark-code");

// ---------------------------------------------------------------------------
// Test composition component
// ---------------------------------------------------------------------------

const SubtitleTestComp: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: theme.colors.bg } },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
          color: theme.colors.muted,
          fontSize: 48,
          fontFamily: theme.fonts.sans,
        },
      },
      `SubtitleOverlay Test — frame ${frame}`,
    ),
    React.createElement(SubtitleOverlay, {
      lines: TEST_LINES,
      lineTimings: TEST_LINE_TIMINGS,
      audioStartFrame: 15, // 0.5s enter at 30fps
      frame,
      fps,
      theme,
    }),
  );
};

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

const Root: React.FC = () => {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Composition, {
      id: "SubtitleOverlayTest",
      component: SubtitleTestComp,
      durationInFrames: 210, // 7 seconds at 30fps
      fps: 30,
      width: 1920,
      height: 1080,
    }),
  );
};

registerRoot(Root);