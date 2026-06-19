import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
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
      fontSizePct: number;
      lineHeight: number;
      maxWidthPct: number;
      backgroundColor: string;
      paddingPx: number;
    };
  };
  fps: number;
}

const STEPS = [
  "1   清空颜色 / 深度缓冲",
  "2   上传相机·光源到全局变量",
  "3   逐物体：算模型矩阵 → Draw",
  "4   逐三角形：顶点着色 → 裁剪 → 光栅化",
  "5   颜色缓冲转 sRGB → 交给屏幕",
];

const RenderPipelineSlide: React.FC<AnimationProps> = ({
  frame,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}) => {
  const accent = theme.colors.accent || "#58a6ff";
  const bg = "#0d1117";
  const cardBg = "#161b22";

  const availH = height - subtitleSafeBottom;
  const pad = Math.min(width, height) * 0.06;

  const contentW = width - pad * 2;
  const leftW = contentW * 0.55;
  const gap = contentW * 0.05;
  const rightW = contentW * 0.4;

  // ---- code fade in [0s] ----
  const codeOpacity = interpolate(frame, [0, fps * 0.8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ---- step layout ----
  const headerH = availH * 0.12;
  const timelineTop = pad + headerH;
  const timelineBottom = availH - pad;
  const timelineH = timelineBottom - timelineTop;

  const cardH = Math.min(88 * (height / 1080), timelineH / 5.6);
  const slotH = timelineH / STEPS.length;

  // step animation start: [1s], 0.6s interval
  const stepStart = fps * 1.0;
  const stepInterval = fps * 0.6;

  const codeFontSize = Math.max(height * 0.024, 22);
  const stepFontSize = Math.max(height * 0.027, 26);

  const kw = theme.colors.code?.keyword || "#ff7b72";
  const fn = "#d2a8ff";
  const cm = theme.colors.code?.comment || "#8b949e";
  const codeFg = theme.colors.code?.fg || "#c9d1d9";

  // code lines with token styling
  type Tok = { t: string; c: string };
  const codeLines: Tok[][] = [
    [{ t: "FrameStart", c: fn }, { t: "(cam, light);", c: codeFg }],
    [{ t: "for", c: kw }, { t: " (obj : objects) {", c: codeFg }],
    [{ t: "  UpdateModelMatrix", c: fn }, { t: "(obj);", c: codeFg }],
    [{ t: "  Draw", c: fn }, { t: "(obj.mesh, obj.mat);", c: codeFg }],
    [{ t: "}", c: codeFg }],
    [{ t: "// 颜色缓冲 → sRGB → 屏幕", c: cm }],
  ];

  // mapping step index -> code line index for connector echo
  const stepToCodeLine: Record<number, number> = {
    0: 0,
    1: 0,
    2: 2,
    3: 3,
    4: 5,
  };

  const rightLeft = pad + leftW + gap;
  const codeBoxTop = timelineTop;
  const codeLineHeight = codeFontSize * 1.9;

  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: theme.fonts.sans }}>
      {/* subtle background grid */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(88,166,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(88,166,255,0.04) 1px, transparent 1px)",
          backgroundSize: `${width * 0.05}px ${width * 0.05}px`,
        }}
      />

      {/* Header / title */}
      <div
        style={{
          position: "absolute",
          left: pad,
          top: pad,
          width: contentW,
          height: headerH,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 8,
            height: headerH * 0.62,
            backgroundColor: accent,
            borderRadius: 4,
            marginRight: 20,
          }}
        />
        <div
          style={{
            color: theme.colors.fg || "#ffffff",
            fontSize: height * 0.05,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          Render() 渲染管线
        </div>
      </div>

      {/* LEFT timeline */}
      <div
        style={{
          position: "absolute",
          left: pad,
          top: timelineTop,
          width: leftW,
          height: timelineH,
        }}
      >
        {/* dashed vertical connector */}
        <div
          style={{
            position: "absolute",
            left: 28,
            top: slotH * 0.5,
            bottom: slotH * 0.5,
            width: 0,
            borderLeft: `3px dashed ${accent}`,
            opacity: 0.5,
          }}
        />

        {STEPS.map((s, i) => {
          const start = stepStart + i * stepInterval;
          const prog = interpolate(frame, [start, start + fps * 0.45], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          const translateX = (1 - prog) * -60;
          const opacity = prog;

          // highlight pulse window
          const isActive =
            frame >= start && frame < start + stepInterval + fps * 0.4;
          const glow = isActive ? 0.9 : 0.0;

          const top = i * slotH + (slotH - cardH) / 2;

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                top,
                width: leftW,
                height: cardH,
                display: "flex",
                alignItems: "center",
                paddingLeft: 24,
                paddingRight: 20,
                boxSizing: "border-box",
                backgroundColor: cardBg,
                borderLeft: `4px solid ${accent}`,
                borderRadius: 8,
                color: "#ffffff",
                fontSize: stepFontSize,
                fontWeight: 600,
                opacity,
                transform: `translateX(${translateX}px)`,
                boxShadow: `0 0 ${22 * glow}px ${4 * glow}px rgba(88,166,255,${
                  0.55 * glow
                })`,
                outline: isActive
                  ? `2px solid rgba(88,166,255,0.8)`
                  : "none",
                zIndex: 2,
              }}
            >
              {/* node dot */}
              <div
                style={{
                  position: "absolute",
                  left: -10,
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: accent,
                  boxShadow: isActive
                    ? `0 0 14px 3px rgba(88,166,255,0.9)`
                    : "none",
                }}
              />
              {s}

              {/* echo connector to code line */}
              {isActive && (
                <div
                  style={{
                    position: "absolute",
                    right: -(gap + 4),
                    top: cardH / 2,
                    width: gap,
                    height: 2,
                    backgroundColor: accent,
                    opacity: 0.8,
                    boxShadow: `0 0 8px rgba(88,166,255,0.8)`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT code panel */}
      <div
        style={{
          position: "absolute",
          left: rightLeft,
          top: codeBoxTop,
          width: rightW,
          height: timelineH,
          backgroundColor: "#0a0d12",
          border: `1px solid #21262d`,
          borderRadius: 12,
          opacity: codeOpacity,
          padding: codeFontSize * 1.4,
          boxSizing: "border-box",
          fontFamily: theme.fonts.mono,
          overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* window dots */}
        <div style={{ display: "flex", gap: 10, marginBottom: codeFontSize }}>
          {["#ff5f56", "#ffbd2e", "#27c93f"].map((c) => (
            <div
              key={c}
              style={{
                width: codeFontSize * 0.55,
                height: codeFontSize * 0.55,
                borderRadius: "50%",
                backgroundColor: c,
              }}
            />
          ))}
        </div>

        {codeLines.map((line, li) => {
          // highlight code line when a mapped step is active
          let lineActive = false;
          for (let si = 0; si < STEPS.length; si++) {
            const start = stepStart + si * stepInterval;
            const act =
              frame >= start && frame < start + stepInterval + fps * 0.4;
            if (act && stepToCodeLine[si] === li) lineActive = true;
          }
          return (
            <div
              key={li}
              style={{
                fontSize: codeFontSize,
                lineHeight: `${codeLineHeight}px`,
                whiteSpace: "pre",
                borderRadius: 6,
                paddingLeft: 8,
                marginLeft: -8,
                backgroundColor: lineActive
                  ? "rgba(88,166,255,0.16)"
                  : "transparent",
                boxShadow: lineActive
                  ? `inset 3px 0 0 ${accent}`
                  : "none",
              }}
            >
              {line.map((tok, ti) => (
                <span key={ti} style={{ color: tok.c }}>
                  {tok.t}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default RenderPipelineSlide;
