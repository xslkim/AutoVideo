import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
  AbsoluteFill,
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

const COLORS = {
  bg: "#0d1117",
  fg: "#e6edf3",
  muted: "#8b949e",
  accent: "#58a6ff",
  cardBg: "#161b22",
  cardBorder: "#30363d",
};

const CARDS = [
  {
    ep: "EP1",
    title: "总览",
    desc: "架构 / 场景 / 一帧五步",
    current: true,
  },
  {
    ep: "EP2",
    title: "管线",
    desc: "变换 / 裁剪 / 光栅化 / 深度",
    current: false,
  },
  {
    ep: "EP3",
    title: "光照",
    desc: "贴图 / 法线 / PBR / 多线程",
    current: false,
  },
];

const TitleCards: React.FC<AnimationProps> = (props) => {
  const { width, height, subtitleSafeBottom, fps } = props;
  const frame = useCurrentFrame();
  const { fps: cfgFps } = useVideoConfig();
  const FPS = fps || cfgFps || 30;

  const availH = height - subtitleSafeBottom;

  // ---- Title fade-in [0s] ----
  const titleOpacity = interpolate(frame, [0, 0.5 * FPS], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 0.5 * FPS], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // ---- Subtitle fade-in [0.5s] ----
  const subStart = 0.5 * FPS;
  const subOpacity = interpolate(frame, [subStart, subStart + 0.5 * FPS], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subY = interpolate(frame, [subStart, subStart + 0.5 * FPS], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // ---- Accent line wipe-in [1s] ----
  const lineStart = 1 * FPS;
  const lineProgress = interpolate(frame, [lineStart, lineStart + 0.6 * FPS], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  // ---- Cards [1.6s], stagger 0.3s ----
  const cardsStart = 1.6 * FPS;

  // Sizing
  const titleSize = Math.max(height * 0.075, 80);
  const subSize = Math.max(height * 0.046, 50);
  const lineWidth = Math.min(width * 0.7, titleSize * 11);

  const contentWidth = width * 0.88;
  const cardGap = width * 0.025;
  const cardWidth = (contentWidth - cardGap * 2) / 3;
  const cardHeight = Math.min(availH * 0.34, 300);

  const epSize = cardHeight * 0.19;
  const cardTitleSize = cardHeight * 0.135;
  const cardDescSize = cardHeight * 0.088;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      {/* subtle background grid */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.cardBorder}22 1px, transparent 1px), linear-gradient(90deg, ${COLORS.cardBorder}22 1px, transparent 1px)`,
          backgroundSize: `${width * 0.05}px ${width * 0.05}px`,
          opacity: 0.5,
        }}
      />

      {/* glow accent top */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 22%, ${COLORS.accent}1f, transparent 55%)`,
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: subtitleSafeBottom,
          paddingLeft: Math.min(width, height) * 0.06,
          paddingRight: Math.min(width, height) * 0.06,
        }}
      >
        {/* Title */}
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            color: COLORS.fg,
            fontSize: titleSize,
            fontWeight: 800,
            textAlign: "center",
            letterSpacing: "0.01em",
            lineHeight: 1.1,
          }}
        >
          CPU软渲染 复刻Unity URP
        </div>

        {/* Subtitle */}
        <div
          style={{
            opacity: subOpacity,
            transform: `translateY(${subY}px)`,
            color: COLORS.muted,
            fontSize: subSize,
            fontWeight: 500,
            textAlign: "center",
            marginTop: 28,
          }}
        >
          面向 C++ 程序员，不需要图形学基础
        </div>

        {/* Accent line */}
        <div
          style={{
            marginTop: 24,
            width: lineWidth,
            height: 4,
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <div
            style={{
              width: `${lineProgress * 100}%`,
              height: "100%",
              backgroundColor: COLORS.accent,
              borderRadius: 2,
              boxShadow: `0 0 12px ${COLORS.accent}aa`,
            }}
          />
        </div>

        {/* Cards row */}
        <div
          style={{
            marginTop: availH * 0.06,
            width: contentWidth,
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            gap: cardGap,
          }}
        >
          {CARDS.map((card, i) => {
            const cStart = cardsStart + i * 0.3 * FPS;
            const enter = spring({
              frame: frame - cStart,
              fps: FPS,
              config: { damping: 200 },
              durationInFrames: 0.6 * FPS,
            });
            const cardOpacity = interpolate(enter, [0, 1], [0, 1]);
            const cardY = interpolate(enter, [0, 1], [40, 0]);

            const glow =
              card.current
                ? (Math.sin((frame / FPS) * 2 * Math.PI * 0.6) + 1) / 2
                : 0;

            return (
              <div
                key={card.ep}
                style={{
                  opacity: cardOpacity,
                  transform: `translateY(${cardY}px)`,
                  width: cardWidth,
                  height: cardHeight,
                  borderRadius: 16,
                  backgroundColor: COLORS.cardBg,
                  border: card.current
                    ? `2px solid ${COLORS.accent}`
                    : `1px solid ${COLORS.cardBorder}`,
                  boxShadow: card.current
                    ? `0 0 ${18 + glow * 22}px ${COLORS.accent}${card.current ? "88" : "00"}`
                    : "0 8px 24px rgba(0,0,0,0.35)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  padding: cardHeight * 0.12,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    fontSize: epSize,
                    fontWeight: 800,
                    color: COLORS.accent,
                    letterSpacing: "0.03em",
                  }}
                >
                  {card.ep}
                </div>
                <div
                  style={{
                    fontSize: cardTitleSize,
                    fontWeight: 700,
                    color: COLORS.fg,
                    marginTop: cardHeight * 0.05,
                  }}
                >
                  {card.title}
                </div>
                <div
                  style={{
                    fontSize: cardDescSize,
                    fontWeight: 400,
                    color: COLORS.muted,
                    marginTop: cardHeight * 0.06,
                    lineHeight: 1.4,
                  }}
                >
                  {card.desc}
                </div>

                {card.current && (
                  <div
                    style={{
                      position: "absolute",
                      marginTop: cardHeight * 0.5,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default TitleCards;
