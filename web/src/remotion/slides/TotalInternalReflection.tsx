import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";

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

// ---- Ray group configuration (module-level to keep useMemo stable) ----
interface RayGroup {
  angleDeg: number;
  color: string;
  label: string;
  isTIR: boolean;
  refractionHorizontal: boolean;
}

const RAY_GROUPS: RayGroup[] = [
  {
    angleDeg: 20,
    color: "#7ee787",
    label: "小角度：正常折射",
    isTIR: false,
    refractionHorizontal: false,
  },
  {
    angleDeg: 41.8,
    color: "#f0c000",
    label: "临界角：折射光贴面",
    isTIR: false,
    refractionHorizontal: true,
  },
  {
    angleDeg: 60,
    color: "#ff7b72",
    label: "超过临界角：全内反射",
    isTIR: true,
    refractionHorizontal: false,
  },
];

// ---- Helpers for SVG arc drawing ----
function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const diff = ((endAngle - startAngle + 540) % 360) - 180;
  const largeArcFlag = Math.abs(diff) > 90 ? 1 : 0;
  const sweepFlag = diff >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg + 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

// ---- Component ----
const TOTAL_REFLECTION: React.FC<AnimationProps> = ({
  width,
  height,
  subtitleSafeBottom,
  theme,
}) => {
  const availableHeight = height - subtitleSafeBottom;
  const margin = Math.min(width, height) * 0.05;

  // ---- Font sizes (scaled from height) ----
  const titleSize = height * 0.085;
  const captionSize = height * 0.02;
  const bodySize = height * 0.03;
  const codeSize = height * 0.026;
  const labelSize = height * 0.02;

  // ---- Layout positions ----
  const titleTop = height * 0.04;
  const titleHeight = titleSize * 1.2;

  // Diagram dimensions
  const diagramWidth = width * 0.72;
  const diagramHeight = Math.max(380, availableHeight * 0.42);
  const diagramX = (width - diagramWidth) / 2;

  const titleToDiagram = height * 0.038;
  const diagramTop = titleTop + titleHeight + titleToDiagram;
  const boundaryY = diagramTop + diagramHeight * 0.48;
  const diagramBottom = diagramTop + diagramHeight;

  const diagramToFormula = height * 0.035;
  const formulaSize = bodySize;
  const formulaTop = diagramBottom + diagramToFormula;
  const formulaHeight = formulaSize * 1.6;

  const formulaToCode = height * 0.028;
  const codeBlockWidth = diagramWidth * 0.82;
  const codeBlockX = (width - codeBlockWidth) / 2;
  const codeLineHeight = codeSize * 1.7;
  const codeTop = formulaTop + formulaHeight + formulaToCode;
  const codePadding = height * 0.022;
  const codeBlockHeight = codeLineHeight * 2 + codePadding * 2;

  // ---- Ray geometry constants ----
  const nGlass = 1.5;
  const nAir = 1.0;
  const rayLength = diagramHeight * 0.36;
  const rayExtension = diagramHeight * 0.02;

  interface ComputedRay {
    sx: number;
    sy: number;
    incX: number;
    incY: number;
    refrX: number | null;
    refrY: number | null;
    reflX: number;
    reflY: number;
    normalTopY: number;
    normalBottomY: number;
    color: string;
    label: string;
    isTIR: boolean;
    refractionHorizontal: boolean;
    angleDeg: number;
  }

  const rays = useMemo<ComputedRay[]>(() => {
    const positions = [0.22, 0.5, 0.78];

    return RAY_GROUPS.map((g, i) => {
      const sx = diagramX + diagramWidth * positions[i];
      const sy = boundaryY;
      const theta = (g.angleDeg * Math.PI) / 180;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Incident ray: from lower-left to striking point
      const incX = sx - sinT * rayLength;
      const incY = sy + cosT * rayLength;

      // Refracted ray via Snell's law: n1 sin(θ1) = n2 sin(θ2)
      const sinTheta2 = (nGlass / nAir) * sinT;
      let refrX: number | null = null;
      let refrY: number | null = null;

      if (!g.isTIR && sinTheta2 <= 1) {
        const theta2 = Math.asin(sinTheta2);
        if (g.refractionHorizontal) {
          // Critical angle: refracted ray skims the surface
          refrX = sx + rayLength * 2.2;
          refrY = sy - rayExtension;
        } else {
          refrX = sx + Math.sin(theta2) * rayLength;
          refrY = sy - Math.cos(theta2) * rayLength;
        }
      }

      // Reflected ray: equal angle on the other side of normal
      const reflX = sx + sinT * rayLength;
      const reflY = sy + cosT * rayLength;

      // Normal line (short vertical dashed)
      const normalLen = rayLength * 0.42;
      const normalTopY = sy - normalLen;
      const normalBottomY = sy + normalLen * 0.7;

      return {
        sx,
        sy,
        incX,
        incY,
        refrX,
        refrY,
        reflX,
        reflY,
        normalTopY,
        normalBottomY,
        color: g.color,
        label: g.label,
        isTIR: g.isTIR,
        refractionHorizontal: g.refractionHorizontal,
        angleDeg: g.angleDeg,
      };
    });
  }, [diagramX, diagramWidth, boundaryY, rayLength, rayExtension]);

  // ---- SVG clip path ID ----
  const clipId = "diagram-clip";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0d1117",
        fontFamily: theme.fonts?.sans || "sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ---- Subtle background grid ---- */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0, opacity: 0.035 }}
      >
        <defs>
          <pattern
            id="bg-grid"
            width={48}
            height={48}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="#c9d1d9"
              strokeWidth={0.5}
            />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#bg-grid)" />
      </svg>

      {/* ---- Top accent bar ---- */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 3,
          background: "linear-gradient(90deg, #7ee787, #f0c000, #ff7b72)",
        }}
      />

      {/* ---- Title ---- */}
      <div
        style={{
          position: "absolute",
          top: titleTop,
          left: margin,
          width: width - margin * 2,
          textAlign: "center",
          fontSize: titleSize,
          fontWeight: 800,
          color: "#ffffff",
          letterSpacing: "0.02em",
          lineHeight: 1.2,
        }}
      >
        全内反射
        <span style={{ fontWeight: 400, marginLeft: 16, opacity: 0.75 }}>
          (Total Internal Reflection)
        </span>
      </div>

      {/* ---- Main diagram SVG ---- */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={diagramX}
              y={diagramTop}
              width={diagramWidth}
              height={diagramHeight}
              rx={12}
              ry={12}
            />
          </clipPath>
        </defs>

        {/* Diagram background with rounded corners */}
        <g clipPath={`url(#${clipId})`}>
          {/* Upper: air */}
          <rect
            x={diagramX}
            y={diagramTop}
            width={diagramWidth}
            height={boundaryY - diagramTop}
            fill="#141a22"
          />
          {/* Lower: glass */}
          <rect
            x={diagramX}
            y={boundaryY}
            width={diagramWidth}
            height={diagramTop + diagramHeight - boundaryY}
            fill="#0a0e14"
          />
          {/* Subtle inner border for depth */}
          <rect
            x={diagramX}
            y={diagramTop}
            width={diagramWidth}
            height={diagramHeight}
            rx={12}
            ry={12}
            fill="none"
            stroke="#30363d"
            strokeWidth={1}
          />
        </g>

        {/* Air label */}
        <text
          x={diagramX + 16}
          y={diagramTop + labelSize + 8}
          fontSize={labelSize}
          fill="#8b949e"
          fontFamily={theme.fonts?.sans || "sans-serif"}
          opacity={0.9}
        >
          空气 n=1.0
        </text>

        {/* Glass label */}
        <text
          x={diagramX + 16}
          y={diagramTop + diagramHeight - 12}
          fontSize={labelSize}
          fill="#8b949e"
          fontFamily={theme.fonts?.sans || "sans-serif"}
          opacity={0.9}
        >
          玻璃 n=1.5
        </text>

        {/* Boundary line */}
        <line
          x1={diagramX + 4}
          y1={boundaryY}
          x2={diagramX + diagramWidth - 4}
          y2={boundaryY}
          stroke="#ffffff"
          strokeWidth={2}
          opacity={0.9}
        />

        {/* ---- Draw rays ---- */}
        {rays.map((g, i) => (
          <React.Fragment key={i}>
            {/* Normal (vertical dashed line at striking point) */}
            <line
              x1={g.sx}
              y1={g.normalTopY}
              x2={g.sx}
              y2={g.normalBottomY}
              stroke="#555"
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.35}
            />

            {/* Incident ray (solid) */}
            <line
              x1={g.incX}
              y1={g.incY}
              x2={g.sx}
              y2={g.sy}
              stroke={g.color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />

            {/* Refracted ray (dashed, unless TIR) */}
            {g.refrX !== null && g.refrY !== null && (
              <line
                x1={g.sx}
                y1={g.sy}
                x2={g.refrX}
                y2={g.refrY}
                stroke={g.color}
                strokeWidth={2}
                strokeDasharray="7,4"
                strokeLinecap="round"
                opacity={0.8}
              />
            )}

            {/* Reflected ray: dashed for normal/critical, solid for TIR */}
            <line
              x1={g.sx}
              y1={g.sy}
              x2={g.reflX}
              y2={g.reflY}
              stroke={g.color}
              strokeWidth={g.isTIR ? 2.5 : 1.8}
              strokeDasharray={g.isTIR ? "none" : "7,4"}
              strokeLinecap="round"
              opacity={g.isTIR ? 1 : 0.55}
            />

            {/* Small arrowhead on TIR reflected ray */}
            {g.isTIR && (
              <polygon
                points={`${g.reflX},${g.reflY} ${g.reflX - 8},${g.reflY - 5} ${g.reflX - 8},${g.reflY + 5}`}
                fill={g.color}
                opacity={0.9}
              />
            )}

            {/* Angle arc (subtle) — from normal (180°=UP) to incident ray direction */}
            <path
              d={describeArc(g.sx, g.sy, 28, 180, 180 + g.angleDeg)}
              fill="none"
              stroke={g.color}
              strokeWidth={1.2}
              opacity={0.5}
            />

            {/* Angle label */}
            <text
              x={g.sx - 12}
              y={g.sy + 20}
              fontSize={labelSize * 0.85}
              fill={g.color}
              fontFamily={theme.fonts?.sans || "sans-serif"}
              textAnchor="end"
              opacity={0.7}
            >
              {g.angleDeg}°
            </text>

            {/* Case label */}
            <text
              x={g.sx}
              y={boundaryY + rayLength * 0.72}
              fontSize={captionSize}
              fill={g.color}
              fontFamily={theme.fonts?.sans || "sans-serif"}
              textAnchor="middle"
              fontWeight={600}
            >
              {g.label}
            </text>
          </React.Fragment>
        ))}
      </svg>

      {/* ---- Formula ---- */}
      <div
        style={{
          position: "absolute",
          top: formulaTop,
          left: margin,
          width: width - margin * 2,
          textAlign: "center",
          fontSize: formulaSize,
          color: "#ffffff",
          fontFamily: theme.fonts?.sans || "sans-serif",
          fontWeight: 500,
          letterSpacing: "0.01em",
        }}
      >
        临界角:{" "}
        <span style={{ fontStyle: "italic", color: "#f0c000" }}>
          θ<sub>c</sub>
        </span>{" "}
        = arcsin(1 / 1.5) ≈{" "}
        <span style={{ color: "#7ee787", fontWeight: 700 }}>41.8°</span>
      </div>

      {/* ---- Code block ---- */}
      <div
        style={{
          position: "absolute",
          top: codeTop,
          left: codeBlockX,
          width: codeBlockWidth,
          backgroundColor: "#161b22",
          borderRadius: 10,
          padding: `${codePadding}px ${height * 0.025}px`,
          fontFamily:
            theme.fonts?.mono ||
            "'Cascadia Code', 'JetBrains Mono', monospace",
          fontSize: codeSize,
          lineHeight: codeLineHeight,
          color: "#e6edf3",
          border: "1px solid #30363d",
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              color: "#484f58",
              userSelect: "none",
              textAlign: "right",
              width: "1.2em",
              fontSize: codeSize * 0.9,
            }}
          >
            1
          </span>
          <span>
            <span
              style={{ color: theme.colors?.code?.keyword || "#ff7b72" }}
            >
              if
            </span>{" "}
            <span style={{ color: theme.colors?.code?.fg || "#ffdcdc" }}>
              (cos2t &lt; 0)
            </span>{" "}
            <span
              style={{
                color: theme.colors?.code?.comment || "#8b949e",
                fontStyle: "italic",
              }}
            >
              // 全内反射
            </span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              color: "#484f58",
              userSelect: "none",
              textAlign: "right",
              width: "1.2em",
              fontSize: codeSize * 0.9,
            }}
          >
            2
          </span>
          <span style={{ paddingLeft: codeSize * 1.6 }}>
            <span
              style={{ color: theme.colors?.code?.keyword || "#ff7b72" }}
            >
              return
            </span>{" "}
            <span style={{ color: theme.colors?.code?.fg || "#ffdcdc" }}>
              obj.e + f.mult(
            </span>
            <span
              style={{ color: theme.colors?.code?.string || "#a5d6ff" }}
            >
              radiance
            </span>
            <span style={{ color: theme.colors?.code?.fg || "#ffdcdc" }}>
              (reflRay, depth, Xi));
            </span>
          </span>
        </div>
      </div>

      {/* ---- Bottom accent bar ---- */}
      <div
        style={{
          position: "absolute",
          bottom: subtitleSafeBottom + 12,
          left: "50%",
          transform: "translateX(-50%)",
          width: Math.min(width * 0.3, 300),
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #7ee787, #f0c000, #ff7b72, transparent)",
          borderRadius: 1,
          opacity: 0.4,
        }}
      />

      {/* ---- Decorative corner accents ---- */}
      <svg
        width={width}
        height={height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
        }}
      >
        {/* Top-right decorative angle */}
        <path
          d={`M ${width - 36} 18 L ${width - 18} 18 L ${width - 18} 36`}
          fill="none"
          stroke="#30363d"
          strokeWidth={2}
          opacity={0.5}
        />
        {/* Bottom-left decorative angle */}
        <path
          d={`M 18 ${height - subtitleSafeBottom - 36} L 18 ${height - subtitleSafeBottom - 18} L 36 ${height - subtitleSafeBottom - 18}`}
          fill="none"
          stroke="#30363d"
          strokeWidth={2}
          opacity={0.5}
        />
      </svg>
    </AbsoluteFill>
  );
};

export default TOTAL_REFLECTION;
