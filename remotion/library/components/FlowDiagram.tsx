/**
 * AutoVideo — Library component: FlowDiagram
 *
 * Node-and-edge process flow: chips stagger in with springs along a row or
 * column, then connective strokes draw themselves between them. The
 * narration beat (lineTimings, or an even rhythm when empty) walks an accent
 * glow across the nodes.
 * Registry entry: see src/ai/visual-registry.ts ("FlowDiagram").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, availHeight, frames, space, typeSize } from "../tokens";
import {
  activeIndexAt,
  breathe,
  clamp01,
  enterProgress,
  resolveBeatSchedule,
  staggeredSpring,
} from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface FlowDiagramSpec extends AccentOverride {
  /** Small mono heading pinned top-left, e.g. "数据流". */
  title?: string;
  /** Main axis of the flow. Default "row". */
  direction?: "row" | "column";
  /** 2–6 nodes, in logical order; positions follow array order. */
  nodes: { id: string; label: string; detail?: string }[];
  /**
   * Connections by node id. Defaults to a simple chain
   * (nodes[i] → nodes[i+1]).
   */
  edges?: { from: string; to: string; label?: string }[];
}

export type FlowDiagramProps = LibraryProps<FlowDiagramSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlowDiagram: React.FC<FlowDiagramProps> = ({
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
  const marginX = width * 0.0625;
  const direction = spec.direction ?? "row";

  const nodes = spec.nodes;
  const count = nodes.length;
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));

  const edges: { from: string; to: string; label?: string }[] = (
    spec.edges && spec.edges.length > 0
      ? spec.edges
      : nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }))
  ).filter((e) => indexOf.has(e.from) && indexOf.has(e.to));

  // ---- Beat schedule over nodes -------------------------------------------
  const durationSec = durationInFrames / fps;
  const schedule = resolveBeatSchedule(lineTimings, count, durationSec);
  const active = activeIndexAt(schedule, frame / fps);

  // ---- Type & geometry ----------------------------------------------------
  const headingSize = typeSize(height, "label");
  const labelSize = typeSize(height, "body");
  const detailSize = typeSize(height, "caption");

  const isRow = direction === "row";
  const nodeW = isRow
    ? Math.min(width * 0.24, (width - marginX * 2) / count - space(height, 3))
    : Math.min(width * 0.52, width - marginX * 2);
  const nodeH = isRow
    ? Math.max(space(height, 10), availH * 0.2)
    : Math.min(space(height, 10), (availH * 0.62) / count - space(height, 2));

  const trackW = width - marginX * 2;
  const trackH = availH * 0.62;
  const trackLeft = marginX;
  const trackTop = availH * 0.5 - trackH / 2 + (spec.title ? space(height, 3) : 0);

  // Node centres along the main axis, evenly distributed and inset by half
  // a node so the first/last boxes never cross the content margins.
  const centreAt = (i: number): { x: number; y: number } => {
    const half = isRow ? nodeW / 2 : nodeH / 2;
    const span = (isRow ? trackW : trackH) - half * 2;
    const along = count > 1 ? half + i * (span / (count - 1)) : half + span / 2;
    return isRow
      ? { x: trackLeft + along, y: trackTop + trackH / 2 }
      : { x: trackLeft + trackW / 2, y: trackTop + along };
  };

  const headingP = clamp01(staggeredSpring(frame, fps, 0, { preset: "gentle" }));
  const nodeGlow = breathe(frame, fps, { min: 0.25, max: 0.5, periodSec: 2.6 });

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

      {/* Edges — one SVG layer under the nodes; each stroke draws itself on
          once both endpoints have appeared. */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke={accent} strokeWidth="1.6" />
          </marker>
        </defs>
        {edges.map((edge, i) => {
          const fromIdx = indexOf.get(edge.from)!;
          const toIdx = indexOf.get(edge.to)!;
          const a = centreAt(fromIdx);
          const b = centreAt(toIdx);

          // Trim the stroke to the node boxes so the arrow lands on the rim.
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const trimA = isRow ? nodeW / 2 : nodeH / 2;
          const trimB = isRow ? nodeW / 2 + space(height, 0.75) : nodeH / 2 + space(height, 0.75);
          const x1 = a.x + (dx / len) * trimA;
          const y1 = a.y + (dy / len) * trimA;
          const x2 = b.x - (dx / len) * trimB;
          const y2 = b.y - (dy / len) * trimB;
          const drawnLen = Math.hypot(x2 - x1, y2 - y1);

          // Draw-on starts after the later of the two nodes appears.
          const laterNode = Math.max(fromIdx, toIdx);
          const startFrame =
            frames(0.1 + 0.25 + laterNode * DUR.staggerSec + DUR.enterSec * 0.7, fps);
          const p = enterProgress(frame, startFrame, frames(DUR.enterSec, fps));

          return (
            <g key={i} opacity={p}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={accent}
                strokeWidth={Math.max(2, height * 0.0022)}
                strokeDasharray={drawnLen}
                strokeDashoffset={(1 - p) * drawnLen}
                markerEnd="url(#flow-arrow)"
                opacity={0.85}
              />
              {edge.label ? (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - space(height, 1.25)}
                  textAnchor="middle"
                  fontFamily={theme.fonts.mono}
                  fontSize={detailSize}
                  fill={theme.colors.muted}
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
        const enter = staggeredSpring(frame, fps, i, {
          baseSec: 0.25,
          preset: "snappy",
        });
        const p = clamp01(enter);
        const c = centreAt(i);
        const isActive = i === active;

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
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: space(height, 0.75),
              padding: `${space(height, 1.5)}px ${space(height, 2)}px`,
              backgroundColor: theme.colors.code.bg,
              border: `${Math.max(2, height * 0.002)}px solid ${isActive ? accent : theme.colors.muted}`,
              borderRadius: space(height, 1.5),
              opacity: p,
              transform: `translateY(${(1 - p) * space(height, 2.5)}px) scale(${0.9 + p * 0.1})`,
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
                  borderRadius: space(height, 2),
                  backgroundColor: accent,
                  opacity: nodeGlow * 0.25,
                  pointerEvents: "none",
                }}
              />
            ) : null}
            <div
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: labelSize,
                fontWeight: 600,
                lineHeight: 1.3,
                textAlign: "center",
                color: theme.colors.fg,
              }}
            >
              {node.label}
            </div>
            {node.detail ? (
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: detailSize,
                  fontWeight: 400,
                  lineHeight: 1.4,
                  textAlign: "center",
                  color: theme.colors.muted,
                }}
              >
                {node.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export default FlowDiagram;
