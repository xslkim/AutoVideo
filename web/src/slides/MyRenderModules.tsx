import React from "react";
import { interpolate, AbsoluteFill } from "remotion";

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

export default function MyRenderModules({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}: AnimationProps) {
  const availableHeight = height - subtitleSafeBottom;
  const TITLE_TOP = height * 0.065;
  const TITLE_FONT = Math.max(height * 0.07, 56);
  const CARD_TITLE_FONT = Math.max(height * 0.045, 38);
  const DESC_FONT = Math.max(height * 0.025, 26);
  const ICON_SIZE = height * 0.067;
  const CAPTION_FONT = height * 0.02;
  const BOTTOM_BAR_HEIGHT = height * 0.035;

  const outerMargin = Math.min(width, height) * 0.06;
  const totalCardsWidth = width - 2 * outerMargin;
  const cardGap = Math.min(40, totalCardsWidth * 0.04);
  const cardWidth = (totalCardsWidth - cardGap * 2) / 3;
  const cardHeight = 380;
  const cardRadius = 16;
  const cardPadding = 32;

  const accentLineWidth = width * 0.12;
  const titleBottom = TITLE_TOP + TITLE_FONT * 1.2;
  const accentLineTop = titleBottom + height * 0.018;

  const bottomBarTop = availableHeight - BOTTOM_BAR_HEIGHT - height * 0.02;
  const cardsTop =
    accentLineTop +
    height * 0.025 +
    (bottomBarTop - accentLineTop - height * 0.025 - cardHeight) * 0.42;

  const staggerFrames = fps * 0.4;

  const cards = [
    {
      icon: "📦",
      title: "场景层 / core",
      lines: ["JSON 描述场景", "相机 / 光源 / 物体", "Mesh / 材质 / 贴图"],
    },
    {
      icon: "⚙️",
      title: "渲染管线 / Render",
      lines: ["顶点变换", "裁剪 + 光栅化", "深度测试 + 混合"],
    },
    {
      icon: "💡",
      title: "Shader 层 / gpu",
      lines: ["模仿 HLSL 写法", "Lit / SimpleLit / UnLit", "PBR 光照 + 法线"],
    },
  ];

  const gridColor = "rgba(255,255,255,0.035)";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0d1117",
        fontFamily: theme.fonts.sans,
        overflow: "hidden",
      }}
    >
      {/* ===== Dot grid background (full canvas) ===== */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height: availableHeight,
          backgroundImage: `radial-gradient(circle, ${gridColor} 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      {/* ===== Top decorative gradient bar ===== */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: `linear-gradient(90deg, transparent 0%, ${theme.colors.accent} 20%, ${theme.colors.accent} 80%, transparent 100%)`,
          opacity: 0.6,
        }}
      />

      {/* ===== Title ===== */}
      <div
        style={{
          position: "absolute",
          top: TITLE_TOP,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: TITLE_FONT,
          fontWeight: "bold",
          color: "#e6edf3",
          letterSpacing: "0.02em",
          lineHeight: 1.2,
        }}
      >
        MyRender 三大模块
      </div>

      {/* ===== Accent line below title ===== */}
      <div
        style={{
          position: "absolute",
          top: accentLineTop,
          left: (width - accentLineWidth) / 2,
          width: accentLineWidth,
          height: 3,
          backgroundColor: theme.colors.accent,
          borderRadius: 1.5,
        }}
      />

      {/* ===== Cards row ===== */}
      <div
        style={{
          position: "absolute",
          top: cardsTop,
          left: (width - totalCardsWidth) / 2,
          width: totalCardsWidth,
          display: "flex",
          gap: cardGap,
        }}
      >
        {cards.map((card, i) => {
          const delay = i * staggerFrames;
          const fadeIn = interpolate(
            frame,
            [delay, delay + 12],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const slideUp = interpolate(
            frame,
            [delay, delay + 18],
            [70, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const scaleIn = interpolate(
            frame,
            [delay, delay + 18],
            [0.94, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          return (
            <div
              key={i}
              style={{
                width: cardWidth,
                height: cardHeight,
                backgroundColor: "#161b22",
                border: "1px solid #30363d",
                borderRadius: cardRadius,
                padding: cardPadding,
                display: "flex",
                flexDirection: "column",
                opacity: fadeIn,
                transform: `translateY(${slideUp}px) scale(${scaleIn})`,
              }}
            >
              {/* === Icon === */}
              <div
                style={{
                  fontSize: ICON_SIZE,
                  lineHeight: 1,
                  marginBottom: height * 0.015,
                  color: theme.colors.accent,
                }}
              >
                {card.icon}
              </div>

              {/* === Card title === */}
              <div
                style={{
                  fontSize: CARD_TITLE_FONT,
                  fontWeight: "bold",
                  color: theme.colors.accent,
                  marginBottom: height * 0.016,
                  lineHeight: 1.3,
                }}
              >
                {card.title}
              </div>

              {/* === Description lines === */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: height * 0.006,
                }}
              >
                {card.lines.map((line, li) => (
                  <div
                    key={li}
                    style={{
                      fontSize: DESC_FONT,
                      color: "#8b949e",
                      lineHeight: 1.5,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== Bottom bar: caption + progress (strictly above 50 px safe zone) ===== */}
      <div
        style={{
          position: "absolute",
          top: bottomBarTop,
          left: width * 0.05,
          right: width * 0.05,
          height: BOTTOM_BAR_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: width * 0.025,
          opacity: interpolate(
            frame,
            [cards.length * staggerFrames + 5, cards.length * staggerFrames + 15],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          ),
        }}
      >
        {/* Decorative vertical accent */}
        <div
          style={{
            width: 3,
            height: BOTTOM_BAR_HEIGHT * 0.55,
            backgroundColor: theme.colors.accent,
            borderRadius: 1.5,
          }}
        />

        {/* Caption text */}
        <div
          style={{
            fontSize: CAPTION_FONT,
            color: theme.colors.muted,
            whiteSpace: "nowrap",
            fontFamily: theme.fonts.sans,
          }}
        >
          MyRender 三大模块架构总览
        </div>

        {/* Progress bar track */}
        <div
          style={{
            flex: 1,
            maxWidth: width * 0.22,
            height: 4,
            backgroundColor: "#30363d",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          {/* Progress bar fill */}
          <div
            style={{
              width: `${(frame / Math.max(durationInFrames, 1)) * 100}%`,
              height: "100%",
              backgroundColor: theme.colors.accent,
              borderRadius: 2,
            }}
          />
        </div>

        {/* Page indicator */}
        <div
          style={{
            fontSize: CAPTION_FONT * 0.85,
            color: theme.colors.muted,
            fontFamily: theme.fonts.sans,
            opacity: 0.7,
          }}
        >
          01 / 03
        </div>
      </div>
    </AbsoluteFill>
  );
}
