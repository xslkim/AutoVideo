import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import {
  breathe,
  clamp01,
  exitProgress,
  space,
  staggeredSpring,
  typeSize,
} from "../../../remotion/library";

interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: any;
  fps: number;
  lineTimings: { startSec: number; endSec: number }[];
}

const LABELS = ["一条加法指令", "八份浮点数据并排", "一次算完八份结果"];
const DETAILS = [
  "x86 AVX 式：一条指令",
  "数据整齐排成 256 位向量",
  "多份数据同时算完",
];

// Line → lit-node mapping (driven by props.lineTimings at runtime):
// L0: ①② pop in and light up · L1: ①② stay lit · L2: only ② ·
// L3: only ① · L4: ③ pops in, all three converge lit.
const litAt = (lineIdx: number, node: number): boolean => {
  const L = Math.max(0, lineIdx);
  if (node === 2) return L >= 4;
  if (L >= 4) return true;
  if (L === 3) return node === 0;
  if (L === 2) return node === 1;
  return true; // L0 / L1 / pre-roll: nodes ①② lit
};

const Component: React.FC<AnimationProps> = (props) => {
  const { frame, fps, width, height, subtitleSafeBottom, theme, lineTimings, durationInFrames } = props;
  const availH = height - subtitleSafeBottom;
  const t = frame / fps;

  // Constant (per-render) line start seconds with an even-spacing fallback.
  const starts = [0, 1, 2, 3, 4].map((i) => lineTimings[i]?.startSec ?? i * 3);

  // Active narration line: LAST line whose startSec <= t (survives gaps).
  let active = -1;
  for (let i = 0; i < starts.length; i++) {
    if (t >= starts[i]) active = i;
    else break;
  }

  // Layout
  const marginX = width * 0.05;
  const cardW = width * 0.27;
  const gapX = (width - 2 * marginX - 3 * cardW) / 2;
  const cardH = availH * 0.5;
  const badgeH = availH * 0.07;
  const capH = availH * 0.13;
  const gapY = availH * 0.03;
  const clusterH = badgeH + gapY + cardH + gapY + capH;
  const topPad = (availH - clusterH) / 2;
  const cx = (i: number) => marginX + cardW / 2 + i * (cardW + gapX);

  const labelFs = height * 0.07;
  const detailFs = Math.max(height * 0.028, typeSize(height, "body") * 1.04);
  const badgeFs = height * 0.032;
  const strokeW = Math.max(3, height * 0.004);

  // Ambient + exit
  const glowPulse = breathe(frame, fps, { min: 0.55, max: 1 });

  const nodeRender = (i: number) => {
    // Entrance: ①② at line 0 (staggered), ③ at line 4.
    const enterSec = i === 2 ? starts[4] : starts[0];
    const enter = staggeredSpring(frame - enterSec * fps, fps, i === 1 ? 1 : 0, {
      stepSec: 0.15,
      preset: "gentle",
    });
    const enterP = clamp01(enter);
    if (enterP <= 0.001) return null;

    // Lit progress: find the last state change at or before the active line,
    // then ease over 0.45 s from the previous state.
    let prevLit = litAt(-1, i);
    let curLit = litAt(-1, i);
    let changeT = starts[0];
    for (let li = 0; li <= active; li++) {
      const s = litAt(li, i);
      if (s !== curLit) {
        prevLit = curLit;
        curLit = s;
        changeT = starts[li];
      }
    }
    const litK = clamp01((t - changeT) / 0.45);
    const litP = (prevLit ? 1 : 0) + ((curLit ? 1 : 0) - (prevLit ? 1 : 0)) * litK;

    const exit = exitProgress(frame, durationInFrames, i, 3, fps);

    const scale = (0.7 + 0.3 * enterP) * (1 + 0.06 * litP);
    const dim = 0.38 + 0.62 * litP;
    const glow = litP * glowPulse;

    const x = cx(i) - cardW / 2;
    const cardTop = topPad + badgeH + gapY;

    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: topPad,
          width: cardW,
          height: clusterH,
          opacity: enterP * (1 - exit),
          transform: `translateY(${exit * space(height, 3)}px)`,
        }}
      >
        {/* Number badge */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            height: badgeH,
            paddingLeft: badgeH * 0.45,
            paddingRight: badgeH * 0.45,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: badgeH / 2,
            border: `${strokeW * 0.6}px solid ${theme.colors.accent}`,
            color: theme.colors.accent,
            backgroundColor: theme.colors.bg,
            fontFamily: theme.fonts.mono,
            fontSize: badgeFs,
            lineHeight: 1,
            whiteSpace: "nowrap",
            opacity: dim,
            boxShadow: `0 0 ${space(height, 2)}px ${theme.colors.accent}${Math.round(
              glow * 140,
            )
              .toString(16)
              .padStart(2, "0")}`,
          }}
        >
          {i + 1}
        </div>

        {/* Card */}
        <div
          style={{
            position: "absolute",
            top: badgeH + gapY,
            left: 0,
            width: cardW,
            height: cardH,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            borderRadius: space(height, 1.5),
            border: `${strokeW}px solid ${theme.colors.accent}`,
            backgroundColor: theme.colors.code.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingLeft: space(height, 2),
            paddingRight: space(height, 2),
            boxSizing: "border-box",
            opacity: dim,
            boxShadow: `0 0 ${space(height, 3)}px ${theme.colors.accent}${Math.round(
              glow * 160,
            )
              .toString(16)
              .padStart(2, "0")}`,
          }}
        >
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontWeight: 700,
              fontSize: labelFs,
              lineHeight: 1.25,
              color: theme.colors.fg,
              textAlign: "center",
              wordBreak: "break-all",
            }}
          >
            {LABELS[i]}
          </div>
        </div>

        {/* Detail caption */}
        <div
          style={{
            position: "absolute",
            top: badgeH + gapY + cardH + gapY,
            left: 0,
            width: cardW,
            height: capH,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            fontFamily: theme.fonts.sans,
            fontSize: detailFs,
            lineHeight: 1.4,
            color: theme.colors.muted,
            textAlign: "center",
            opacity: dim,
            paddingLeft: space(height, 1),
            paddingRight: space(height, 1),
            boxSizing: "border-box",
          }}
        >
          {DETAILS[i]}
        </div>
      </div>
    );
  };

  // Edges: 0→1 draws in shortly after line 0; 1→2 draws in with line 4.
  const edgeTop = topPad + badgeH + gapY + cardH / 2;
  const edge = (a: number, b: number, drawStartSec: number) => {
    const x0 = cx(a) + cardW / 2;
    const x1 = cx(b) - cardW / 2;
    const s0 = Math.max(0, (drawStartSec + 0.3) * fps);
    const s1 = Math.max(s0 + 1, (drawStartSec + 0.8) * fps);
    const p = interpolate(frame, [s0, s1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    if (p <= 0.001) return null;
    const len = (x1 - x0) * p;
    const exit = exitProgress(frame, durationInFrames, a, 3, fps);
    return (
      <svg
        key={`e${a}`}
        style={{
          position: "absolute",
          left: x0,
          top: edgeTop - strokeW * 3,
          width: Math.max(1, x1 - x0),
          height: strokeW * 6,
          overflow: "visible",
          opacity: 1 - exit,
        }}
      >
        <line
          x1={0}
          y1={strokeW * 3}
          x2={len}
          y2={strokeW * 3}
          stroke={theme.colors.accent}
          strokeWidth={strokeW}
          strokeLinecap="round"
          opacity={0.5 + 0.5 * glowPulse}
        />
        <polygon
          points={`${len},${strokeW * 3} ${len - strokeW * 3},${strokeW * 1.2} ${len - strokeW * 3},${strokeW * 4.8}`}
          fill={theme.colors.accent}
          opacity={p >= 0.99 ? 1 : 0}
        />
      </svg>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1117" }}>
      {edge(0, 1, starts[0])}
      {edge(1, 2, starts[4])}
      {nodeRender(0)}
      {nodeRender(1)}
      {nodeRender(2)}
    </AbsoluteFill>
  );
};

export default Component;
