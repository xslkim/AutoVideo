/**
 * AutoVideo — Library component: FlowArrow
 *
 * Flowing connection diagram (the 2026 upgrade of FlowDiagram): node chips
 * pop in with overshoot springs, connective paths draw themselves on via
 * evolvePath, then comet dots loop endlessly along each path — position
 * from getPointAtLength, arrowheads aligned by getTangentAtLength. The
 * narration beat (lineTimings, or an even rhythm when empty) walks an
 * accent glow across the nodes.
 * Registry entry: see src/ai/visual-registry.ts ("FlowArrow").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import {
  evolvePath,
  getLength,
  getPointAtLength,
  getTangentAtLength,
} from "@remotion/paths";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import {
  EASE,
  activeIndexAt,
  breathe,
  clamp01,
  enterProgress,
  resolveBeatSchedule,
  springIn,
} from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface FlowArrowSpec extends AccentOverride {
  /** Small mono heading pinned top-left, e.g. "数据流". */
  title?: string;
  /** Main axis of the flow. Default "horizontal". */
  direction?: "horizontal" | "vertical";
  /**
   * 2–6 nodes, in logical order; positions follow array order.
   * `icon` names a built-in glyph: dot, bolt, play, database, cloud, gear,
   * user, search, doc, chart, check, cpu (unknown names fall back to none).
   */
  nodes: { id: string; label: string; icon?: string }[];
  /**
   * Connections by node id. Defaults to a simple chain
   * (nodes[i] → nodes[i+1]).
   */
  edges?: { from: string; to: string; label?: string }[];
}

export type FlowArrowProps = LibraryProps<FlowArrowSpec>;

// ---------------------------------------------------------------------------
// Built-in node icons — 24×24 glyphs, picked by spec.nodes[].icon
// ---------------------------------------------------------------------------

const ICONS: Record<string, { d: string; filled?: boolean }[]> = {
  dot: [{ d: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z", filled: true }],
  bolt: [{ d: "M13 2 5 14h6l-1 8 8-12h-6l1-8Z", filled: true }],
  play: [{ d: "M8 5.5 19 12 8 18.5Z", filled: true }],
  database: [
    { d: "M12 3.5c-4.4 0-8 1.3-8 3v11c0 1.7 3.6 3 8 3s8-1.3 8-3v-11c0-1.7-3.6-3-8-3Z" },
    { d: "M4 11.5c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  ],
  cloud: [
    { d: "M6.8 18.5h10.4a3.6 3.6 0 0 0 .7-7.1 5.2 5.2 0 0 0-10.2-1.6 4.2 4.2 0 0 0-.9 8.7Z" },
  ],
  gear: [
    { d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" },
    { d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" },
  ],
  user: [
    { d: "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" },
    { d: "M5 20.5c1.2-4 4-5.5 7-5.5s5.8 1.5 7 5.5" },
  ],
  search: [
    { d: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" },
    { d: "m15.4 15.4 5.1 5.1" },
  ],
  doc: [
    { d: "M7 3.5h7l4 4v13H7Z" },
    { d: "M14 3.5v4h4" },
  ],
  chart: [
    { d: "M4 4v16h16" },
    { d: "M8.5 16v-4.5M12.5 16V8.5M16.5 16v-7" },
  ],
  check: [{ d: "m5 12.5 4.5 4.5L19 7.5" }],
  cpu: [
    { d: "M7.5 7.5h9v9h-9Z" },
    { d: "M11 11h2v2h-2Z" },
    { d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" },
  ],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlowArrow: React.FC<FlowArrowProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
  lineTimings,
  spec,
}) => {
  const accent = spec.accent ?? theme.colors.accent;
  const availH = availHeight(height, subtitleSafeBottom);
  const marginX = width * LAYOUT.marginXPct;
  const isRow = spec.direction !== "vertical";

  const nodes = spec.nodes;
  const count = nodes.length;
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));

  const edges: { from: string; to: string; label?: string }[] = (
    spec.edges && spec.edges.length > 0
      ? spec.edges
      : nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }))
  ).filter((e) => indexOf.has(e.from) && indexOf.has(e.to) && e.from !== e.to);

  // ---- Beat schedule over nodes -------------------------------------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const active = activeIndexAt(schedule, frame / fps);

  // ---- Type & geometry ----------------------------------------------------
  const headingSize = typeSize(height, "label");
  const labelSize = typeSize(height, "body");
  const edgeLabelSize = typeSize(height, "caption");

  const nodeW = isRow
    ? Math.min(width * 0.26, (width - marginX * 2) / count - space(height, 3))
    : Math.min(width * 0.5, width - marginX * 2);
  const nodeH = isRow
    ? space(height, 8)
    : Math.min(space(height, 8), (availH * 0.62) / count - space(height, 2));

  const trackW = width - marginX * 2;
  const trackH = availH * 0.62;
  const trackLeft = marginX;
  const trackTop = availH * 0.5 - trackH / 2 + (spec.title ? space(height, 3) : 0);

  // Node centres along the main axis, evenly distributed and inset by half
  // a node so the first/last boxes never cross the content margins.
  const centreAt = (i: number): { x: number; y: number } => {
    const half = isRow ? nodeW / 2 : nodeH / 2;
    const span = (isRow ? trackW : trackH) - half * 2;
    const along = count > 1 ? half + (i * span) / (count - 1) : half + span / 2;
    return isRow
      ? { x: trackLeft + along, y: trackTop + trackH / 2 }
      : { x: trackLeft + trackW / 2, y: trackTop + along };
  };

  const headingP = clamp01(springIn(frame, fps, frames(0.05, fps), "gentle"));
  const nodeGlow = breathe(frame, fps, { min: 0.25, max: 0.5, periodSec: 2.6 });

  const iconChip = Math.round(nodeH * 0.58);
  const iconSize = Math.round(iconChip * 0.62);
  const strokeW = Math.max(2, height * 0.0022);
  const dotR = Math.max(2.5, space(height, 0.55));
  const arrowSize = space(height, 1.3);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% ${isRow ? "50%" : "30%"}, ${accent} 0%, transparent 60%)`,
          opacity: 0.05,
          pointerEvents: "none",
        }}
      />

      {spec.title ? (
        <div
          style={{
            position: "absolute",
            top: availH * 0.12,
            left: marginX,
            display: "flex",
            alignItems: "center",
            gap: space(height, 2),
            opacity: headingP,
            transform: `translateY(${(1 - headingP) * space(height, 1.5)}px)`,
          }}
        >
          <div
            style={{
              width: space(height, 1),
              height: headingSize * 1.1,
              backgroundColor: accent,
              borderRadius: 1,
            }}
          />
          <div
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: headingSize,
              letterSpacing: "0.14em",
              color: theme.colors.muted,
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            {spec.title}
          </div>
        </div>
      ) : null}

      {/* Edges — one SVG layer under the nodes. Each path draws itself on
          once both endpoints have appeared; when the stroke completes,
          comet dots start looping along it. */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {edges.map((edge, i) => {
          const fromIdx = indexOf.get(edge.from)!;
          const toIdx = indexOf.get(edge.to)!;
          const a = centreAt(fromIdx);
          const b = centreAt(toIdx);

          // Trim the path to the node boxes so the arrow lands on the rim.
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const trimA = (isRow ? nodeW : nodeH) / 2;
          const trimB = trimA + space(height, 0.75);
          const x1 = a.x + ux * trimA;
          const y1 = a.y + uy * trimA;
          const x2 = b.x - ux * trimB;
          const y2 = b.y - uy * trimB;

          // Adjacent forward links run straight; skipping or backward links
          // bow sideways so parallel strokes never overlap.
          const skip = Math.abs(toIdx - fromIdx);
          const bowDir = toIdx > fromIdx ? -1 : 1;
          const bowMag =
            skip > 1
              ? Math.min(space(height, 5), dist * 0.15)
              : toIdx < fromIdx
                ? space(height, 3)
                : 0;
          const ox = isRow ? 0 : bowMag * bowDir;
          const oy = isRow ? bowMag * bowDir : 0;
          const c1x = x1 + (x2 - x1) * 0.3 + ox;
          const c1y = y1 + (y2 - y1) * 0.3 + oy;
          const c2x = x1 + (x2 - x1) * 0.7 + ox;
          const c2y = y1 + (y2 - y1) * 0.7 + oy;
          const d = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
          const pathLen = getLength(d);

          // Draw-on starts after the later of the two nodes appears.
          const laterNode = Math.max(fromIdx, toIdx);
          const drawDur = Math.max(1, frames(DUR.enterSec, fps));
          const startFrame = frames(
            0.25 + laterNode * DUR.staggerSec + DUR.enterSec * 0.9,
            fps,
          );
          const p = enterProgress(frame, startFrame, drawDur, EASE.inOut);
          const dash = evolvePath(p, d);
          const drawEnd = startFrame + drawDur;

          // Arrowhead rides the path tangent at the tip.
          const tip = getPointAtLength(d, pathLen);
          const tan = getTangentAtLength(d, pathLen);
          let arrowD: string | null = null;
          if (tip && tan) {
            const tl = Math.hypot(tan.x, tan.y) || 1;
            const tx = tan.x / tl;
            const ty = tan.y / tl;
            const bx = tip.x - tx * arrowSize;
            const by = tip.y - ty * arrowSize;
            const px = -ty;
            const py = tx;
            arrowD = `M ${tip.x} ${tip.y} L ${bx + px * arrowSize * 0.45} ${by + py * arrowSize * 0.45} L ${bx - px * arrowSize * 0.45} ${by - py * arrowSize * 0.45} Z`;
          }

          // Comet dots: two per edge, phase-offset, with a fading trail.
          const flowing = frame >= drawEnd && pathLen > 1;
          const DOTS = 2;
          const speedPxPerSec = width * 0.24;
          const periodFrames = Math.max(
            1,
            Math.round((pathLen / speedPxPerSec) * fps),
          );

          const mid = getPointAtLength(d, pathLen * 0.5);

          return (
            <g key={i}>
              <path
                d={d}
                fill="none"
                stroke={accent}
                strokeWidth={strokeW}
                strokeLinecap="round"
                strokeDasharray={dash.strokeDasharray}
                strokeDashoffset={dash.strokeDashoffset}
                opacity={0.85}
              />
              {arrowD ? (
                <path d={arrowD} fill={accent} opacity={clamp01((p - 0.8) / 0.2)} />
              ) : null}
              {flowing
                ? Array.from({ length: DOTS }, (_, k) => {
                    const prog =
                      (((frame - drawEnd) / periodFrames +
                        k / DOTS +
                        i * 0.31) %
                        1 +
                        1) %
                      1;
                    const pos = getPointAtLength(d, prog * pathLen);
                    if (!pos) return null;
                    return (
                      <g key={k}>
                        {[2, 1].map((j) => {
                          const trailProg = prog - j * 0.035;
                          if (trailProg < 0) return null;
                          const tp = getPointAtLength(d, trailProg * pathLen);
                          if (!tp) return null;
                          return (
                            <circle
                              key={j}
                              cx={tp.x}
                              cy={tp.y}
                              r={dotR * (1 - j * 0.3)}
                              fill={accent}
                              opacity={0.28 / j}
                            />
                          );
                        })}
                        <circle cx={pos.x} cy={pos.y} r={dotR * 2.4} fill={accent} opacity={0.18} />
                        <circle cx={pos.x} cy={pos.y} r={dotR} fill={accent} />
                        <circle cx={pos.x} cy={pos.y} r={dotR * 0.45} fill={theme.colors.bg} opacity={0.9} />
                      </g>
                    );
                  })
                : null}
              {edge.label && mid ? (
                <text
                  x={isRow ? mid.x : mid.x + space(height, 1.5)}
                  y={isRow ? mid.y - space(height, 1.25) : mid.y}
                  textAnchor={isRow ? "middle" : "start"}
                  dominantBaseline={isRow ? "auto" : "central"}
                  fontFamily={theme.fonts.mono}
                  fontSize={edgeLabelSize}
                  fill={theme.colors.muted}
                  stroke={theme.colors.bg}
                  strokeWidth={space(height, 0.5)}
                  paintOrder="stroke"
                  opacity={p}
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      {nodes.map((node, i) => {
        const enter = springIn(
          frame,
          fps,
          frames(0.25 + i * DUR.staggerSec, fps),
          "pop",
        );
        const p = clamp01(enter);
        const c = centreAt(i);
        const isActive = i === active;
        const icon = node.icon ? ICONS[node.icon] : undefined;

        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: c.x - nodeW / 2,
              top: c.y - nodeH / 2,
              width: nodeW,
              height: nodeH,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              gap: space(height, 1.5),
              padding: `${space(height, 1)}px ${space(height, 2)}px`,
              backgroundColor: theme.colors.code.bg,
              border: `${Math.max(2, height * 0.002)}px solid ${isActive ? accent : theme.colors.muted}`,
              borderRadius: space(height, 2),
              opacity: p,
              transform: `translateY(${(1 - p) * space(height, 2.5)}px) scale(${0.55 + p * 0.45})`,
              boxShadow: isActive
                ? `0 0 ${space(height, 3)}px ${accent}`
                : `0 ${space(height, 1)}px ${space(height, 3)}px rgba(0,0,0,0.35)`,
            }}
          >
            {/* Active-node breathing halo */}
            {isActive ? (
              <div
                style={{
                  position: "absolute",
                  inset: -space(height, 0.75),
                  borderRadius: space(height, 2.5),
                  backgroundColor: accent,
                  opacity: nodeGlow * 0.25,
                  pointerEvents: "none",
                }}
              />
            ) : null}
            {icon ? (
              <div
                style={{
                  position: "relative",
                  width: iconChip,
                  height: iconChip,
                  flexShrink: 0,
                  borderRadius: space(height, 1),
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: accent,
                    opacity: 0.14,
                  }}
                />
                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
                  {icon.map((glyph, gi) => (
                    <path
                      key={gi}
                      d={glyph.d}
                      fill={glyph.filled ? accent : "none"}
                      stroke={glyph.filled ? "none" : accent}
                      strokeWidth={glyph.filled ? 0 : 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </svg>
              </div>
            ) : null}
            <div
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: labelSize,
                fontWeight: 600,
                lineHeight: 1.3,
                textAlign: "center",
                color: theme.colors.fg,
                overflow: "hidden",
              }}
            >
              {node.label}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export default FlowArrow;
