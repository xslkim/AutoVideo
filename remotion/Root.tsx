/**
 * AutoVideo — Remotion Root (test / preview / render)
 *
 * Registers test compositions for SubtitleOverlay acceptance testing,
 * and a parameterized BlockComposition for block rendering.
 *
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
import { SubtitleOverlay } from "./components/SubtitleOverlay";
import { BlockComposition } from "./VideoComposition";
import type { BlockCompositionProps } from "./VideoComposition";
import { getTheme } from "./engine/theme";

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
  const { fps, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
          color: theme.colors.muted,
          fontSize: 48,
          fontFamily: theme.fonts.sans,
        }}
      >
        Subtitle Test — watch below
      </div>
      <SubtitleOverlay
        lines={TEST_LINES}
        lineTimings={TEST_LINE_TIMINGS}
        audioStartFrame={0}
        frame={frame}
        fps={fps}
        theme={theme}
        subtitleSafeBottom={Math.round(height * 0.2)}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Root — register all compositions
// ---------------------------------------------------------------------------

// Remotion Composition requires component to accept Record<string, unknown>,
// but our BlockComposition requires { blockId: string }.
// Cast through unknown to satisfy TypeScript.
const BlockComp = BlockComposition as unknown as React.FC<
  Record<string, unknown>
>;

const Root: React.FC = () => {
  return (
    <>
      {/* SubtitleOverlay test composition (existing) */}
      <Composition
        id="SubtitleTest"
        component={SubtitleTestComp}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />

      {/* BlockComposition — parameterized by blockId */}
      <Composition
        id="Block"
        component={BlockComp}
        durationInFrames={1} // placeholder; calculateMetadata overrides
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ blockId: "B01" }}
        calculateMetadata={async ({ props }) => {
          const blockId = (props as unknown as BlockCompositionProps).blockId;
          // Fetch script.json to get block timing
          try {
            const resp = await fetch(
              `${window.remotion_staticBase ?? ""}/script.json`,
            );
            const script = await resp.json();
            const block = script.blocks?.find((b: any) => b.id === blockId);
            if (block?.timing?.frames) {
              return {
                durationInFrames: block.timing.frames,
                fps: script.meta?.fps ?? 30,
                width: script.meta?.width ?? 1920,
                height: script.meta?.height ?? 1080,
              };
            }
          } catch {
            // Fallback — use defaults
          }
          return {
            durationInFrames: 150, // 5s at 30fps fallback
            fps: 30,
            width: 1920,
            height: 1080,
          };
        }}
      />
    </>
  );
};

registerRoot(Root);