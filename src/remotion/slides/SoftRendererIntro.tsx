import React from "react";
import { interpolate } from "remotion";

export default function SoftRendererIntro({
  frame,
  width,
  height,
  subtitleSafeBottom = 50,
  theme,
  fps = 30,
}) {
  const padding = Math.min(width, height) * 0.055;
  const contentWidth = width - padding * 2;
  const safeArea = subtitleSafeBottom;
  const availableHeight = height - safeArea;

  // Scale-computed font sizes
  const titleFs = Math.max(height * 0.074, 64);
  const subtitleFs = Math.max(height * 0.046, 40);
  const cardTitleFs = Math.max(height * 0.03, 24);
  const cardDescFs = Math.max(height * 0.022, 18);

  // Estimate title text width for accent line (8 Chinese chars × ~1.12em each)
  const estimatedTitleWidth = Math.min(
    8 * titleFs * 1.12,
    contentWidth * 0.72
  );

  // ---------- Animations ----------

  // Title: 0s → 0.5s fade in with slight slide-up
  const titleOpacity = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 0.5 * fps], [20, 0], {
    extrapolateRight: "clamp",
  });

  // Subtitle: 0.6s → 1.0s fade in
  const subOpacity = interpolate(
    frame,
    [0.6 * fps, 1.0 * fps],
    [0, 1],
    { extrapolateRight: "clamp" }
  );
  const subY = interpolate(frame, [0.6 * fps, 1.0 * fps], [15, 0], {
    extrapolateRight: "clamp",
  });

  // Accent line: 1.2s → 1.7s sweep left to right via scaleX
  const lineScaleX = interpolate(
    frame,
    [1.2 * fps, 1.7 * fps],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  // ---------- Cards ----------
  const allCards = [
    { title: "① 全局视角", desc: "管线总览" },
    { title: "② 坐标变换", desc: "MVP 矩阵" },
    { title: "③ 裁剪光栅化", desc: "三角形变像素" },
    { title: "④ 着色光照", desc: "PBR 与法线" },
    { title: "⑤ 性能优化", desc: "多线程" },
  ];

  const cardAreaWidth = width * 0.92;
  const cardGap = 32;
  const cardWidth = (cardAreaWidth - (allCards.length - 1) * cardGap) / allCards.length;
  const cardHeight = height * 0.222; // ~240px @1080p

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: theme.colors.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.fonts?.sans || "system-ui, -apple-system, sans-serif",
        position: "relative",
        overflow: "hidden",
        paddingBottom: safeArea,
        boxSizing: "border-box",
      }}
    >
      {/* Background: subtle dot grid for visual richness */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          width,
          height,
          backgroundImage: `radial-gradient(circle, ${theme.colors.accent}12 1px, transparent 1px)`,
          backgroundSize: `42px 42px`,
          pointerEvents: "none",
        }}
      />

      {/* Subtle radial glow at center */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: Math.min(width, height) * 0.6,
          height: Math.min(width, height) * 0.6,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.colors.accent}08 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* ----- Content cluster ----- */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: availableHeight,
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* ----- Main Title ----- */}
        <h1
          style={{
            fontSize: titleFs,
            fontWeight: 900,
            color: theme.colors.fg,
            margin: 0,
            padding: 0,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            textAlign: "center",
            lineHeight: 1.15,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {"从零写一个软渲染器"}
        </h1>

        {/* ----- Subtitle ----- */}
        <div
          style={{
            fontSize: subtitleFs,
            color: theme.colors.muted,
            marginTop: 28,
            opacity: subOpacity,
            transform: `translateY(${subY}px)`,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          面向 C++ 程序员，不需要图形学基础
        </div>

        {/* ----- Accent line (sweep left→right) ----- */}
        <div
          style={{
            marginTop: 28,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.accent,
            width: estimatedTitleWidth,
            transform: `scaleX(${lineScaleX})`,
            transformOrigin: "left center",
          }}
        />

        {/* ----- 5 Cards row ----- */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "stretch",
            gap: cardGap,
            marginTop: 48,
            width: cardAreaWidth,
            flexWrap: "nowrap",
          }}
        >
          {allCards.map((card, i) => {
            const startFrame = (2 + i * 0.3) * fps;
            const endFrame = startFrame + 0.35 * fps;

            const cardOpacity = interpolate(
              frame,
              [startFrame, endFrame],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            const cardY = interpolate(
              frame,
              [startFrame, endFrame],
              [60, 0],
              { extrapolateRight: "clamp" }
            );

            return (
              <div
                key={i}
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: "#161b22",
                  border: "1px solid #30363d",
                  borderRadius: 16,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 12px",
                  opacity: cardOpacity,
                  transform: `translateY(${cardY}px)`,
                  flexShrink: 0,
                  boxSizing: "border-box",
                  transition: "box-shadow 0.2s",
                }}
              >
                <div
                  style={{
                    fontSize: cardTitleFs,
                    fontWeight: 700,
                    color: theme.colors.fg,
                    textAlign: "center",
                    lineHeight: 1.3,
                  }}
                >
                  {card.title}
                </div>
                <div
                  style={{
                    fontSize: cardDescFs,
                    color: theme.colors.muted,
                    marginTop: 8,
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}
                >
                  {card.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
