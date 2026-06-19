import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";

interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: {
    colors: {
      bg: string;
      fg: string;
      accent: string;
      muted: string;
      code: { bg: string; fg: string; keyword: string; string: string; comment: string };
    };
    fonts: { sans: string; mono: string };
    spacing: { unit: number };
    subtitle: {
      fontFamily: string;
      fontSizePct: number;
      lineHeight: number;
      maxWidthPct: number;
      backgroundColor: string;
      paddingPx: number;
    };
  };
  fps: number;
}

const NODES = ["顶点数据", "顶点着色", "裁剪", "光栅化", "片元着色", "帧缓冲"];

const PipelineFlow: React.FC<AnimationProps> = (props) => {
  const { width, height, subtitleSafeBottom, theme } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const accent = theme.colors.accent;
  const availH = height - subtitleSafeBottom;

  // Layout
  const flowWidth = width * 0.92;
  const flowLeft = (width - flowWidth) / 2;
  const n = NODES.length;
  const gap = flowWidth * 0.035;
  const nodeWidth = (flowWidth - gap * (n - 1)) / n;
  const nodeHeight = Math.max(130, availH * 0.18);
  const radius = 12;
  const centerY = availH * 0.5;
  const nodeTop = centerY - nodeHeight / 2;

  const nodeFontSize = Math.max(30, height * 0.028);
  const captionFontSize = Math.max(26, height * 0.024);

  // Timing
  const stagger = 0.35 * fps;
  const fadeDur = 0.45 * fps;
  const allInFrame = 2.5 * fps;

  // Flowing light: start after all nodes appear, loop twice
  const flowStart = allInFrame;
  const flowCycle = 2.0 * fps; // one pass duration
  const flowLoops = 2;
  const flowProgressRaw = (frame - flowStart) / flowCycle;
  const flowActive = frame >= flowStart && flowProgressRaw < flowLoops;
  const flowT = flowActive ? flowProgressRaw % 1 : -1;

  const nodeCenterX = (i: number) => flowLeft + i * (nodeWidth + gap) + nodeWidth / 2;
  const lightX = flowT >= 0 ? interpolate(flowT, [0, 1], [nodeCenterX(0), nodeCenterX(n - 1)]) : -9999;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1117", fontFamily: theme.fonts.sans }}>
      {/* subtle background grid */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(#161b2233 1px, transparent 1px), linear-gradient(90deg, #161b2233 1px, transparent 1px)",
          backgroundSize: `${width * 0.05}px ${width * 0.05}px`,
          opacity: 0.5,
        }}
      />

      {/* Arrows */}
      {NODES.slice(0, n - 1).map((_, i) => {
        const arrowStart = i * stagger + fadeDur * 0.6;
        const draw = interpolate(frame, [arrowStart, arrowStart + fadeDur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const x1 = flowLeft + i * (nodeWidth + gap) + nodeWidth;
        const x2 = x1 + gap;
        const fullLen = x2 - x1;
        const curLen = fullLen * draw;
        return (
          <div
            key={`arrow-${i}`}
            style={{
              position: "absolute",
              left: x1,
              top: centerY - 1.5,
              width: curLen,
              height: 3,
              backgroundColor: accent,
              opacity: draw,
            }}
          >
            {draw > 0.6 && (
              <div
                style={{
                  position: "absolute",
                  right: -1,
                  top: -6,
                  width: 0,
                  height: 0,
                  borderTop: "7px solid transparent",
                  borderBottom: "7px solid transparent",
                  borderLeft: `12px solid ${accent}`,
                }}
              />
            )}
          </div>
        );
      })}

      {/* Nodes */}
      {NODES.map((label, i) => {
        const start = i * stagger;
        const appear = interpolate(frame, [start, start + fadeDur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const slide = interpolate(appear, [0, 1], [-30, 0]);
        const left = flowLeft + i * (nodeWidth + gap);

        // light glow when passing this node
        const cx = nodeCenterX(i);
        const dist = Math.abs(lightX - cx);
        const glow = flowT >= 0 ? Math.max(0, 1 - dist / (nodeWidth * 0.9)) : 0;

        return (
          <div
            key={`node-${i}`}
            style={{
              position: "absolute",
              left,
              top: nodeTop,
              width: nodeWidth,
              height: nodeHeight,
              borderRadius: radius,
              backgroundColor: "#161b22",
              border: `1px solid ${glow > 0.1 ? accent : "#30363d"}`,
              boxShadow: glow > 0.1 ? `0 0 ${30 * glow}px ${accent}` : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: nodeFontSize,
              fontWeight: 600,
              opacity: appear,
              transform: `translateX(${slide}px)`,
              textAlign: "center",
              padding: "0 8px",
            }}
          >
            {label}
          </div>
        );
      })}

      {/* Flowing light dot */}
      {flowT >= 0 && (
        <div
          style={{
            position: "absolute",
            left: lightX - 12,
            top: centerY - 12,
            width: 24,
            height: 24,
            borderRadius: "50%",
            backgroundColor: accent,
            boxShadow: `0 0 24px 8px ${accent}`,
          }}
        />
      )}

      {/* Bottom caption */}
      <div
        style={{
          position: "absolute",
          left: flowLeft,
          right: flowLeft,
          top: nodeTop + nodeHeight + availH * 0.12,
          textAlign: "center",
          color: "#8b949e",
          fontSize: captionFontSize,
          opacity: interpolate(frame, [allInFrame - fps * 0.5, allInFrame], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        GPU 用硬件电路做这一整套，我们用 C++ 一行行模拟。
      </div>
    </AbsoluteFill>
  );
};

export default PipelineFlow;
