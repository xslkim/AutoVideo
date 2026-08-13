import React from "react";
import {
  interpolate,
  useCurrentFrame,
  useVideoConfig,
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

const BatchOptimization: React.FC<AnimationProps> = (props) => {
  const { width, height, subtitleSafeBottom, theme, fps } = props;
  const frame = useCurrentFrame();
  const { fps: cfgFps } = useVideoConfig();
  const FPS = fps || cfgFps || 30;

  const BG = "#0d1117";
  const CARD = "#161b22";
  const BORDER = "#30363d";
  const ACCENT = theme?.colors?.accent || "#58a6ff";
  const FG = "#e6edf3";
  const GREEN = "#3fb950";
  const mono = theme?.fonts?.mono || "monospace";
  const sans = theme?.fonts?.sans || "Inter, system-ui, sans-serif";

  const avail = height - subtitleSafeBottom;
  const t = frame / FPS;

  // ---- scaling factor relative to 1080p ----
  const s = height / 1080;

  // ---- Title ----
  const titleTop = 70 * s;
  const titleSize = 60 * s;

  // accent underline sweep
  const lineW = interpolate(t, [0, 0.7], [0, 360 * s], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // ---- Layout anchors ----
  const cardX = width * 0.06;
  const cardW = width * 0.36;
  const cardTop = titleTop + titleSize + 70 * s;
  const cardPad = 32 * s;

  // Optimizer circle (center-right)
  const circleD = 180 * s;
  const circleCX = width * 0.66;
  const circleCY = cardTop + 150 * s;

  // ---- Unknown rows ----
  const rows = [
    "各相机 内参 K + 畸变",
    "各帧·各相机 位姿 T",
    "相机间 外参 T_cn_c0",
  ];

  const rowFade = (i: number) => {
    const start = i * 0.3;
    return interpolate(t, [start, start + 0.45], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    });
  };

  // ---- Optimizer rotation (start 1.5s) ----
  const rot = t > 1.5 ? (t - 1.5) * 45 : 0; // deg/sec

  // ---- Reprojection chart ----
  const chartW = width * 0.7;
  const chartH = 240 * s;
  const chartX = (width - chartW) / 2;
  const chartBottomGap = 40 * s;
  const chartY = avail - chartH - chartBottomGap;

  // curve drawing 2s..5s (3s)
  const drawP = interpolate(t, [2, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  // error curve: from 2.0 -> 0.2, exponential-ish decay
  const errAt = (p: number) => 0.2 + 1.8 * Math.exp(-3.4 * p);
  const yMin = 0;
  const yMax = 2.2;
  const plotPad = 46 * s;
  const plotX0 = chartX + plotPad;
  const plotX1 = chartX + chartW - 20 * s;
  const plotY0 = chartY + 14 * s;
  const plotY1 = chartY + chartH - plotPad;

  const xOf = (p: number) => plotX0 + (plotX1 - plotX0) * p;
  const yOf = (err: number) =>
    plotY1 - ((err - yMin) / (yMax - yMin)) * (plotY1 - plotY0);

  // build path
  const N = 120;
  let pathD = "";
  const drawN = Math.max(1, Math.floor(N * drawP));
  for (let i = 0; i <= drawN; i++) {
    const p = (i / N);
    const x = xOf(p);
    const y = yOf(errAt(p));
    pathD += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
  }
  const headP = drawP;
  const headErr = errAt(headP);
  const headX = xOf(headP);
  const headY = yOf(headErr);

  const converged = t >= 5.5;
  const checkScale = converged
    ? interpolate(t, [5.5, 5.9], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.back(2)),
      })
    : 0;

  // arrows from card to circle
  const arrowOpacity = interpolate(t, [0.9, 1.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: sans }}>
      {/* subtle grid background */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, opacity: 0.35 }}
      >
        {Array.from({ length: Math.ceil(width / (60 * s)) }).map((_, i) => (
          <line
            key={"v" + i}
            x1={i * 60 * s}
            y1={0}
            x2={i * 60 * s}
            y2={height}
            stroke={BORDER}
            strokeWidth={1}
            opacity={0.25}
          />
        ))}
        {Array.from({ length: Math.ceil(height / (60 * s)) }).map((_, i) => (
          <line
            key={"h" + i}
            x1={0}
            y1={i * 60 * s}
            x2={width}
            y2={i * 60 * s}
            stroke={BORDER}
            strokeWidth={1}
            opacity={0.25}
          />
        ))}
      </svg>

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: titleTop,
          left: 0,
          width: "100%",
          textAlign: "center",
          color: FG,
          fontSize: titleSize,
          fontWeight: 800,
          letterSpacing: 1,
        }}
      >
        批量优化 Batch Optimization
      </div>
      <div
        style={{
          position: "absolute",
          top: titleTop + titleSize + 16 * s,
          left: width / 2 - 180 * s,
          width: lineW,
          height: 4 * s,
          backgroundColor: ACCENT,
          borderRadius: 2 * s,
        }}
      />

      {/* Arrows + circle SVG layer */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <marker
            id="arrowHead"
            markerWidth="10"
            markerHeight="10"
            refX="7"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L7,3 L0,6 Z" fill={ACCENT} />
          </marker>
        </defs>

        {/* three arrows from card into circle */}
        {[0, 1, 2].map((i) => {
          const sy = cardTop + cardPad + 120 * s + i * 64 * s;
          const sx = cardX + cardW + 6 * s;
          const ex = circleCX - circleD / 2 - 8 * s;
          const ey = circleCY;
          const midx = (sx + ex) / 2;
          return (
            <path
              key={"arr" + i}
              d={`M${sx} ${sy} C ${midx} ${sy}, ${midx} ${ey}, ${ex} ${ey}`}
              stroke={ACCENT}
              strokeWidth={3 * s}
              fill="none"
              opacity={arrowOpacity * 0.9}
              markerEnd="url(#arrowHead)"
            />
          );
        })}
      </svg>

      {/* Unknowns card */}
      <div
        style={{
          position: "absolute",
          left: cardX,
          top: cardTop,
          width: cardW,
          backgroundColor: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 18 * s,
          padding: cardPad,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            color: FG,
            fontSize: 34 * s,
            fontWeight: 700,
            marginBottom: 24 * s,
          }}
        >
          待求未知数
        </div>
        {rows.map((r, i) => {
          const op = rowFade(i);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16 * s,
                fontSize: 30 * s,
                color: FG,
                opacity: op,
                transform: `translateX(${(1 - op) * -20 * s}px)`,
                marginBottom: i < rows.length - 1 ? 26 * s : 0,
              }}
            >
              <span
                style={{
                  width: 14 * s,
                  height: 14 * s,
                  borderRadius: "50%",
                  backgroundColor: ACCENT,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{r}</span>
              <span style={{ color: ACCENT, fontSize: 30 * s }}>→</span>
            </div>
          );
        })}
      </div>

      {/* Optimizer circle */}
      <div
        style={{
          position: "absolute",
          left: circleCX - circleD / 2,
          top: circleCY - circleD / 2,
          width: circleD,
          height: circleD,
          borderRadius: "50%",
          border: `${4 * s}px solid ${ACCENT}`,
          backgroundColor: "rgba(88,166,255,0.06)",
          transform: `rotate(${rot}deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 ${30 * s}px rgba(88,166,255,0.25)`,
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: 28 * s,
            color: FG,
            fontWeight: 700,
          }}
        >
          min Σ‖e‖²
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: circleCX - circleD / 2,
          top: circleCY + circleD / 2 + 14 * s,
          width: circleD,
          textAlign: "center",
          color: theme?.colors?.muted || "#8b949e",
          fontSize: 24 * s,
        }}
      >
        优化器
      </div>

      {/* Chart */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0 }}
      >
        {/* axes */}
        <line
          x1={plotX0}
          y1={plotY0}
          x2={plotX0}
          y2={plotY1}
          stroke={BORDER}
          strokeWidth={2 * s}
        />
        <line
          x1={plotX0}
          y1={plotY1}
          x2={plotX1}
          y2={plotY1}
          stroke={BORDER}
          strokeWidth={2 * s}
        />

        {/* y gridlines */}
        {[0.5, 1.0, 1.5, 2.0].map((v) => (
          <line
            key={"g" + v}
            x1={plotX0}
            y1={yOf(v)}
            x2={plotX1}
            y2={yOf(v)}
            stroke={BORDER}
            strokeWidth={1}
            opacity={0.4}
          />
        ))}

        {/* axis labels */}
        <text
          x={plotX1}
          y={plotY1 + 34 * s}
          fill={theme?.colors?.muted || "#8b949e"}
          fontSize={24 * s}
          textAnchor="end"
          fontFamily={sans}
        >
          迭代次数
        </text>
        <text
          x={plotX0 - 12 * s}
          y={plotY0 + 4 * s}
          fill={theme?.colors?.muted || "#8b949e"}
          fontSize={24 * s}
          textAnchor="end"
          fontFamily={sans}
        >
          误差(px)
        </text>

        {/* curve */}
        {pathD.length > 0 && (
          <path
            d={pathD}
            stroke={ACCENT}
            strokeWidth={4 * s}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* head dot */}
        {drawP > 0 && (
          <circle
            cx={headX}
            cy={headY}
            r={8 * s}
            fill={converged ? GREEN : ACCENT}
            stroke={BG}
            strokeWidth={2 * s}
          />
        )}

        {/* convergence check */}
        {converged && (
          <g transform={`translate(${headX + 20 * s}, ${headY}) scale(${checkScale})`}>
            <circle r={20 * s} fill={GREEN} />
            <path
              d={`M ${-9 * s} 0 L ${-3 * s} ${7 * s} L ${10 * s} ${-8 * s}`}
              stroke="#fff"
              strokeWidth={4 * s}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>

      {/* head value label (HTML for crisp text) */}
      {drawP > 0 && !converged && (
        <div
          style={{
            position: "absolute",
            left: headX + 16 * s,
            top: headY - 44 * s,
            color: ACCENT,
            fontSize: 30 * s,
            fontWeight: 700,
            fontFamily: mono,
          }}
        >
          {headErr.toFixed(1)} px
        </div>
      )}
      {converged && (
        <div
          style={{
            position: "absolute",
            left: headX + 50 * s,
            top: headY - 18 * s,
            color: GREEN,
            fontSize: 30 * s,
            fontWeight: 700,
            opacity: checkScale,
          }}
        >
          已收敛 0.2px
        </div>
      )}
    </AbsoluteFill>
  );
};

export default BatchOptimization;
