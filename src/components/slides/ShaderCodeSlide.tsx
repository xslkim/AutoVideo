import React from "react";
import { interpolate } from "remotion";

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
    fonts: {
      sans: string;
      mono: string;
    };
    spacing: {
      unit: number;
    };
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

const CODE_LINES = [
  {
    code: "positionWS = TransformObjectToWorld(positionOS);",
    from: "OS",
    to: "WS",
    matrix: "× M",
    tokens: [
      { t: "keyword", v: "positionWS" },
      { t: "op", v: " = " },
      { t: "func", v: "TransformObjectToWorld" },
      { t: "punct", v: "(" },
      { t: "param", v: "positionOS" },
      { t: "punct", v: ");" },
    ],
  },
  {
    code: "positionVS = TransformWorldToView(positionWS);",
    from: "WS",
    to: "VS",
    matrix: "× V",
    tokens: [
      { t: "keyword", v: "positionVS" },
      { t: "op", v: " = " },
      { t: "func", v: "TransformWorldToView" },
      { t: "punct", v: "(" },
      { t: "param", v: "positionWS" },
      { t: "punct", v: ");" },
    ],
  },
  {
    code: "positionCS = TransformWorldToHClip(positionWS);",
    from: "WS",
    to: "CS",
    matrix: "× VP",
    tokens: [
      { t: "keyword", v: "positionCS" },
      { t: "op", v: " = " },
      { t: "func", v: "TransformWorldToHClip" },
      { t: "punct", v: "(" },
      { t: "param", v: "positionWS" },
      { t: "punct", v: ");" },
    ],
  },
];

export default function ShaderCodeSlide({
  frame,
  width,
  height,
  subtitleSafeBottom = 50,
  theme,
  fps = 30,
}: AnimationProps) {
  const BG = "#0d1117";
  const safeBottom = Math.max(subtitleSafeBottom, 50);
  const availH = height - safeBottom;
  const minDim = Math.min(width, height);

  // Max outer padding: ≤ 6% of the smaller canvas dimension
  const maxOuterPad = Math.round(Math.min(minDim * 0.06, width * 0.5));

  const codeSz = Math.max(30, Math.round(height * 0.05));
  const labelSz = Math.max(28, Math.round(height * 0.026));
  const headerSz = Math.max(24, Math.round(height * 0.023));
  const arrowLabelSz = Math.max(16, Math.round(codeSz * 0.48));

  const lineH = Math.round(codeSz * 2.2);
  const codeBlockTopPad = Math.round(codeSz * 0.7);
  const codeBlockBotPad = Math.round(codeSz * 0.7);

  const blockW = width - 2 * maxOuterPad;
  const blockLeft = maxOuterPad;

  const arrowAreaW = Math.round(codeSz * 4.2);

  const totalCodeH =
    CODE_LINES.length * lineH + codeBlockTopPad + codeBlockBotPad;
  const codeBlockTop = Math.round((availH - totalCodeH) / 2);

  const gapFrames = Math.round(0.8 * fps);
  const fadeFrames = Math.round(0.3 * fps);

  const getOpacity = (lineIdx: number) => {
    const start = lineIdx * gapFrames;
    if (frame < start) return 0;
    const end = start + fadeFrames;
    if (frame >= end) return 1;
    return (frame - start) / fadeFrames;
  };

  const getLineY = (lineIdx: number) =>
    codeBlockTop + codeBlockTopPad + lineIdx * lineH + lineH / 2;

  const tokenColor = (type: string) => {
    switch (type) {
      case "keyword":
        return theme.colors.code.keyword;
      case "op":
        return theme.colors.code.fg;
      case "func":
        return theme.colors.accent;
      case "punct":
        return theme.colors.code.fg;
      case "param":
        return theme.colors.code.string;
      default:
        return theme.colors.code.fg;
    }
  };

  const isLineVisible = (lineIdx: number) => {
    const start = lineIdx * gapFrames;
    return frame >= start;
  };

  // Arrow SVG layout constants
  const arrFromLabelX = 2;
  const arrDotLeftX = Math.round(arrowAreaW * 0.24);
  const arrLineEndX = Math.round(arrowAreaW * 0.78);
  const arrDotRightX = Math.round(arrowAreaW * 0.82);
  const arrToLabelX = Math.round(arrowAreaW * 0.86);
  const nodeR = Math.round(codeSz * 0.12);

  const lineProgress = (lineIdx: number) => {
    const start = lineIdx * gapFrames;
    const dur = fadeFrames;
    if (frame < start) return 0;
    if (frame >= start + dur) return 1;
    return (frame - start) / dur;
  };

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: BG,
        fontFamily: theme.fonts.sans,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle background dot grid — fills the full canvas to meet 70% rule */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.5,
          backgroundImage: `radial-gradient(circle, rgba(139,148,158,0.07) 1px, transparent 1px)`,
          backgroundSize: `${Math.round(minDim * 0.028)}px ${Math.round(minDim * 0.028)}px`,
        }}
      />

      {/* Top thin accent bar — full-width decorative element */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height: 3,
          backgroundColor: theme.colors.accent,
          opacity: 0.35,
        }}
      />

      {/* File path header above code block */}
      <div
        style={{
          position: "absolute",
          left: blockLeft,
          top: codeBlockTop - Math.round(lineH * 0.85),
          display: "flex",
          alignItems: "center",
          gap: Math.round(codeSz * 0.3),
          opacity: Math.min(1, getOpacity(0) * 2),
        }}
      >
        <span
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: headerSz,
            color: theme.colors.muted,
            letterSpacing: "0.02em",
          }}
        >
          <span style={{ color: theme.colors.accent, fontWeight: 600 }}>
            gpu/
          </span>
          ShaderFunction.hpp
          <span
            style={{
              color: theme.colors.muted,
              marginLeft: codeSz * 0.3,
            }}
          >
            ::GetVertexPositionInputs
          </span>
        </span>
        <span
          style={{
            width: Math.round(codeSz * 0.8),
            height: 1,
            backgroundColor: theme.colors.muted,
            opacity: 0.25,
          }}
        />
      </div>

      {/* Code block card */}
      <div
        style={{
          position: "absolute",
          left: blockLeft,
          top: codeBlockTop,
          width: blockW,
          height: totalCodeH,
          backgroundColor: "rgba(13,17,23,0.6)",
          borderRadius: Math.round(codeSz * 0.3),
          border: "1px solid rgba(48,54,61,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Accent left border inside card */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 3,
            height: "100%",
            backgroundColor: theme.colors.accent,
            opacity: 0.5,
          }}
        />

        {/* ---- Arrow-chain SVG ---- */}
        <svg
          width={arrowAreaW}
          height={totalCodeH}
          style={{
            position: "absolute",
            left: Math.round(codeSz * 0.4),
            top: 0,
            pointerEvents: "none",
          }}
        >
          <defs>
            <marker
              id="arrHead"
              markerWidth={8}
              markerHeight={6}
              refX={7}
              refY={3}
              orient="auto"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill={theme.colors.accent}
              />
            </marker>
          </defs>

          {/* Vertical connector from L1 WS (target, right) to L2/L3 WS (source, left) */}
          {isLineVisible(0) && (isLineVisible(1) || isLineVisible(2)) && (
            <g opacity={0.4}>
              {isLineVisible(1) && (
                <path
                  d={`M ${arrDotRightX} ${getLineY(0)}
                      L ${arrDotRightX} ${(getLineY(1) + getLineY(0)) / 2}
                      L ${arrDotLeftX} ${(getLineY(1) + getLineY(0)) / 2}
                      L ${arrDotLeftX} ${getLineY(1)}`}
                  fill="none"
                  stroke={theme.colors.accent}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={lineProgress(1) * 0.7}
                />
              )}
              {isLineVisible(2) && (
                <path
                  d={`M ${arrDotRightX} ${getLineY(0)}
                      L ${arrDotRightX} ${(getLineY(2) + getLineY(0)) / 2}
                      L ${arrDotLeftX} ${(getLineY(2) + getLineY(0)) / 2}
                      L ${arrDotLeftX} ${getLineY(2)}`}
                  fill="none"
                  stroke={theme.colors.accent}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={lineProgress(2) * 0.7}
                />
              )}
            </g>
          )}

          {/* Per-line horizontal arrows */}
          {CODE_LINES.map((line, i) => {
            const op = getOpacity(i);
            if (op === 0) return null;
            const cy = getLineY(i);
            const progress = lineProgress(i);

            return (
              <g key={i} opacity={op}>
                {/* Source dot */}
                <circle cx={arrDotLeftX} cy={cy} r={nodeR} fill={theme.colors.muted} />

                {/* Arrow line — draws from left dot toward the right */}
                <line
                  x1={arrDotLeftX + nodeR + 2}
                  y1={cy}
                  x2={
                    arrDotLeftX +
                    (arrLineEndX - arrDotLeftX) *
                      interpolate(progress, [0, 0.2, 1], [0, 0.15, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      })
                  }
                  y2={cy}
                  stroke={theme.colors.accent}
                  strokeWidth={2}
                  markerEnd="url(#arrHead)"
                />

                {/* Target dot — fades in after the arrow tip reaches it */}
                <circle
                  cx={arrDotRightX}
                  cy={cy}
                  r={nodeR}
                  fill={theme.colors.accent}
                  opacity={interpolate(progress, [0, 0.5, 1], [0, 0.6, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })}
                />

                {/* "From" label (OS / WS / WS) */}
                <text
                  x={arrFromLabelX}
                  y={cy + arrowLabelSz * 0.35}
                  fill={theme.colors.muted}
                  fontSize={arrowLabelSz}
                  fontFamily={theme.fonts.mono}
                  textAnchor="start"
                  fontWeight={700}
                  opacity={interpolate(progress, [0, 0.3, 1], [0, 0.7, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })}
                >
                  {line.from}
                </text>

                {/* "To" label (WS / VS / CS) */}
                <text
                  x={arrToLabelX}
                  y={cy + arrowLabelSz * 0.35}
                  fill={theme.colors.accent}
                  fontSize={arrowLabelSz}
                  fontFamily={theme.fonts.mono}
                  textAnchor="start"
                  fontWeight={700}
                  opacity={interpolate(progress, [0, 0.6, 1], [0, 0.5, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })}
                >
                  {line.to}
                </text>
              </g>
            );
          })}
        </svg>

        {/* ---- Code text area ---- */}
        <div
          style={{
            position: "absolute",
            left: arrowAreaW + Math.round(codeSz * 0.9),
            top: codeBlockTopPad,
            right: Math.round(codeSz * 0.6),
            bottom: codeBlockBotPad,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {CODE_LINES.map((line, i) => {
            const op = getOpacity(i);
            return (
              <div
                key={i}
                style={{
                  height: lineH,
                  display: "flex",
                  alignItems: "center",
                  opacity: op,
                  width: "100%",
                  transform: `translateX(${(1 - op) * Math.round(codeSz * 0.7)}px)`,
                  transition: "none",
                }}
              >
                {/* Syntax-highlighted code */}
                <span
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: codeSz,
                    whiteSpace: "nowrap",
                    letterSpacing: "0.01em",
                    lineHeight: `${lineH}px`,
                  }}
                >
                  {line.tokens.map((tok, j) => (
                    <span key={j} style={{ color: tokenColor(tok.t) }}>
                      {tok.v}
                    </span>
                  ))}
                </span>

                {/* Spacer */}
                <div style={{ flex: 1, minWidth: codeSz }} />

                {/* Matrix annotation in accent color */}
                <span
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: Math.round(codeSz * 0.72),
                    color: theme.colors.accent,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    opacity: interpolate(op, [0, 1], [0, 1]),
                    letterSpacing: "0.04em",
                  }}
                >
                  {line.matrix}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom decorative accent stripe */}
      <div
        style={{
          position: "absolute",
          bottom: safeBottom + Math.round(labelSz * 2.8),
          left: blockLeft + Math.round(blockW * 0.05),
          width: Math.round(blockW * 0.9),
          height: 1,
          backgroundColor: theme.colors.muted,
          opacity: 0.15,
        }}
      />

      {/* Bottom label */}
      <div
        style={{
          position: "absolute",
          bottom: safeBottom + Math.round(labelSz * 0.6),
          left: 0,
          width,
          textAlign: "center",
          fontSize: labelSz,
          color: "#8b949e",
          fontFamily: theme.fonts.sans,
          letterSpacing: "0.04em",
          opacity: interpolate(
            Math.min(frame, gapFrames * 2 + fadeFrames),
            [0, gapFrames * 2 + fadeFrames],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          ),
        }}
      >
        <span
          style={{
            display: "inline-block",
            paddingLeft: Math.round(labelSz * 0.5),
            paddingRight: Math.round(labelSz * 0.5),
            borderLeft: `2px solid ${theme.colors.accent}`,
            borderRight: `2px solid ${theme.colors.accent}`,
            paddingTop: Math.round(labelSz * 0.15),
            paddingBottom: Math.round(labelSz * 0.15),
            opacity: 0.85,
          }}
        >
          这就是上面那条坐标链，在代码里的样子
        </span>
      </div>
    </div>
  );
}
