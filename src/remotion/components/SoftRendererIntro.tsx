import React from "react";
import { interpolate, Easing } from "remotion";

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

const BG = "#0d1117";
const FG = "#e6edf3";
const MUTED = "#8b949e";
const ACCENT = "#58a6ff";
const CARD_BG = "#161b22";
const CARD_BORDER = "#30363d";

const TITLE_TEXT = "从零写一个软渲染器";
const SUBTITLE_TEXT = "面向 C++ 程序员，不需要图形学基础";

const CARDS = [
  { title: "① 全局视角", desc: "管线总览" },
  { title: "② 坐标变换", desc: "MVP 矩阵" },
  { title: "③ 裁剪光栅化", desc: "三角形变像素" },
  { title: "④ 着色光照", desc: "PBR 与法线" },
  { title: "⑤ 性能优化", desc: "多线程" },
];

export default function SoftRendererIntro({
  frame,
  width,
  height,
  subtitleSafeBottom,
  fps,
  theme,
}: AnimationProps) {
  const safeBottom = subtitleSafeBottom ?? 50;
  const availHeight = height - safeBottom;
  const scale = height / 1080;

  // ------ Sizes ------
  const titleSize = Math.max(height * 0.07, 80 * scale);
  const subtitleSize = Math.max(height * 0.045, 50 * scale);
  const cardTitleSize = Math.max(height * 0.025, 32 * scale);
  const cardDescSize = Math.max(height * 0.02, 24 * scale);
  const cardHeight = Math.max(200, 240 * scale);
  const cardGap = 32 * scale;
  const estimatedTitleWidth = titleSize * 8.5;

  // ------ Timing ------
  const titleIn = 0;
  const subtitleIn = Math.round(0.6 * fps);
  const lineIn = Math.round(1.2 * fps);
  const cardsIn = Math.round(2 * fps);
  const stagger = Math.round(0.3 * fps);
  const fadeDur = Math.round(0.4 * fps);

  // ------ Title animation ------
  const titleOpacity = interpolate(
    frame,
    [titleIn, titleIn + fadeDur],
    [0, 1],
    { extrapolateRight: "clamp" },
  );
  const titleOffsetY = interpolate(
    frame,
    [titleIn, titleIn + fadeDur],
    [-24, 0],
    { extrapolateRight: "clamp" },
  );

  // ------ Subtitle animation ------
  const subtitleOpacity = interpolate(
    frame,
    [subtitleIn, subtitleIn + fadeDur],
    [0, 1],
    { extrapolateRight: "clamp" },
  );
  const subtitleOffsetY = interpolate(
    frame,
    [subtitleIn, subtitleIn + fadeDur],
    [-16, 0],
    { extrapolateRight: "clamp" },
  );

  // ------ Accent line animation ------
  const lineOpacity = interpolate(
    frame,
    [lineIn, lineIn + 6],
    [0, 1],
    { extrapolateRight: "clamp" },
  );
  const lineProgress = interpolate(
    frame,
    [lineIn, lineIn + Math.round(0.6 * fps)],
    [0, 1],
    {
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.25, 0.08, 0.25, 1),
    },
  );

  // ------ Card animations (staggered) ------
  const getCardAnim = (index: number) => {
    const enter = cardsIn + index * stagger;
    return {
      opacity: interpolate(
        frame,
        [enter, enter + fadeDur],
        [0, 1],
        { extrapolateRight: "clamp" },
      ),
      transform: `translateY(${interpolate(
        frame,
        [enter, enter + fadeDur + Math.round(0.15 * fps)],
        [64, 0],
        {
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.18, 0, 0.22, 1),
        },
      )}px)`,
    };
  };

  // ------ Card layout ------
  const cardsWidth = width * 0.92;
  const cardWidth = (cardsWidth - cardGap * (CARDS.length - 1)) / CARDS.length;
  const cardsLeft = (width - cardsWidth) / 2;

  // ------ Vertical layout ------
  const gap1 = 28 * scale;
  const gap2 = 28 * scale;
  const gap3 = 72 * scale;

  const contentHeight =
    titleSize + gap1 + subtitleSize + gap2 + 4 * scale + gap3 + cardHeight;
  let contentTop = (availHeight - contentHeight) / 2;
  contentTop = Math.max(availHeight * 0.06, contentTop);

  const titleY = contentTop;
  const subtitleY = contentTop + titleSize + gap1;
  const lineY = contentTop + titleSize + gap1 + subtitleSize + gap2;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: BG,
        overflow: "hidden",
        fontFamily: theme.fonts.sans,
      }}
    >
      {/* ---- Full-canvas dot grid ---- */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        <defs>
          <pattern
            id="dotGrid"
            width={44}
            height={44}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={22} cy={22} r={1} fill={MUTED} opacity={0.1} />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#dotGrid)" />
      </svg>

      {/* ---- Top-right glow ---- */}
      <div
        style={{
          position: "absolute",
          top: -height * 0.18,
          right: -width * 0.08,
          width: width * 0.42,
          height: width * 0.42,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(88,166,255,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* ---- Bottom-left glow ---- */}
      <div
        style={{
          position: "absolute",
          bottom: safeBottom + 40,
          left: -width * 0.12,
          width: width * 0.34,
          height: width * 0.34,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(88,166,255,0.05) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* ---- Top accent bar ---- */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height: 3,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(88,166,255,0.35) 50%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {/* ---- Decorative dots (top right) ---- */}
      <div
        style={{
          position: "absolute",
          top: availHeight * 0.05,
          right: width * 0.035,
          display: "flex",
          gap: 10 * scale,
          opacity: 0.2,
          pointerEvents: "none",
        }}
      >
        {[7, 4, 6].map((s, i) => (
          <div
            key={i}
            style={{
              width: s * scale,
              height: s * scale,
              borderRadius: "50%",
              backgroundColor: i % 2 === 0 ? ACCENT : MUTED,
            }}
          />
        ))}
      </div>

      {/* ---- Vertical accent (left side) ---- */}
      <div
        style={{
          position: "absolute",
          top: availHeight * 0.12,
          left: width * 0.025,
          width: 2,
          height: availHeight * 0.18,
          backgroundColor: ACCENT,
          opacity: 0.12,
          borderRadius: 1,
          pointerEvents: "none",
        }}
      />

      {/* ---- Tags / meta line (upper area filler) ---- */}
      <div
        style={{
          position: "absolute",
          top: availHeight * 0.04,
          left: 0,
          width,
          display: "flex",
          justifyContent: "center",
          gap: 12 * scale,
          opacity: 0.18,
          pointerEvents: "none",
        }}
      >
        {["C++", "图形学", "渲染管线", "实战"].map((tag) => (
          <span
            key={tag}
            style={{
              fontSize: Math.max(12, 14 * scale),
              color: MUTED,
              fontFamily: theme.fonts.sans,
              border: `1px solid ${MUTED}`,
              borderRadius: 4 * scale,
              padding: `2px ${8 * scale}px`,
              letterSpacing: "0.04em",
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* ---- Main title ---- */}
      <div
        style={{
          position: "absolute",
          top: titleY,
          left: 0,
          width,
          display: "flex",
          justifyContent: "center",
          opacity: titleOpacity,
          transform: `translateY(${titleOffsetY}px)`,
        }}
      >
        <span
          style={{
            color: FG,
            fontSize: titleSize,
            fontWeight: "bold",
            fontFamily: theme.fonts.sans,
            textAlign: "center",
            lineHeight: 1.15,
            letterSpacing: "0.02em",
          }}
        >
          {TITLE_TEXT}
        </span>
      </div>

      {/* ---- Subtitle ---- */}
      <div
        style={{
          position: "absolute",
          top: subtitleY,
          left: 0,
          width,
          display: "flex",
          justifyContent: "center",
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleOffsetY}px)`,
        }}
      >
        <span
          style={{
            color: MUTED,
            fontSize: subtitleSize,
            fontFamily: theme.fonts.sans,
            textAlign: "center",
            lineHeight: 1.3,
            letterSpacing: "0.01em",
          }}
        >
          {SUBTITLE_TEXT}
        </span>
      </div>

      {/* ---- Accent line (sweeps left to right) ---- */}
      <div
        style={{
          position: "absolute",
          top: lineY,
          left: (width - estimatedTitleWidth) / 2,
          width: lineProgress * estimatedTitleWidth,
          height: 4 * scale,
          backgroundColor: ACCENT,
          borderRadius: 2 * scale,
          opacity: lineOpacity,
        }}
      />

      {/* ---- Cards ---- */}
      <div
        style={{
          position: "absolute",
          top: lineY + 4 * scale + gap3,
          left: cardsLeft,
          display: "flex",
          gap: cardGap,
        }}
      >
        {CARDS.map((card, i) => {
          const anim = getCardAnim(i);
          return (
            <div
              key={i}
              style={{
                width: cardWidth,
                height: cardHeight,
                backgroundColor: CARD_BG,
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 16 * scale,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                gap: 14 * scale,
                opacity: anim.opacity,
                transform: anim.transform,
                boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                padding: `0 ${12 * scale}px`,
              }}
            >
              <span
                style={{
                  color: FG,
                  fontSize: cardTitleSize,
                  fontWeight: "bold",
                  fontFamily: theme.fonts.sans,
                  textAlign: "center",
                  lineHeight: 1.25,
                }}
              >
                {card.title}
              </span>
              <span
                style={{
                  color: MUTED,
                  fontSize: cardDescSize,
                  fontFamily: theme.fonts.sans,
                  textAlign: "center",
                  lineHeight: 1.4,
                  opacity: 0.9,
                }}
              >
                {card.desc}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
