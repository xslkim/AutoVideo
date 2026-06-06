import React from "react";
import { interpolate } from "remotion";

interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  fps: number;
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
}

export default function MatrixSlide({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  fps,
  theme,
}: AnimationProps) {
  const availableHeight = height - subtitleSafeBottom;
  const cardAreaWidth = width * 0.9;
  const gap = 40;
  const cardWidth = (cardAreaWidth - gap * 2) / 3;
  const cardHeight = 320;

  // --- Title: fade in + slight drop at 0s ---
  const titleOpacity = interpolate(
    frame,
    [0, Math.round(fps * 0.5)],
    [0, 1],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );
  const titleTranslateY = interpolate(
    frame,
    [0, Math.round(fps * 0.5)],
    [-24, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );

  // --- Card slide-in helpers ---
  const card1Start = Math.round(fps * 0.8);
  const card2Start = Math.round(fps * 1.2);
  const card3Start = Math.round(fps * 1.6);
  const slideDuration = Math.round(fps * 0.5);

  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  const getCardProgress = (startFrame: number) => {
    const elapsed = frame - startFrame;
    if (elapsed < 0) return 0;
    return Math.min(elapsed / slideDuration, 1);
  };

  const cardStyle = (progress: number) => {
    if (progress >= 1)
      return { opacity: 1, transform: "translateY(0px)" } as const;
    const eased = easeOutCubic(progress);
    return {
      opacity: eased,
      transform: `translateY(${60 * (1 - eased)}px)`,
    } as const;
  };

  // --- Bottom text fade in ---
  const bottomStart = Math.round(fps * 1.8);
  const bottomOpacity = interpolate(
    frame,
    [bottomStart, bottomStart + Math.round(fps * 0.4)],
    [0, 1],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );

  // --- Looping icon animations (trigonometric) ---
  const scaleAnim = 1 + 0.18 * Math.sin(frame * 0.05);
  const rotateAnim = Math.sin(frame * 0.04) * 30;
  const translateAnim = 14 * Math.sin(frame * 0.05);

  // --- Shared card base ---
  const cardBase: React.CSSProperties = {
    width: cardWidth,
    height: cardHeight,
    backgroundColor: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px 24px",
    boxSizing: "border-box",
    flexShrink: 0,
  };

  const iconSquare: React.CSSProperties = {
    width: 52,
    height: 52,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    opacity: 0.85,
    marginBottom: 20,
  };

  const cardTitle: React.CSSProperties = {
    fontSize: 36,
    fontWeight: "bold",
    color: theme.colors.accent,
    margin: "0 0 10px 0",
    textAlign: "center",
  };

  const cardDesc: React.CSSProperties = {
    fontSize: 26,
    color: "#8b949e",
    margin: 0,
    textAlign: "center",
    lineHeight: 1.4,
  };

  return (
    <div
      style={{
        width,
        height: availableHeight,
        backgroundColor: "#0d1117",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: theme.fonts.sans,
        overflow: "hidden",
      }}
    >
      {/* ============ Title ============ */}
      <div
        style={{
          marginTop: 70,
          opacity: titleOpacity,
          transform: `translateY(${titleTranslateY}px)`,
        }}
      >
        <h1
          style={{
            fontSize: 52,
            fontWeight: "bold",
            color: "#e6edf3",
            margin: 0,
            textAlign: "center",
            letterSpacing: 1.5,
          }}
        >
          模型矩阵 M = T · R · S
        </h1>
      </div>

      {/* ============ Cards row (flex grow to fill middle) ============ */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            gap,
            width: cardAreaWidth,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {/* ---- Card 1: S 缩放 ---- */}
          <div style={{ ...cardBase, ...cardStyle(getCardProgress(card1Start)) }}>
            <div style={{ ...iconSquare, transform: `scale(${scaleAnim})` }} />
            <h3 style={cardTitle}>S 缩放</h3>
            <p style={cardDesc}>改变大小</p>
          </div>

          {/* ---- Card 2: R 旋转 ---- */}
          <div style={{ ...cardBase, ...cardStyle(getCardProgress(card2Start)) }}>
            <div
              style={{ ...iconSquare, transform: `rotate(${rotateAnim}deg)` }}
            />
            <h3 style={cardTitle}>R 旋转</h3>
            <p style={cardDesc}>矩阵形式 Ry·Rx·Rz</p>
          </div>

          {/* ---- Card 3: T 平移 ---- */}
          <div style={{ ...cardBase, ...cardStyle(getCardProgress(card3Start)) }}>
            <div
              style={{
                ...iconSquare,
                transform: `translateX(${translateAnim}px)`,
              }}
            />
            <h3 style={cardTitle}>T 平移</h3>
            <p style={cardDesc}>改变位置</p>
          </div>
        </div>
      </div>

      {/* ============ Bottom formula ============ */}
      <div style={{ marginBottom: 40, opacity: bottomOpacity }}>
        <p
          style={{
            fontSize: 28,
            color: "#ffffff",
            margin: 0,
            textAlign: "center",
            letterSpacing: 0.5,
          }}
        >
          先缩放，再旋转，最后平移 —— 顺序不能反
        </p>
      </div>
    </div>
  );
}
