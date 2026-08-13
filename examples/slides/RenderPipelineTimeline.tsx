import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Easing, AbsoluteFill } from "remotion";

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

const STEPS: { num: string; text: string }[] = [
  { num: "1", text: "清空颜色 / 深度缓冲" },
  { num: "2", text: "上传相机·光源到全局变量" },
  { num: "3", text: "逐物体：模型矩阵 → Draw" },
  { num: "4", text: "逐三角形：着色 → 裁剪 → 光栅化" },
  { num: "5", text: "颜色缓冲 → sRGB → 屏幕" },
];

const RenderPipelineTimeline: React.FC<AnimationProps> = (props) => {
  const { width, height, subtitleSafeBottom, theme } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const accent = theme.colors.accent;
  const bg = "#0d1117";
  const cardBg = "#161b22";

  const availH = height - subtitleSafeBottom;
  const pad = Math.min(width, height) * 0.06;

  const leftW = width * 0.55;
  const rightW = width * 0.4;

  // Card geometry
  const cardH = availH * 0.13;
  const cardGap = (availH - pad * 2 - cardH * STEPS.length) / (STEPS.length - 1);

  // Right panel reveal at 0s
  const rightProgress = interpolate(frame, [0, 0.6 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Step highlight timings: start at 1s, 0.6s apart
  const stepHighlight = (i: number) => {
    const start = (1 + i * 0.6) * fps;
    return interpolate(frame, [start, start + 0.4 * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  };

  const cardFont = height * 0.03;
  const numFont = height * 0.04;
  const annotationFont = height * 0.026;

  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: theme.fonts.sans, overflow: "hidden" }}>
      {/* subtle background grid */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${accent}11 1px, transparent 1px), linear-gradient(90deg, ${accent}11 1px, transparent 1px)`,
          backgroundSize: `${width * 0.05}px ${width * 0.05}px`,
          opacity: 0.5,
        }}
      />

      {/* LEFT TIMELINE */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: leftW,
          height: availH,
          padding: pad,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* dashed vertical connector */}
        <div
          style={{
            position: "absolute",
            left: pad + cardH * 0.5,
            top: pad + cardH * 0.5,
            bottom: pad + cardH * 0.5,
            width: 0,
            borderLeft: `3px dashed ${accent}`,
            opacity: 0.6,
          }}
        />

        {STEPS.map((s, i) => {
          const hl = stepHighlight(i);
          return (
            <div
              key={i}
              style={{
                position: "relative",
                height: cardH,
                marginBottom: i < STEPS.length - 1 ? cardGap : 0,
                backgroundColor: cardBg,
                borderRadius: 8,
                borderLeft: `${4 + hl * 4}px solid ${accent}`,
                display: "flex",
                alignItems: "center",
                paddingLeft: width * 0.025,
                paddingRight: width * 0.02,
                boxSizing: "border-box",
                boxShadow: hl > 0 ? `0 0 ${20 * hl}px ${accent}${Math.round(hl * 120).toString(16).padStart(2, "0")}` : "none",
                transform: `scale(${1 + hl * 0.025})`,
                transformOrigin: "left center",
                outline: hl > 0.5 ? `1px solid ${accent}66` : "none",
              }}
            >
              <div
                style={{
                  width: cardH * 0.55,
                  height: cardH * 0.55,
                  borderRadius: "50%",
                  backgroundColor: hl > 0.3 ? accent : "#21262d",
                  color: hl > 0.3 ? bg : theme.colors.fg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: numFont,
                  fontWeight: 800,
                  flexShrink: 0,
                  marginRight: width * 0.02,
                  transition: "none",
                }}
              >
                {s.num}
              </div>
              <div
                style={{
                  fontSize: cardFont,
                  color: "#ffffff",
                  fontWeight: hl > 0.3 ? 700 : 500,
                  opacity: 0.7 + hl * 0.3,
                  lineHeight: 1.15,
                }}
              >
                {s.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* RIGHT PANEL */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: rightW,
          height: availH,
          padding: pad,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: availH * 0.04,
          opacity: rightProgress,
          transform: `translateX(${(1 - rightProgress) * 40}px)`,
        }}
      >
        <div
          style={{
            fontSize: annotationFont,
            color: accent,
            fontWeight: 700,
            lineHeight: 1.3,
          }}
        >
          对应 URP 的一次 Render 调用
        </div>

        {/* simplified loop diagram */}
        <div
          style={{
            border: `2px solid ${accent}55`,
            borderRadius: 14,
            backgroundColor: "#11161d",
            padding: pad * 0.8,
            display: "flex",
            flexDirection: "column",
            gap: availH * 0.025,
            position: "relative",
          }}
        >
          <div
            style={{
              fontSize: annotationFont * 0.78,
              color: theme.colors.muted,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Render Loop
          </div>

          {["Setup", "Per-Object", "Per-Triangle", "Present"].map((label, i, arr) => (
            <React.Fragment key={label}>
              <div
                style={{
                  backgroundColor: cardBg,
                  border: `1px solid ${accent}44`,
                  borderRadius: 8,
                  padding: `${availH * 0.018}px ${rightW * 0.05}px`,
                  fontSize: annotationFont * 0.85,
                  color: "#ffffff",
                  fontWeight: 600,
                  textAlign: "center",
                }}
              >
                {label}
              </div>
              {i < arr.length - 1 && (
                <div
                  style={{
                    textAlign: "center",
                    color: accent,
                    fontSize: annotationFont,
                    lineHeight: 0.4,
                  }}
                >
                  ↓
                </div>
              )}
            </React.Fragment>
          ))}

          {/* loop-back arrow label */}
          <div
            style={{
              marginTop: availH * 0.015,
              textAlign: "center",
              fontSize: annotationFont * 0.72,
              color: theme.colors.muted,
              fontStyle: "italic",
            }}
          >
            ↻ 下一帧重复
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default RenderPipelineTimeline;
