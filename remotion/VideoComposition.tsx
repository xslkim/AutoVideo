/**
 * AutoVideo — BlockComposition (render & preview)
 *
 * Renders a single block: dynamic LLM-generated component + subtitle overlay
 * + audio, wrapped in BlockFrame with enter/exit animations.
 *
 * script.json is loaded via staticFile('script.json') at render time.
 *
 * @see PRD §6.4 step 3 — render structure
 */

import React, { lazy, Suspense, useState, useEffect } from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  Sequence,
  Audio,
  AbsoluteFill,
} from "remotion";
import { BlockFrame } from "./engine/block-frame";
import { SubtitleOverlay } from "./components/SubtitleOverlay";
import { getTheme } from "./engine/theme";
import type {
  AnimationPreset,
  NarrationLine,
  Theme,
} from "./engine/types";

// ---------------------------------------------------------------------------
// script.json data types (what we need from it)
// ---------------------------------------------------------------------------

interface ScriptMeta {
  schemaVersion: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  theme: string;
  subtitleSafeBottom: number;
}

interface LineTiming {
  lineIndex: number;
  startMs: number;
  endMs: number;
}

interface BlockData {
  id: string;
  title: string;
  enter: AnimationPreset;
  exit: AnimationPreset;
  visual: {
    description: string;
    componentPath?: string;
  };
  narration: {
    lines: NarrationLine[];
    explicitDurationSec?: number;
  };
  audio?: {
    wavPath: string;
    durationSec: number;
    lineTimings: LineTiming[];
  };
  timing?: {
    enterSec: number;
    holdSec: number;
    exitSec: number;
    totalSec: number;
    frames: number;
    enterFrames: number;
  };
}

interface ScriptData {
  meta: ScriptMeta;
  blocks: BlockData[];
}

// ---------------------------------------------------------------------------
// Script loader hook — fetches script.json once via staticFile
// ---------------------------------------------------------------------------

function useScript(): ScriptData | null {
  const [script, setScript] = useState<ScriptData | null>(null);

  useEffect(() => {
    fetch(staticFile("script.json"))
      .then((r) => r.json())
      .then(setScript)
      .catch((err) => {
        console.error("Failed to load script.json:", err);
      });
  }, []);

  return script;
}

// ---------------------------------------------------------------------------
// Dynamic component cache — avoids re-creating lazy components on re-render
// ---------------------------------------------------------------------------

const componentCache = new Map<
  string,
  React.LazyExoticComponent<React.ComponentType<any>>
>();

function getDynamicComponent(
  blockId: string,
): React.LazyExoticComponent<React.ComponentType<any>> {
  if (!componentCache.has(blockId)) {
    const LazyComp = lazy(() =>
      import(`../src/blocks/${blockId}/Component`).catch(() => {
        const Placeholder: React.FC = () => (
          <AbsoluteFill
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              color: "#8b949e",
              fontSize: 48,
            }}
          >
            Block {blockId} — component not found
          </AbsoluteFill>
        );
        return { default: Placeholder };
      }),
    );
    componentCache.set(blockId, LazyComp);
  }
  return componentCache.get(blockId)!;
}

// ---------------------------------------------------------------------------
// BlockComposition — main component
// ---------------------------------------------------------------------------

export interface BlockCompositionProps {
  blockId: string;
}

export const BlockComposition: React.FC<BlockCompositionProps> = ({
  blockId,
}) => {
  const script = useScript();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Loading state
  if (!script) {
    return (
      <AbsoluteFill
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0d1117",
          color: "#8b949e",
          fontSize: 36,
        }}
      >
        Loading script.json…
      </AbsoluteFill>
    );
  }

  // Find our block
  const block = script.blocks.find((b) => b.id === blockId);
  if (!block) {
    return (
      <AbsoluteFill
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0d1117",
          color: "#ff7b72",
          fontSize: 36,
        }}
      >
        Block "{blockId}" not found in script.json
      </AbsoluteFill>
    );
  }

  const theme = getTheme(script.meta.theme);

  // Timing — from block.timing (set by render stage), or fallback defaults
  const enterFrames = block.timing?.enterFrames ?? Math.round(0.5 * fps);
  const holdFrames = block.timing
    ? Math.round(block.timing.holdSec * fps)
    : Math.round(5 * fps);
  const exitFrames = block.timing
    ? block.timing.frames - enterFrames - holdFrames
    : Math.round(0.3 * fps);
  const durationInFrames =
    block.timing?.frames ?? enterFrames + holdFrames + exitFrames;

  // Dynamic component
  const DynamicComponent = getDynamicComponent(blockId);

  // AnimationProps for the dynamic component
  const animProps = {
    frame,
    durationInFrames,
    width,
    height,
    subtitleSafeBottom: script.meta.subtitleSafeBottom,
    theme,
    fps,
  };

  return (
    <BlockFrame
      enter={block.enter}
      exit={block.exit}
      enterFrames={enterFrames}
      exitFrames={exitFrames}
      durationInFrames={durationInFrames}
      fps={fps}
    >
      {/* 1. Dynamic LLM-generated component (with Suspense fallback) */}
      <Suspense
        key="component"
        fallback={
          <AbsoluteFill style={{ backgroundColor: theme.colors.bg }} />
        }
      >
        <DynamicComponent {...animProps} key={`comp-${blockId}`} />
      </Suspense>

      {/* 2. Subtitle overlay (only when lineTimings available) */}
      {block.audio?.lineTimings ? (
        <SubtitleOverlay
          lines={block.narration.lines}
          lineTimings={block.audio.lineTimings}
          audioStartFrame={enterFrames}
          frame={frame}
          fps={fps}
          theme={theme}
          subtitleSafeBottom={script.meta.subtitleSafeBottom}
        />
      ) : null}

      {/* 3. Audio — starts after enter animation via Sequence */}
      {block.audio ? (
        <Sequence from={enterFrames}>
          <Audio src={staticFile(`audio/${block.id}.wav`)} />
        </Sequence>
      ) : null}
    </BlockFrame>
  );
};