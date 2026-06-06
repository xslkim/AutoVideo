import React from "react";
import { interpolate, Easing } from "remotion";

const PipelineFlow = ({
  frame,
  durationInFrames: _durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}) => {
  const availH = height - subtitleSafeBottom;
  const pad = Math.min(width, height) * 0.04;

  const NODES = [
    "顶点数据",
    "顶点着色",
    "裁剪",
    "光栅化",
    "片元着色",
    "帧缓冲",
  ];
  const N = NODES.length;

  /* ── layout ── */
  const contentW = width * 0.9;
  const nH = 120;
  const gap = Math.min(64, contentW * 0.04);
  const nW = (contentW - gap * (N - 1)) / N;
  const totalW = nW * N + gap * (N - 1);
  const startX = (width - totalW) / 2;
  const centerY = availH * 0.52;

  /* ── timing ── */
  const stagger = Math.round(fps * 0.4);
  const dotStart = Math.round(fps * 3);
  const dotDur = Math.round(fps * 1.5);

  /* ── helpers ── */
  const nodeOp = (i) =>
    interpolate(
      frame,
      [stagger * i, stagger * i + 12],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  const nodeOff = (i) =>
    interpolate(
      frame,
      [stagger * i, stagger * i + 12],
      [20, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  const arrP = (i) =>
    interpolate(
      frame,
      [stagger * (i + 1), stagger * (i + 1) + 14],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );

  /* ── flowing dot ── */
  const dotElapsed = frame - dotStart;
  const totalDotT = dotDur * 2;
  let dotActive = false;
  let dotX = 0;
  if (dotElapsed >= 0) {
    dotActive = true;
    if (dotElapsed >= totalDotT) {
      dotX = startX + totalW;
    } else {
      const cycleP = (dotElapsed % dotDur) / dotDur;
      const easedP = Easing.inOut(Easing.ease)(cycleP);
      dotX = startX + easedP * totalW;
    }
  }

  /* ── bottom text ── */
  const textShow = stagger * 5 + Math.round(fps * 0.6);
  const textOpacity = interpolate(
    frame,
    [textShow, textShow + 12],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: "#0d1117",
        position: "relative",
        overflow: "hidden",
        fontFamily: theme.fonts?.sans || "sans-serif",
      }}
    >
      {/* ── background grid ── */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <defs>
          <pattern
            id="g"
            width={48}
            height={48}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={24} cy={24} r={0.8} fill="#1c2333" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#g)" />
      </svg>

      {/* ── watermark ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: height * 0.11,
          color: "#151c2e",
          fontWeight: 800,
          letterSpacing: "0.08em",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        GPU PIPELINE
      </div>

      {/* ── top accent bar ── */}
      <div
        style={{
          position: "absolute",
          top: pad,
          left: width * 0.04,
          width: width * 0.92,
          height: 2,
          backgroundColor: theme.colors.accent,
          opacity: 0.2,
        }}
      />

      {/* ── pipeline track ── */}
      <div
        style={{
          position: "absolute",
          left: startX,
          top: centerY,
          width: totalW,
          height: 2,
          backgroundColor: "#21262d",
          opacity: 0.5,
        }}
      />

      {/* ── arrows (SVG) ── */}
      <svg
        width={width}
        height={height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
        }}
      >
        <defs>
          <marker
            id="ah"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill={theme.colors.accent} />
          </marker>
        </defs>

        {NODES.slice(0, -1).map((_, i) => {
          const p = arrP(i);
          const x1 = startX + (i + 1) * nW + i * gap;
          const x2 = startX + (i + 1) * (nW + gap);
          const cx = x1 + (x2 - x1) * p;
          return (
            <line
              key={`a${i}`}
              x1={x1}
              y1={centerY}
              x2={cx}
              y2={centerY}
              stroke={theme.colors.accent}
              strokeWidth={3}
              markerEnd="url(#ah)"
              opacity={p}
            />
          );
        })}
      </svg>

      {/* ── nodes ── */}
      {NODES.map((t, i) => (
        <div
          key={`n${i}`}
          style={{
            position: "absolute",
            left: startX + i * (nW + gap),
            top: centerY - nH / 2 + nodeOff(i),
            width: nW,
            height: nH,
            borderRadius: 12,
            backgroundColor: "#161b22",
            border: "1px solid #30363d",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            color: "#ffffff",
            fontWeight: 500,
            opacity: nodeOp(i),
            boxSizing: "border-box",
          }}
        >
          {t}
        </div>
      ))}

      {/* ── flowing accent dot ── */}
      {dotActive && (
        <div
          style={{
            position: "absolute",
            left: dotX - 10,
            top: centerY - 10,
            width: 20,
            height: 20,
            borderRadius: "50%",
            backgroundColor: theme.colors.accent,
            boxShadow: [
              `0 0 14px 5px ${theme.colors.accent}88`,
              `0 0 40px 12px ${theme.colors.accent}33`,
            ].join(", "),
            zIndex: 10,
          }}
        />
      )}

      {/* ── bottom description ── */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: subtitleSafeBottom + 14,
          width: "100%",
          textAlign: "center",
          fontSize: 24,
          color: "#8b949e",
          opacity: textOpacity,
          letterSpacing: "0.3px",
        }}
      >
        这一整套，GPU 用硬件做，我们用 C++ 一行行模拟
      </div>
    </div>
  );
};

export default PipelineFlow;
