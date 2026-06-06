import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

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
    subtitle: { fontFamily: string; fontSizePct: number; lineHeight: number; maxWidthPct: number; backgroundColor: string; paddingPx: number };
  };
  fps: number;
}

// ---- 3D math utilities ----
type V3 = [number, number, number];
const V = (x: number, y: number, z: number): V3 => [x, y, z];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s];
const len = (v: V3): number => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
const norm = (v: V3): V3 => {
  const l = len(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const rotY = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};

const rotX = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};

/** Orthographic isometric-like projection: screenX = x - z, screenY = (x + z) * 0.5 - y */
const isoProj = (v: V3): [number, number] => [
  (v[0] - v[2]) * 0.866,
  (v[0] + v[2]) * 0.5 - v[1],
];

// ---- Component ----
export default function CameraTransform({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}: AnimationProps) {
  const f = useCurrentFrame();
  const safeH = height - subtitleSafeBottom;

  // Layout: left 48%, right 46%, gap 6%
  const margin = Math.min(width, height) * 0.04;
  const leftW = width * 0.48;
  const rightW = width * 0.46;
  const gapW = width * 0.06;
  const sceneCX = margin + leftW / 2;
  const sceneCY = safeH * 0.44;
  const sceneScale = Math.min(leftW, safeH * 0.78) / 380;

  // ---- Animation timing ----
  const appearFrames = fps;
  const stepLen = Math.max(1, Math.floor((durationInFrames - appearFrames) / 3));

  // Eased progress for each step (0→1)
  const easeInOut = (t: number): number => t * t * (3 - 2 * t);

  const rawT0 = interpolate(f, [appearFrames, appearFrames + stepLen], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rawT1 = interpolate(f, [appearFrames + stepLen, appearFrames + 2 * stepLen], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rawT2 = interpolate(f, [appearFrames + 2 * stepLen, appearFrames + 3 * stepLen], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const t0 = easeInOut(rawT0);
  const t1 = easeInOut(rawT1);
  const t2 = easeInOut(rawT2);

  const activeStep = f < appearFrames ? -1 : f < appearFrames + stepLen ? 0 : f < appearFrames + 2 * stepLen ? 1 : 2;

  // Scene fade-in
  const sceneOpacity = interpolate(f, [0, appearFrames * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ---- World setup ----
  const WORLD_HALF = 140;
  const GRID_STEP = 40;

  // Camera starts at an offset from origin looking askew
  const camPos: V3 = V(30, 8, 35);
  // Camera look direction (unit)
  const lookRaw: V3 = V(-1, 0.25, -1);
  const lookDir = norm(lookRaw);

  // ---- Build transform from world→view ----
  // Step 0: translate so camera goes to origin
  const tx = -camPos[0] * t0;
  const ty = -camPos[1] * t0;
  const tz = -camPos[2] * t0;

  // Step 1: rotate to align look with -Z
  // The angle between lookDir and (0,0,-1) in the XZ plane
  const angleXZ = Math.atan2(-lookDir[0], -lookDir[2]);
  const rotAngle = angleXZ * t1;

  // Step 2: flip Z
  const flipZ = t2 > 0.01;

  // Transform a world-space point to view space
  const xf = (p: V3): V3 => {
    let out = add(p, V(tx, ty, tz));
    out = rotY(out, rotAngle);
    if (flipZ) {
      out[2] = -out[2];
    }
    return out;
  };

  // Transform + project to screen coords
  const toScreen = (p: V3): { x: number; y: number } => {
    const t = xf(p);
    const [ix, iy] = isoProj(t);
    return {
      x: sceneCX + ix * sceneScale,
      y: sceneCY + iy * sceneScale,
    };
  };

  // ---- Build scene geometry ----
  const h = WORLD_HALF;

  // Grid lines
  const gridSegs: { a: V3; b: V3 }[] = [];
  for (let g = -h; g <= h + 0.1; g += GRID_STEP) {
    gridSegs.push({ a: V(g, 0, -h), b: V(g, 0, h) });
    gridSegs.push({ a: V(-h, 0, g), b: V(h, 0, g) });
  }

  // Axes
  const axLen = h * 0.65;
  const axes: { a: V3; b: V3; color: string; label: string }[] = [
    { a: V(0, 0, 0), b: V(axLen, 0, 0), color: "#f85149", label: "X" },
    { a: V(0, 0, 0), b: V(0, axLen, 0), color: "#3fb950", label: "Y" },
    { a: V(0, 0, 0), b: V(0, 0, axLen), color: "#58a6ff", label: "Z" },
  ];

  // ---- Car ----
  const carPos: V3 = V(50, 0, 45);
  const cW = 32;
  const cH = 16;
  const cD = 18;

  // Car body vertices (local), car faces +Z
  const carBodyVerts: V3[] = [
    V(-cW / 2, 0, -cD / 2),
    V(cW / 2, 0, -cD / 2),
    V(cW / 2, cH, -cD / 2),
    V(-cW / 2, cH, -cD / 2),
    V(-cW / 2, 0, cD / 2),
    V(cW / 2, 0, cD / 2),
    V(cW / 2, cH, cD / 2),
    V(-cW / 2, cH, cD / 2),
  ].map((v) => add(v, carPos));

  // Cabin
  const cabHw = 14;
  const cabHd = 12;
  const cabHt = 12;
  const cabinVerts: V3[] = [
    V(-cabHw, cH, -cabHd),
    V(cabHw, cH, -cabHd),
    V(cabHw, cH + cabHt, -cabHd),
    V(-cabHw, cH + cabHt, -cabHd),
    V(-cabHw, cH, cabHd),
    V(cabHw, cH, cabHd),
    V(cabHw, cH + cabHt, cabHd),
    V(-cabHw, cH + cabHt, cabHd),
  ].map((v) => add(v, carPos));

  // Wheels (small circles at corners)
  const wheelPos: V3[] = [
    V(-cW / 2 + 6, -2, -cD / 2 + 4),
    V(cW / 2 - 6, -2, -cD / 2 + 4),
    V(-cW / 2 + 6, -2, cD / 2 - 4),
    V(cW / 2 - 6, -2, cD / 2 - 4),
  ].map((v) => add(v, carPos));

  // ---- Camera icon ----
  // Camera body (box centered at camPos, oriented along lookDir)
  // Local axes for camera: forward = lookDir, up = (0,1,0), right = cross(forward, up)
  const camUp: V3 = V(0, 1, 0);
  const camFwd = lookDir;
  const camRight = norm(cross(camFwd, camUp));

  const cHW = 12;
  const cHH = 8;
  const cHD = 10;

  const camVerts: V3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        let v = add(camPos, scale(camRight, sx * cHW));
        v = add(v, scale(camUp, sy * cHH));
        v = add(v, scale(camFwd, sz * cHD));
        camVerts.push(v);
      }
    }
  }

  // Camera indices: sx(-1/1)=0/1, sy(-1/1)=0/1, sz(-1/1)=0/1; idx = sx*4 + sy*2 + sz
  const cIdx = (sx: number, sy: number, sz: number): number =>
    (sx === 1 ? 1 : 0) * 4 + (sy === 1 ? 1 : 0) * 2 + (sz === 1 ? 1 : 0);

  // Camera lens (center of front face)
  const lensPos = add(camPos, scale(camFwd, cHD + 2));

  // Camera direction arrow (from lens forward, longer)
  const arrowEndPt = add(camPos, scale(camFwd, cHD + 28));

  // ---- SVG helpers ----
  const scr = (p: V3): string => {
    const s = toScreen(p);
    return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
  };

  const polyStr = (pts: V3[]): string => pts.map(scr).join(" ");

  const faceCenter = (pts: V3[]): V3 => {
    const n = pts.length;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    return V(cx / n, cy / n, cz / n);
  };

  // Determine which face of a box faces "forward" (toward viewer) in projection
  // For the isometric view, we check the face normal dot viewDirection
  // This is a heuristic: we draw top, right, and front faces of objects

  // ---- Render ----
  const bodySize = height * 0.026;
  const titleSize = height * 0.054;
  const labelSize = height * 0.022;
  const cardH = 100;
  const cardGap = 16;
  const totalCardsH = 3 * cardH + 2 * cardGap;

  // Status label
  const statusText =
    rawT0 > 0 && rawT0 < 1
      ? "→ 平移中"
      : rawT1 > 0 && rawT1 < 1
        ? "→ 旋转中"
        : rawT2 > 0 && rawT2 < 1
          ? "→ Z 翻转中"
          : t2 >= 1
            ? "观察坐标系 ✓"
            : "世界坐标系";

  // Progress
  const progress = f / durationInFrames;

  // Z-axis label changes in step 3
  const zLabel = t2 > 0.5 ? "Z'" : "Z";

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
      {/* ---- Main content (above subtitle safe zone) ---- */}
      <div
        style={{
          width,
          height: safeH,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: `0 ${margin}px`,
          opacity: sceneOpacity,
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        {/* ---- LEFT: 3D Scene ---- */}
        <svg
          width={leftW}
          height={safeH - margin}
          style={{ flexShrink: 0 }}
        >
          {/* Grid */}
          {gridSegs.map((seg, i) => {
            const a = toScreen(seg.a);
            const b = toScreen(seg.b);
            return (
              <line
                key={`g${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#1e2a3a"
                strokeWidth={1}
              />
            );
          })}

          {/* Floor edges */}
          {(() => {
            const corners = [
              V(-h, 0, -h),
              V(h, 0, -h),
              V(h, 0, h),
              V(-h, 0, h),
            ];
            return [0, 1, 2, 3].map((i) => {
              const a = toScreen(corners[i]);
              const b = toScreen(corners[(i + 1) % 4]);
              return (
                <line
                  key={`fe${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#252d3d"
                  strokeWidth={0.8}
                />
              );
            });
          })()}

          {/* Axes */}
          {axes.map((ax, i) => {
            const a = toScreen(ax.a);
            const b = toScreen(ax.b);
            const isZ = i === 2;
            const effectiveB = isZ && t2 > 0.5 ? toScreen(V(0, 0, -axLen)) : b;
            const dx = effectiveB.x - a.x;
            const dy = effectiveB.y - a.y;
            const al = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / al;
            const uy = dy / al;
            const ah = 8;
            const tipX = effectiveB.x;
            const tipY = effectiveB.y;
            const lx = effectiveB.x - ux * ah + uy * ah * 0.5;
            const ly = effectiveB.y - uy * ah - ux * ah * 0.5;
            const rx = effectiveB.x - ux * ah - uy * ah * 0.5;
            const ry = effectiveB.y - uy * ah + ux * ah * 0.5;
            const labelP = isZ && t2 > 0.5 ? V(0, 0, -(axLen + 20)) : V(0, 0, axLen + 20);
            const labelS = toScreen(labelP);
            return (
              <React.Fragment key={`ax${i}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={effectiveB.x}
                  y2={effectiveB.y}
                  stroke={ax.color}
                  strokeWidth={2.5}
                />
                <polygon
                  points={`${tipX},${tipY} ${lx},${ly} ${rx},${ry}`}
                  fill={ax.color}
                />
                <text
                  x={labelS.x}
                  y={labelS.y}
                  fill={ax.color}
                  fontSize={labelSize}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {isZ && t2 > 0.5 ? "Z'" : ax.label}
                </text>
              </React.Fragment>
            );
          })}

          {/* Origin dot */}
          {(() => {
            const o = toScreen(V(0, 0, 0));
            return (
              <circle cx={o.x} cy={o.y} r={3.5} fill="#ffa657" />
            );
          })()}

          {/* === Car === */}
          {/* Wheels */}
          {wheelPos.map((wp, i) => {
            const s = toScreen(wp);
            return (
              <circle
                key={`wh${i}`}
                cx={s.x}
                cy={s.y}
                r={3}
                fill="#30363d"
              />
            );
          })}
          {/* Car body - visible faces in isometric: top (y=max), right (x=max), front (z=max) */}
          {/* Car body front (z=cD/2 face) */}
          <polygon
            points={polyStr([carBodyVerts[4], carBodyVerts[5], carBodyVerts[6], carBodyVerts[7]])}
            fill="#1f6feb"
            stroke="#58a6ff"
            strokeWidth={1.5}
          />
          {/* Car body right (x=cW/2 face) */}
          <polygon
            points={polyStr([carBodyVerts[1], carBodyVerts[2], carBodyVerts[6], carBodyVerts[5]])}
            fill="#1158c7"
            stroke="#58a6ff"
            strokeWidth={1.5}
          />
          {/* Car body top (y=cH face) */}
          <polygon
            points={polyStr([carBodyVerts[3], carBodyVerts[2], carBodyVerts[6], carBodyVerts[7]])}
            fill="#58a6ff"
            stroke="#79c0ff"
            strokeWidth={1.5}
          />
          {/* Cabin front */}
          <polygon
            points={polyStr([cabinVerts[4], cabinVerts[5], cabinVerts[6], cabinVerts[7]])}
            fill="#1158c7"
            stroke="#58a6ff"
            strokeWidth={1}
          />
          {/* Cabin right */}
          <polygon
            points={polyStr([cabinVerts[1], cabinVerts[2], cabinVerts[6], cabinVerts[5]])}
            fill="#0d419d"
            stroke="#58a6ff"
            strokeWidth={1}
          />
          {/* Cabin top */}
          <polygon
            points={polyStr([cabinVerts[3], cabinVerts[2], cabinVerts[6], cabinVerts[7]])}
            fill="#79c0ff"
            stroke="#79c0ff"
            strokeWidth={1.5}
          />
          {/* Car label */}
          {(() => {
            const [fcx, fcy] = toScreen(faceCenter([carBodyVerts[3], carBodyVerts[2], carBodyVerts[6], carBodyVerts[7]]));
            return (
              <text
                x={fcx}
                y={fcy - 18}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={theme.colors.fg}
                fontSize={labelSize}
                fontWeight={600}
              >
                车
              </text>
            );
          })()}

          {/* === Camera === */}
          {/* Camera body - visible faces: top (+up), right (+right), front (+fwd) */}
          {/* Front face */}
          <polygon
            points={polyStr([
              camVerts[cIdx(-1, -1, 1)],
              camVerts[cIdx(1, -1, 1)],
              camVerts[cIdx(1, 1, 1)],
              camVerts[cIdx(-1, 1, 1)],
            ])}
            fill="#30363d"
            stroke="#848d97"
            strokeWidth={1.5}
          />
          {/* Right face */}
          <polygon
            points={polyStr([
              camVerts[cIdx(1, -1, -1)],
              camVerts[cIdx(1, 1, -1)],
              camVerts[cIdx(1, 1, 1)],
              camVerts[cIdx(1, -1, 1)],
            ])}
            fill="#21262d"
            stroke="#848d97"
            strokeWidth={1.5}
          />
          {/* Top face */}
          <polygon
            points={polyStr([
              camVerts[cIdx(-1, 1, -1)],
              camVerts[cIdx(1, 1, -1)],
              camVerts[cIdx(1, 1, 1)],
              camVerts[cIdx(-1, 1, 1)],
            ])}
            fill="#484f58"
            stroke="#848d97"
            strokeWidth={1.5}
          />
          {/* Lens */}
          {(() => {
            const ls = toScreen(lensPos);
            return (
              <circle
                cx={ls.x}
                cy={ls.y}
                r={4.5}
                fill="#58a6ff"
                stroke="#1f6feb"
                strokeWidth={1}
              />
            );
          })()}
          {/* Arrow */}
          {(() => {
            const startS = toScreen(add(camPos, scale(camFwd, cHD)));
            const endS = toScreen(arrowEndPt);
            const dx2 = endS.x - startS.x;
            const dy2 = endS.y - startS.y;
            const al2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            const ux2 = dx2 / al2;
            const uy2 = dy2 / al2;
            const ahSize = 9;
            const p1x = endS.x - ux2 * ahSize + uy2 * ahSize * 0.5;
            const p1y = endS.y - uy2 * ahSize - ux2 * ahSize * 0.5;
            const p2x = endS.x - ux2 * ahSize - uy2 * ahSize * 0.5;
            const p2y = endS.y - uy2 * ahSize + ux2 * ahSize * 0.5;
            return (
              <React.Fragment>
                <line
                  x1={startS.x}
                  y1={startS.y}
                  x2={endS.x}
                  y2={endS.y}
                  stroke="#ffa657"
                  strokeWidth={2.5}
                />
                <polygon
                  points={`${endS.x},${endS.y} ${p1x},${p1y} ${p2x},${p2y}`}
                  fill="#ffa657"
                />
              </React.Fragment>
            );
          })()}
          {/* Camera label */}
          {(() => {
            const [ctx, cty] = toScreen(
              faceCenter([
                camVerts[cIdx(-1, 1, -1)],
                camVerts[cIdx(1, 1, -1)],
                camVerts[cIdx(1, 1, 1)],
                camVerts[cIdx(-1, 1, 1)],
              ])
            );
            return (
              <text
                x={ctx}
                y={cty - 14}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={theme.colors.fg}
                fontSize={labelSize}
                fontWeight={600}
              >
                相机
              </text>
            );
          })()}

          {/* Status label (bottom of scene area) */}
          {(() => {
            const statusY = safeH - margin - 50;
            const statusColor = t2 >= 1 ? theme.colors.accent : "#8b949e";
            return (
              <text
                x={leftW / 2}
                y={statusY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={statusColor}
                fontSize={bodySize}
                fontWeight={700}
              >
                {statusText}
              </text>
            );
          })()}
        </svg>

        {/* ---- Gap ---- */}
        <div style={{ width: gapW, flexShrink: 0 }} />

        {/* ---- RIGHT: Step cards ---- */}
        <div
          style={{
            width: rightW,
            height: safeH - margin * 2,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {/* Step title */}
          <div
            style={{
              fontSize: titleSize,
              fontWeight: 700,
              color: theme.colors.fg,
              marginBottom: 32,
            }}
          >
            变换步骤
          </div>

          {/* Cards */}
          {[
            {
              num: "1",
              text: "把世界平移，让相机到原点",
              progress: rawT0,
            },
            {
              num: "2",
              text: "把世界旋转，抵消相机朝向",
              progress: rawT1,
            },
            {
              num: "3",
              text: "翻转 Z 轴：左手系 → 观察系",
              progress: rawT2,
            },
          ].map((step, i) => {
            const ip = step.progress;
            const isActive = ip > 0.01 && ip < 1;
            const isDone = ip >= 1;
            const isPending = ip < 0.01;

            const borderColor = isDone || isActive ? theme.colors.accent : "#30363d";
            const cardOpacity = isDone ? 0.7 : isActive ? 1 : 0.35;
            const badgeBg = isDone || isActive ? theme.colors.accent : "#30363d";

            return (
              <div
                key={step.num}
                style={{
                  height: cardH,
                  minHeight: cardH,
                  borderRadius: 8,
                  background: "#161b22",
                  borderLeft: `4px solid ${borderColor}`,
                  padding: "0 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: cardGap,
                  opacity: cardOpacity,
                  boxShadow: isActive
                    ? `0 0 24px ${theme.colors.accent}33, inset 0 0 24px ${theme.colors.accent}11`
                    : "none",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Active glow bar */}
                {isActive && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: "100%",
                      height: "100%",
                      background: `linear-gradient(90deg, ${theme.colors.accent}14, transparent)`,
                      pointerEvents: "none",
                    }}
                  />
                )}

                {/* Number badge */}
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: badgeBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: bodySize,
                    fontWeight: 700,
                    color: "#ffffff",
                    flexShrink: 0,
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  {isDone ? "✓" : step.num}
                </div>

                {/* Text */}
                <span
                  style={{
                    fontSize: bodySize,
                    fontWeight: 500,
                    color: "#ffffff",
                    lineHeight: 1.4,
                    position: "relative",
                    zIndex: 1,
                    flex: 1,
                  }}
                >
                  {step.text}
                </span>

                {/* Active pulse dot */}
                {isActive && (
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: theme.colors.accent,
                      flexShrink: 0,
                      position: "relative",
                      zIndex: 1,
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Bottom hint */}
          <div
            style={{
              fontSize: labelSize,
              color: theme.colors.muted,
              marginTop: 12,
              lineHeight: 1.5,
              textAlign: "center",
              padding: "0 16px",
            }}
          >
            {activeStep < 0
              ? "点击播放查看相机变换过程"
              : activeStep === 0
                ? "将整个世界平移，使相机回到坐标系原点"
                : activeStep === 1
                  ? "旋转世界，使相机的朝向与 -Z 方向对齐"
                  : "翻转 Z 轴，完成从左手系到观察系的转换"}
          </div>
        </div>
      </div>

      {/* ---- Progress bar (above subtitle safe zone) ---- */}
      <div
        style={{
          position: "absolute",
          bottom: subtitleSafeBottom + 22,
          left: margin,
          width: width - margin * 2,
          height: 3,
          background: "#21262d",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(progress * 100, 100)}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${theme.colors.accent}, #58a6ff)`,
            borderRadius: 2,
            transition: "width 0.05s linear",
          }}
        />
      </div>

      {/* ---- Time markers ---- */}
      <div
        style={{
          position: "absolute",
          bottom: subtitleSafeBottom + 4,
          left: margin,
          width: width - margin * 2,
          display: "flex",
          justifyContent: "space-between",
          fontSize: labelSize * 0.7,
          color: theme.colors.muted,
          opacity: 0.6,
        }}
      >
        <span>0s</span>
        <span>平移</span>
        <span>旋转</span>
        <span>翻转 Z</span>
        <span>{Math.round(durationInFrames / fps)}s</span>
      </div>
    </div>
  );
}
