import React from "react";
import { useCurrentFrame } from "remotion";

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
      code: {
        bg: string;
        fg: string;
        keyword: string;
        string: string;
        comment: string;
      };
    };
    fonts: { sans: string; mono: string };
    spacing: { unit: number };
    subtitle: {
      fontFamily: string;
      fontSizePct: string;
      lineHeight: string;
      maxWidthPct: string;
      backgroundColor: string;
      paddingPx: string;
    };
  };
  fps: number;
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 4);

const SlideComparison: React.FC<AnimationProps> = ({
  frame,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps = 30,
}) => {
  const canvasHeight = height - subtitleSafeBottom;

  // --- Timing (frames) ---
  const leftFadeStart = 0;
  const leftFadeDur = 0.5 * fps;
  const leftOpacity = easeOut(
    Math.min(Math.max((frame - leftFadeStart) / leftFadeDur, 0), 1),
  );

  const rightStart = 1.5 * fps;
  const rightSlideDur = 0.6 * fps;
  const rightFadeDur = 0.25 * fps;
  const rightRaw = Math.max(
    0,
    Math.min((frame - rightStart) / rightSlideDur, 1),
  );
  const rightProgress = easeOut(rightRaw);
  const rightOffset = (1 - rightProgress) * width * 0.18;
  const rightOpacity =
    frame < rightStart
      ? 0
      : easeOut(Math.min(Math.max((frame - rightStart) / rightFadeDur, 0), 1));

  const arrowStart = 3 * fps;
  const arrowFadeDur = 0.35 * fps;
  const arrowRaw = Math.max(
    0,
    Math.min((frame - arrowStart) / arrowFadeDur, 1),
  );
  const arrowOpacity = easeOut(arrowRaw);
  const arrowScale = 0.5 + 0.5 * arrowOpacity;

  // --- Layout ---
  const padding = Math.min(width, height) * 0.04;
  const panelWidth = width * 0.46;
  const leftX = padding;
  const rightX = width - padding - panelWidth;

  // --- Typography (scaled from user's 1080p specs) ---
  const titleSize = Math.max(height * 0.07, height * (46 / 1080));
  const bodySize = height * (30 / 1080);
  const rowGap = height * (24 / 1080);
  const sectionGap = height * 0.05;
  const iconSize = bodySize * 1.15;

  // --- Panel card sizing ---
  const panelPadX = width * 0.035;
  const panelPadY = height * 0.055;

  // Content block height
  const titleBlockH = titleSize * 1.3;
  const itemsBlockH = bodySize * 1.6 * 3 + rowGap * 2;
  const contentH = titleBlockH + sectionGap + itemsBlockH;

  // Make cards tall enough to dominate the canvas (≥80% of safe area)
  const minCardHeight = canvasHeight * 0.82;
  const cardHeight = Math.max(contentH + panelPadY * 2, minCardHeight);
  const cardTop = (canvasHeight - cardHeight) / 2;

  // Vertical center of cards (used for arrow)
  const cardCenterY = cardTop + cardHeight / 2;

  // Content top within each card (vertically centered)
  const contentTopInCard = (cardHeight - contentH) / 2;

  // --- Grid config ---
  const gridSize = 36;

  // --- Data ---
  const leftItems = [
    { icon: "✗", text: "不能设断点" },
    { icon: "✗", text: "不能打印变量" },
    { icon: "✗", text: "URP 源码庞大难跳转" },
  ];

  const rightItems = [
    { icon: "✓", text: "随便设断点" },
    { icon: "✓", text: "任意变量打印" },
    { icon: "✓", text: "单步跟踪每个像素" },
  ];

  // Item renderer
  const renderList = (
    items: { icon: string; text: string }[],
    iconColor: string,
  ) =>
    items.map((item, i) => (
      <div
        key={i}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: Math.max(8, width * 0.008),
          marginBottom: i < items.length - 1 ? rowGap : 0,
        }}
      >
        <span
          style={{
            color: iconColor,
            fontSize: iconSize,
            lineHeight: 1.35,
            flexShrink: 0,
            fontFamily: theme.fonts.sans,
          }}
        >
          {item.icon}
        </span>
        <span
          style={{
            fontSize: bodySize,
            color: theme.colors.fg,
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          {item.text}
        </span>
      </div>
    ));

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: "#0d1117",
        position: "relative",
        overflow: "hidden",
        fontFamily: theme.fonts.sans,
      }}
    >
      {/* ---- Full-canvas subtle grid ---- */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height: canvasHeight,
          opacity: 0.15,
          backgroundImage: [
            `linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)`,
            `linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`,
          ].join(", "),
          backgroundSize: `${gridSize}px ${gridSize}px`,
          pointerEvents: "none",
        }}
      />

      {/* ---- Top glow bar ---- */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height: 3,
          background: `linear-gradient(90deg, transparent 5%, ${theme.colors.accent}55 25%, ${theme.colors.accent}aa 50%, ${theme.colors.accent}55 75%, transparent 95%)`,
          opacity: 0.7,
        }}
      />

      {/* ---- Bottom vignette above safe area ---- */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: subtitleSafeBottom,
          width,
          height: canvasHeight * 0.12,
          background: `linear-gradient(180deg, transparent, rgba(0,0,0,0.4))`,
          pointerEvents: "none",
        }}
      />

      {/* ======== LEFT PANEL ======== */}
      <div
        style={{
          position: "absolute",
          left: leftX,
          top: cardTop,
          width: panelWidth,
          height: cardHeight,
          opacity: leftOpacity,
        }}
      >
        {/* Card bg */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            borderRadius: 18,
            background:
              "linear-gradient(160deg, rgba(255,123,114,0.07) 0%, rgba(255,123,114,0.015) 60%, transparent 100%)",
            border: "1px solid rgba(255,123,114,0.13)",
          }}
        />

        {/* Card inner glow top */}
        <div
          style={{
            position: "absolute",
            left: "20%",
            top: 0,
            width: "60%",
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(255,123,114,0.25), transparent)",
          }}
        />

        {/* Left vertical accent */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "12%",
            width: 3,
            height: "76%",
            background:
              "linear-gradient(180deg, #ff7b72, rgba(255,123,114,0.15))",
            borderRadius: 2,
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "absolute",
            left: panelPadX + 14,
            top: contentTopInCard,
            width: panelWidth - panelPadX * 2 - 14,
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: titleSize,
              fontWeight: 700,
              color: "#ff7b72",
              lineHeight: 1.3,
              letterSpacing: "-0.3px",
            }}
          >
            在 GPU 上调 Shader
          </div>

          <div style={{ height: sectionGap }} />

          {renderList(leftItems, "#ff7b72")}
        </div>
      </div>

      {/* ======== RIGHT PANEL ======== */}
      <div
        style={{
          position: "absolute",
          left: rightX + rightOffset,
          top: cardTop,
          width: panelWidth,
          height: cardHeight,
          opacity: rightOpacity,
        }}
      >
        {/* Card bg */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            borderRadius: 18,
            background:
              "linear-gradient(160deg, rgba(88,166,255,0.07) 0%, rgba(88,166,255,0.015) 60%, transparent 100%)",
            border: "1px solid rgba(88,166,255,0.13)",
          }}
        />

        {/* Card inner glow top */}
        <div
          style={{
            position: "absolute",
            left: "20%",
            top: 0,
            width: "60%",
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(88,166,255,0.25), transparent)",
          }}
        />

        {/* Right vertical accent */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "12%",
            width: 3,
            height: "76%",
            background:
              "linear-gradient(180deg, #58a6ff, rgba(88,166,255,0.15))",
            borderRadius: 2,
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "absolute",
            left: panelPadX + 14,
            top: contentTopInCard,
            width: panelWidth - panelPadX * 2 - 14,
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: titleSize,
              fontWeight: 700,
              color: "#58a6ff",
              lineHeight: 1.3,
              letterSpacing: "-0.3px",
            }}
          >
            在 CPU 上跑 Shader
          </div>

          <div style={{ height: sectionGap }} />

          {renderList(rightItems, "#3fb950")}
        </div>
      </div>

      {/* ======== CENTER ARROW (appears at 3 s) ======== */}
      {arrowOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            left: width / 2 - 28,
            top: cardCenterY - 28,
            width: 56,
            height: 56,
            opacity: arrowOpacity,
            transform: `scale(${arrowScale})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            filter: `drop-shadow(0 0 12px ${theme.colors.accent}55)`,
          }}
        >
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle
              cx="28"
              cy="28"
              r="26"
              stroke={theme.colors.accent}
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.3"
            />
            <path
              d="M17 28h20M30 21l7 7-7 7"
              stroke={theme.colors.accent}
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
};

export default SlideComparison;
