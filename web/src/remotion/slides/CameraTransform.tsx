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

export default function CameraTransform({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  fps,
  theme,
}: AnimationProps) {
  const availH = height - subtitleSafeBottom;
  const barH = Math.max(height * 0.035, 28);
  const margin = Math.min(width, height) * 0.05;
  const sceneCX = width * 0.24;
  const sceneCY = availH * 0.48;
  const sceneScale = Math.min(width, height) * 0.013;

  // Step card layout
  const stepW = width * 0.46;
  const stepCardH = Math.max(height * 0.08, 90);
  const stepGap = Math.max(height * 0.018, 14);
  const stepsTotalH = stepCardH * 3 + stepGap * 2;
  const stepStartY = (availH - stepsTotalH - barH - 20) / 2 + 10;
  const stepContentX = width * 0.52;

  // Progress bar
  const barY = availH - barH - 10;
  const barX = margin;
  const barW = width - margin * 2;

  // Animation timing
  const fadeInFrames = Math.round(fps * 0.5);
  const s1Start = Math.round(fps * 1);
  const s1Dur = Math.round(fps * 0.5);
  const s1End = s1Start + s1Dur;
  const s2Start = Math.round(fps * 2);
  const s2Dur = Math.round(fps * 0.5);
  const s2End = s2Start + s2Dur;
  const s3Start = Math.round(fps * 3);
  const s3Dur = Math.round(fps * 0.5);
  const s3End = s3Start + s3Dur;

  const fadeOpacity = interpolate(frame, [0, fadeInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });

  const s1Amt = interpolate(frame, [s1Start, s1End], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const s2Amt = interpolate(frame, [s2Start, s2End], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const s3Amt = interpolate(frame, [s3Start, s3End], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const activeStep = s3Amt > 0.5 ? 3 : s2Amt > 0.5 ? 2 : s1Amt > 0.5 ? 1 : 0;

  const ease = (t: number) => t * t * (3 - 2 * t);

  // Camera initial world position
  const camInitX = 3.5;
  const camInitY = 1.8;
  const camInitZ = 3;
  const theta = Math.atan2(camInitX, camInitZ);
  const rotAngle = -theta;

  function project(
    px: number,
    py: number,
    pz: number,
    doFlipZ = false
  ): { x: number; y: number } {
    const s1e = ease(Math.min(s1Amt, 1));
    const s2e = ease(Math.min(s2Amt, 1));
    const s3e = ease(Math.min(s3Amt, 1));

    let x = px - camInitX * s1e;
    let y = py - camInitY * s1e;
    let z = pz - camInitZ * s1e;

    const angle = rotAngle * s2e;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const rx = x * c + z * sn;
    const rz = -x * sn + z * c;
    x = rx;
    z = rz;

    if (doFlipZ && s3e > 0) {
      z = -z;
    }

    // Cabinet projection
    return {
      x: sceneCX + (x - z * 0.45) * sceneScale,
      y: sceneCY - (y - z * 0.45) * sceneScale,
    };
  }

  // Grid lines
  const gridHalf = 5;
  const gridLines: React.ReactNode[] = [];
  for (let i = -gridHalf; i <= gridHalf; i++) {
    const a = project(i, 0, -gridHalf);
    const b = project(i, 0, gridHalf);
    gridLines.push(
      <line
        key={"gx" + i}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />
    );
    const c = project(-gridHalf, 0, i);
    const d = project(gridHalf, 0, i);
    gridLines.push(
      <line
        key={"gz" + i}
        x1={c.x}
        y1={c.y}
        x2={d.x}
        y2={d.y}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />
    );
  }

  // Axes
  const O = project(0, 0, 0);
  const Xa = project(4.5, 0, 0);
  const Ya = project(0, 4.5, 0);
  const Za = project(0, 0, 4.5, true);
  const axisLen = 4.5;

  const arrowHead = (from: { x: number; y: number }, to: { x: number; y: number }, color: string) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return null;
    const ux = dx / len;
    const uy = dy / len;
    const headSize = 10;
    const ax = to.x - ux * headSize * 0.3;
    const ay = to.y - uy * headSize * 0.3;
    return (
      <polygon
        points={`${to.x},${to.y} ${ax - uy * headSize * 0.4},${ay + ux * headSize * 0.4} ${ax + uy * headSize * 0.4},${ay - ux * headSize * 0.4}`}
        fill={color}
      />
    );
  };

  // Car as box at (-1.5, 0.3, -1)
  const carCX = -1.5;
  const carCY = 0.3;
  const carCZ = -1;
  const hw = 0.7;
  const hh = 0.3;
  const hd = 0.45;

  const carCorners = [
    [-hw, -hh, -hd],
    [hw, -hh, -hd],
    [hw, hh, -hd],
    [-hw, hh, -hd],
    [-hw, -hh, hd],
    [hw, -hh, hd],
    [hw, hh, hd],
    [-hw, hh, hd],
  ];

  const carFaces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 3, 7, 4],
    [1, 2, 6, 5],
  ];

  const carProj = carCorners.map(([cx, cy, cz]) =>
    project(carCX + cx, carCY + cy, carCZ + cz)
  );

  // Cabin on top
  const cabinH = 0.25;
  const cabinW = 0.4;
  const cabinD = 0.35;
  const cabinOffZ = 0.1;
  const cabinCorners = [
    [-cabinW, hh, -cabinD + cabinOffZ],
    [cabinW, hh, -cabinD + cabinOffZ],
    [cabinW, hh + cabinH, -cabinD + cabinOffZ],
    [-cabinW, hh + cabinH, -cabinD + cabinOffZ],
    [-cabinW, hh, cabinD + cabinOffZ],
    [cabinW, hh, cabinD + cabinOffZ],
    [cabinW, hh + cabinH, cabinD + cabinOffZ],
    [-cabinW, hh + cabinH, cabinD + cabinOffZ],
  ];
  const cabinProj = cabinCorners.map(([cx, cy, cz]) =>
    project(carCX + cx, carCY + cy, carCZ + cz)
  );

  const cabinFaces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 3, 7, 4],
    [1, 2, 6, 5],
  ];

  // Camera icon at init position
  const camPos = project(camInitX, camInitY, camInitZ);
  const camTarget = project(
    camInitX + 1.2 * Math.sin(theta),
    camInitY,
    camInitZ + 1.2 * Math.cos(theta)
  );
  const camDirAngle = Math.atan2(
    camTarget.y - camPos.y,
    camTarget.x - camPos.x
  );

  const camIconSize = Math.max(28, height * 0.028);

  // Step card highlight
  const step1Active = s1Amt > 0.3;
  const step2Active = s2Amt > 0.3;
  const step3Active = s3Amt > 0.3;

  const stepOpacity1 = interpolate(frame, [s1Start - 10, s1Start], [0.3, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const stepOpacity2 = interpolate(frame, [s2Start - 10, s2Start], [0.3, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const stepOpacity3 = interpolate(frame, [s3Start - 10, s3Start], [0.3, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const steps = [
    {
      num: "1",
      text: "Translate the world so camera reaches origin",
      active: step1Active,
      opacity: stepOpacity1,
      sub: "Translate the world, camera goes to origin",
    },
    {
      num: "2",
      text: "Rotate the world to counteract camera orientation",
      active: step2Active,
      opacity: stepOpacity2,
      sub: "Rotate the world, cancel camera facing",
    },
    {
      num: "3",
      text: "Flip Z axis: left-hand system to view system",
      active: step3Active,
      opacity: stepOpacity3,
      sub: "Flip Z: left-hand to view coordinate",
    },
  ];

  return (
    <div
      style={{
        width,
        height: availH,
        backgroundColor: "#0d1117",
        display: "flex",
        position: "relative",
        fontFamily: theme.fonts.sans,
        overflow: "hidden",
        opacity: fadeOpacity,
      }}
    >
      {/* ========== LEFT: 3D Scene ========== */}
      <svg
        width={width * 0.5}
        height={availH}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
        }}
      >
        {/* Grid */}
        {gridLines}

        {/* X Axis - Red */}
        <line
          x1={O.x}
          y1={O.y}
          x2={Xa.x}
          y2={Xa.y}
          stroke="#ff4444"
          strokeWidth={2.5}
        />
        {arrowHead(O, Xa, "#ff4444")}
        <text
          x={Xa.x + 8}
          y={Xa.y + 5}
          fill="#ff4444"
          fontSize={Math.max(16, height * 0.018)}
          fontFamily={theme.fonts.sans}
          fontWeight="bold"
        >
          X
        </text>

        {/* Y Axis - Green */}
        <line
          x1={O.x}
          y1={O.y}
          x2={Ya.x}
          y2={Ya.y}
          stroke="#44ff44"
          strokeWidth={2.5}
        />
        {arrowHead(O, Ya, "#44ff44")}
        <text
          x={Ya.x + 8}
          y={Ya.y + 5}
          fill="#44ff44"
          fontSize={Math.max(16, height * 0.018)}
          fontFamily={theme.fonts.sans}
          fontWeight="bold"
        >
          Y
        </text>

        {/* Z Axis - Blue (flipped in step 3) */}
        <line
          x1={O.x}
          y1={O.y}
          x2={Za.x}
          y2={Za.y}
          stroke={s3Amt > 0.3 ? "#ffaa00" : "#4488ff"}
          strokeWidth={2.5}
        />
        {arrowHead(O, Za, s3Amt > 0.3 ? "#ffaa00" : "#4488ff")}
        <text
          x={Za.x + 8}
          y={Za.y + 5}
          fill={s3Amt > 0.3 ? "#ffaa00" : "#4488ff"}
          fontSize={Math.max(16, height * 0.018)}
          fontFamily={theme.fonts.sans}
          fontWeight="bold"
        >
          {s3Amt > 0.3 ? "Z'" : "Z"}
        </text>

        {/* Car body faces */}
        {carFaces.map((face, fi) => {
          const pts = face.map((i) => `${carProj[i].x},${carProj[i].y}`).join(" ");
          return (
            <polygon
              key={"car" + fi}
              points={pts}
              fill={fi === 3 ? "#3b82f6" : "#2563eb"}
              stroke="#1d4ed8"
              strokeWidth={1}
              opacity={0.85}
            />
          );
        })}

        {/* Cabin faces */}
        {cabinFaces.map((face, fi) => {
          const pts = face
            .map((i) => `${cabinProj[i].x},${cabinProj[i].y}`)
            .join(" ");
          return (
            <polygon
              key={"cab" + fi}
              points={pts}
              fill={fi === 3 ? "#60a5fa" : "#3b82f6"}
              stroke="#1d4ed8"
              strokeWidth={1}
              opacity={0.9}
            />
          );
        })}

        {/* Camera icon */}
        {/* Camera body */}
        <g>
          <rect
            x={camPos.x - camIconSize * 0.4}
            y={camPos.y - camIconSize * 0.3}
            width={camIconSize * 0.65}
            height={camIconSize * 0.55}
            rx={4}
            fill="#fbbf24"
            stroke="#d97706"
            strokeWidth={1.5}
            transform={`rotate(${camDirAngle * (180 / Math.PI)}, ${camPos.x}, ${camPos.y})`}
          />
          {/* Lens */}
          <circle
            cx={camPos.x + camIconSize * 0.4 * Math.cos(camDirAngle)}
            cy={camPos.y + camIconSize * 0.4 * Math.sin(camDirAngle)}
            r={camIconSize * 0.14}
            fill="#1e3a5f"
            stroke="#d97706"
            strokeWidth={1.5}
          />
        </g>

        {/* Direction arrow from camera */}
        <line
          x1={camPos.x}
          y1={camPos.y}
          x2={camTarget.x}
          y2={camTarget.y}
          stroke="#fbbf24"
          strokeWidth={2}
          strokeDasharray="4,3"
          opacity={0.7}
        />
        <polygon
          points={`${camTarget.x},${camTarget.y} ${camTarget.x - 8 * Math.cos(camDirAngle - 0.5)},${camTarget.y - 8 * Math.sin(camDirAngle - 0.5)} ${camTarget.x - 8 * Math.cos(camDirAngle + 0.5)},${camTarget.y - 8 * Math.sin(camDirAngle + 0.5)}`}
          fill="#fbbf24"
          opacity={0.8}
        />

        {/* World coordinate label */}
        <text
          x={sceneCX}
          y={Math.min(camPos.y, sceneCY - axisLen * sceneScale * 0.5) - 20}
          fill="#8b949e"
          fontSize={Math.max(14, height * 0.016)}
          fontFamily={theme.fonts.sans}
          textAnchor="middle"
          opacity={s1Amt > 0.3 ? 0.3 : 1}
        >
          World Coordinate
        </text>
        {s3Amt > 0.3 && (
          <text
            x={sceneCX}
            y={Math.min(camPos.y, sceneCY - axisLen * sceneScale * 0.5) - 5}
            fill={theme.colors.accent}
            fontSize={Math.max(14, height * 0.016)}
            fontFamily={theme.fonts.sans}
            textAnchor="middle"
          >
            View Coordinate
          </text>
        )}
      </svg>

      {/* ========== RIGHT: Step Cards ========== */}
      <div
        style={{
          position: "absolute",
          left: stepContentX,
          top: stepStartY,
          width: stepW,
          display: "flex",
          flexDirection: "column",
          gap: stepGap,
        }}
      >
        {steps.map((step, idx) => {
          const isHighlighted = step.active;
          const borderColor = isHighlighted
            ? theme.colors.accent
            : "transparent";
          const bgColor = isHighlighted
            ? "rgba(22,27,34,0.95)"
            : "#161b22";
          const textColor = isHighlighted ? "#ffffff" : "#8b949e";
          const badgeBg = isHighlighted
            ? theme.colors.accent
            : "#30363d";
          const badgeText = isHighlighted ? "#ffffff" : "#8b949e";

          return (
            <div
              key={idx}
              style={{
                height: stepCardH,
                borderRadius: 8,
                background: bgColor,
                borderLeft: `4px solid ${borderColor}`,
                padding: "0 20px",
                display: "flex",
                alignItems: "center",
                gap: 16,
                opacity: step.opacity,
                transition: "border-color 0.15s, background 0.15s",
                boxShadow: isHighlighted
                  ? "0 0 20px rgba(88,166,255,0.15)"
                  : "none",
              }}
            >
              {/* Number badge */}
              <div
                style={{
                  width: Math.max(32, height * 0.03),
                  height: Math.max(32, height * 0.03),
                  borderRadius: "50%",
                  background: badgeBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: Math.max(16, height * 0.02),
                    fontWeight: "bold",
                    color: badgeText,
                    fontFamily: theme.fonts.sans,
                  }}
                >
                  {step.num}
                </span>
              </div>

              {/* Text */}
              <div>
                <p
                  style={{
                    fontSize: Math.max(16, height * 0.024),
                    color: textColor,
                    margin: 0,
                    lineHeight: 1.4,
                    fontWeight: isHighlighted ? 600 : 400,
                    fontFamily: theme.fonts.sans,
                  }}
                >
                  {step.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ========== Bottom Progress Bar ========== */}
      <div
        style={{
          position: "absolute",
          left: barX,
          top: barY,
          width: barW,
          height: barH,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        {/* Tick marks */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          {[0, 1, 2, 3, 4].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <div
                style={{
                  width: 1,
                  height: 6,
                  backgroundColor: "#30363d",
                }}
              />
              <span
                style={{
                  fontSize: Math.max(10, height * 0.012),
                  color: "#8b949e",
                  fontFamily: theme.fonts.sans,
                }}
              >
                {t}s
              </span>
            </div>
          ))}
        </div>
        {/* Track */}
        <div
          style={{
            width: "100%",
            height: 4,
            borderRadius: 2,
            backgroundColor: "#21262d",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${(frame / durationInFrames) * 100}%`,
              height: "100%",
              borderRadius: 2,
              backgroundColor: theme.colors.accent,
              transition: "width 0.05s linear",
            }}
          />
        </div>
      </div>
    </div>
  );
}
