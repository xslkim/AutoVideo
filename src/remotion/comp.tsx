import React from "react";
import { interpolate, Easing } from "remotion";

interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: Record<string, string>;
  fps: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const WorldPanel: React.FC<{
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  opacity: number;
  panelSize: number;
  cx: number;
  cy: number;
}> = ({ translateX, translateY, rotation, scaleX, opacity, panelSize, cx, cy }) => {
  const half = panelSize / 2;
  const gridSpacing = panelSize / 14;
  const gridLines: React.ReactNode[] = [];
  for (let i = 0; i <= 14; i++) {
    const pos = i * gridSpacing;
    gridLines.push(
      <line key={`h${i}`} x1={0} y1={pos} x2={panelSize} y2={pos} stroke="#21262d" strokeWidth={0.5} />,
      <line key={`v${i}`} x1={pos} y1={0} x2={pos} y2={panelSize} stroke="#21262d" strokeWidth={0.5} />,
    );
  }

  const carW = panelSize * 0.10;
  const carH = panelSize * 0.07;
  const carX = panelSize * 0.18;
  const carY = panelSize * 0.22;

  const camSize = panelSize * 0.09;
  const camX = panelSize * 0.63;
  const camY = panelSize * 0.58;
  const triLen = camSize * 0.65;
  const triPts = `${camX + camSize + triLen},${camY + camSize / 2} ${camX + camSize},${camY + camSize * 0.12} ${camX + camSize},${camY + camSize * 0.88}`;

  return (
    <g
      opacity={opacity}
      transform={`translate(${cx + half}, ${cy + half}) translate(${translateX}, ${translateY}) rotate(${rotation}) scale(${scaleX}, 1) translate(${-half}, ${-half})`}
    >
      {/* world panel */}
      <rect x={0} y={0} width={panelSize} height={panelSize} fill="#0d1117" stroke="#30363d" strokeWidth={1} rx={4} />
      {gridLines}
      {/* border highlight */}
      <rect x={0} y={0} width={panelSize} height={panelSize} fill="none" stroke="#30363d" strokeWidth={1} rx={4} />

      {/* origin cross */}
      <line x1={half - 12} y1={half} x2={half + 12} y2={half} stroke="#58a6ff" strokeWidth={1.5} />
      <line x1={half} y1={half - 12} x2={half} y2={half + 12} stroke="#58a6ff" strokeWidth={1.5} />
      <circle cx={half} cy={half} r={3} fill="#58a6ff" />
      <text x={half + 16} y={half + 5} fill="#58a6ff" fontSize={panelSize * 0.032} fontFamily="monospace">
        原点(目标)
      </text>

      {/* Car */}
      <g transform={`translate(${carX}, ${carY})`}>
        <rect x={0} y={0} width={carW} height={carH} rx={3} fill="#58a6ff" />
        <rect x={-3} y={-4} width={6} height={4} rx={1} fill="#58a6ff" opacity={0.5} />
        <rect x={-3} y={carH} width={6} height={4} rx={1} fill="#58a6ff" opacity={0.5} />
        <rect x={carW - 3} y={-4} width={6} height={4} rx={1} fill="#58a6ff" opacity={0.5} />
        <rect x={carW - 3} y={carH} width={6} height={4} rx={1} fill="#58a6ff" opacity={0.5} />
      </g>
      <text x={carX} y={carY - 8} fill="#58a6ff" fontSize={panelSize * 0.028} fontFamily="monospace">
        小车
      </text>

      {/* Camera */}
      <g>
        <rect x={camX} y={camY} width={camSize} height={camSize} rx={2} fill="white" />
        <circle cx={camX + camSize / 2} cy={camY + camSize / 2} r={camSize * 0.22} fill="#0d1117" />
        <polygon points={triPts} fill="#58a6ff" />
      </g>
      <text x={camX} y={camY - 8} fill="white" fontSize={panelSize * 0.028} fontFamily="monospace">
        相机
      </text>
    </g>
  );
};

const StepCard: React.FC<{
  step: string;
  title: string;
  desc: string;
  active: boolean;
  done: boolean;
  y: number;
  cardWidth: number;
  cardHeight: number;
  fontSize: number;
}> = ({ step, title, desc, active, done, y, cardWidth, cardHeight, fontSize }) => {
  const isHighlight = active || done;
  const borderColor = done ? "#58a6ff" : active ? "#58a6ff" : "#30363d";
  const textColor = done ? "white" : active ? "white" : "#8b949e";
  const leftBorderW = done || active ? 4 : 2;
  const bgColor = done ? "#1c2333" : active ? "#1c2333" : "#161b22";
  const s = active ? 1.03 : 1;

  return (
    <g transform={`translate(0, ${y}) scale(${s}, ${s})`}>
      <rect x={0} y={0} width={cardWidth} height={cardHeight} rx={8} fill={bgColor} stroke={borderColor} strokeWidth={1} />
      <rect x={0} y={0} width={leftBorderW} height={cardHeight} rx={0} fill={isHighlight ? "#58a6ff" : "#30363d"} />
      {/* Step number circle */}
      <circle cx={28} cy={cardHeight / 2 - fontSize * 0.3} r={14} fill={isHighlight ? "#58a6ff" : "#21262d"} />
      <text x={28} y={cardHeight / 2 - fontSize * 0.3 + 5} fill={isHighlight ? "#0d1117" : "#8b949e"} fontSize={fontSize * 0.7} fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">
        {step}
      </text>
      {/* Title */}
      <text x={56} y={cardHeight / 2 - 4} fill={textColor} fontSize={fontSize} fontFamily="sans-serif" fontWeight={isHighlight ? "bold" : "normal"}>
        {title}
      </text>
      {/* Description */}
      <text x={56} y={cardHeight / 2 + fontSize + 2} fill={isHighlight ? "#8b949e" : "#484f58"} fontSize={fontSize * 0.75} fontFamily="sans-serif">
        {desc}
      </text>
      {/* Done checkmark */}
      {done && (
        <text x={cardWidth - 24} y={cardHeight / 2 + 6} fill="#58a6ff" fontSize={fontSize * 1.2} fontFamily="sans-serif" textAnchor="middle">
          ✓
        </text>
      )}
    </g>
  );
};

// ─── Coordinate axes legend ──────────────────────────────────────────────────

const AxesLegend: React.FC<{ x: number; y: number; size: number; frame: number; step2active: boolean; step3active: boolean }> = ({
  x, y, size, frame, step2active, step3active,
}) => {
  const arrowSize = size * 0.15;
  const gap = size * 0.35;
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <g opacity={opacity} transform={`translate(${x}, ${y})`}>
      <text x={0} y={0} fill="#8b949e" fontSize={size * 0.12} fontFamily="monospace">
        坐标系
      </text>
      {/* X axis */}
      <line x1={0} y1={gap} x2={gap * 0.7} y2={gap} stroke="#f85149" strokeWidth={1.5} />
      <polygon points={`${gap * 0.7},${gap} ${gap * 0.7 - arrowSize},${gap - arrowSize * 0.5} ${gap * 0.7 - arrowSize},${gap + arrowSize * 0.5}`} fill="#f85149" />
      <text x={gap * 0.7 + 4} y={gap + 4} fill="#f85149" fontSize={size * 0.1} fontFamily="monospace">X</text>
      {/* Y axis */}
      <line x1={0} y1={gap} x2={0} y2={gap * 0.3} stroke="#3fb950" strokeWidth={1.5} />
      <polygon points={`0,${gap * 0.3} ${-arrowSize * 0.5},${gap * 0.3 + arrowSize} ${arrowSize * 0.5},${gap * 0.3 + arrowSize}`} fill="#3fb950" />
      <text x={6} y={gap * 0.3 - 4} fill="#3fb950" fontSize={size * 0.1} fontFamily="monospace">Y</text>
      {/* Z axis (shown dimmed) */}
      {step3active && (
        <text x={0} y={gap + size * 0.25} fill="#58a6ff" fontSize={size * 0.085} fontFamily="monospace">
          Z 翻转完成
        </text>
      )}
    </g>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

const Comp: React.FC<AnimationProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}) => {
  const safeBottom = Math.max(subtitleSafeBottom, 50);
  const availH = height - safeBottom;
  const margin = Math.min(width, height) * 0.04;

  // ── Timings (seconds) ──────────────────────────────────────────────────
  const fadeInEnd = 0.6 * fps;
  const step1Start = 1 * fps;
  const step1End = 3 * fps;
  const step2Start = 3 * fps;
  const step2End = 5 * fps;
  const step3Start = 5 * fps;
  const step3End = 7.5 * fps;

  // ── Layout ─────────────────────────────────────────────────────────────
  const titleFontSize = height * 0.075;
  const titleY = safeBottom + titleFontSize * 1.1;

  const leftAreaTop = titleY + titleFontSize * 0.6;
  const leftAreaH = availH - (leftAreaTop - safeBottom) - 20;
  const panelSize = Math.min(width * 0.42, leftAreaH * 0.85);
  const panelCX = margin + width * 0.01;
  const panelCY = leftAreaTop + (leftAreaH - panelSize) / 2;

  const rightColX = width * 0.5 + margin;
  const rightW = width - rightColX - margin;
  const cardW = rightW;
  const cardH = Math.min(availH * 0.14, height * 0.10); // ~108px at 1080p
  const cardGap = availH * 0.035;
  const threeCardsH = 3 * cardH + 2 * cardGap;
  const stepsLabelH = height * 0.035;
  const stepsBlockH = stepsLabelH + 10 + threeCardsH;
  const stepsTop = safeBottom + (availH - stepsBlockH) / 2 + 20;

  const cardFontSize = height * 0.026;
  const subtitleFontSize = height * 0.02;

  // ── Animations ─────────────────────────────────────────────────────────
  const panelOpacity = interpolate(frame, [0, fadeInEnd], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  const initCamRelX = 0.63 * panelSize - panelSize / 2;
  const initCamRelY = 0.58 * panelSize - panelSize / 2;

  const t1p = interpolate(frame, [step1Start, step1End], [0, 1], {
    easing: Easing.inOut(Easing.ease), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const tx = -initCamRelX * t1p;
  const ty = -initCamRelY * t1p;

  const t2p = interpolate(frame, [step2Start, step2End], [0, 1], {
    easing: Easing.inOut(Easing.ease), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const rot = 90 * t2p;

  const t3p = interpolate(frame, [step3Start, step3End], [0, 1], {
    easing: Easing.inOut(Easing.ease), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const sx = 1 - 2 * t3p;

  const flashIntensity = interpolate(frame, [step3Start, step3Start + 0.12 * fps, step3Start + 0.3 * fps], [0, 0.55, 0], {
    easing: Easing.out(Easing.ease), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  const step1active = frame >= step1Start && frame < step2Start;
  const step2active = frame >= step2Start && frame < step3Start;
  const step3active = frame >= step3Start;
  const step1done = frame >= step2Start;
  const step2done = frame >= step3Start;

  const progress = Math.min(frame / durationInFrames, 1);

  // Subtitle safe bottom area
  const subY = height - safeBottom + 6;
  const progBarY = height - safeBottom + 24;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: "#0d1117" }}>
      <defs>
        <linearGradient id="flashG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="50%" stopColor="white" stopOpacity={flashIntensity} />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id="clipPanel">
          <rect x={panelCX} y={panelCY} width={panelSize} height={panelSize} rx={4} />
        </clipPath>
      </defs>

      {/* ── Background grid (subtle) ─────────────────────────────────── */}
      <g opacity={0.035}>
        {Array.from({ length: 30 }).map((_, i) => (
          <line key={`bg-h${i}`} x1={0} y1={i * (height / 30)} x2={width} y2={i * (height / 30)} stroke="white" strokeWidth={0.5} />
        ))}
        {Array.from({ length: 40 }).map((_, i) => (
          <line key={`bg-v${i}`} x1={i * (width / 40)} y1={0} x2={i * (width / 40)} y2={height} stroke="white" strokeWidth={0.5} />
        ))}
      </g>

      {/* ── Title ────────────────────────────────────────────────────── */}
      <text
        x={width * 0.5}
        y={titleY}
        fill="white"
        fontSize={titleFontSize}
        fontFamily="sans-serif"
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        视图变换：从世界到相机
      </text>
      {/* Title accent underline */}
      <line
        x1={width * 0.38}
        y1={titleY + titleFontSize * 0.5}
        x2={width * 0.62}
        y2={titleY + titleFontSize * 0.5}
        stroke="#58a6ff"
        strokeWidth={2}
        opacity={0.6}
      />

      {/* ── Subtitle ─────────────────────────────────────────────────── */}
      <text
        x={width * 0.5}
        y={titleY + titleFontSize * 0.9}
        fill="#8b949e"
        fontSize={subtitleFontSize}
        fontFamily="sans-serif"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        三步世界变换，将相机对齐到 -Z 观察方向
      </text>

      {/* ── Left: World panel ────────────────────────────────────────── */}
      <g>
        <WorldPanel
          translateX={tx}
          translateY={ty}
          rotation={rot}
          scaleX={sx}
          opacity={panelOpacity}
          panelSize={panelSize}
          cx={panelCX}
          cy={panelCY}
        />
        {/* Flash overlay */}
        <rect x={panelCX} y={panelCY} width={panelSize} height={panelSize} fill="url(#flashG)" clipPath="url(#clipPanel)" />
      </g>

      {/* ── Axes legend beneath panel ────────────────────────────────── */}
      <AxesLegend
        x={panelCX + panelSize * 0.05}
        y={panelCY + panelSize + 12}
        size={panelSize * 0.35}
        frame={frame}
        step2active={step2active}
        step3active={step3active}
      />

      {/* ── Right: Steps ─────────────────────────────────────────────── */}
      <g transform={`translate(${rightColX}, 0)`}>
        <text
          x={0}
          y={stepsTop}
          fill="#8b949e"
          fontSize={stepsLabelH}
          fontFamily="sans-serif"
          fontWeight="bold"
        >
          变换步骤
        </text>
        <line x1={0} y1={stepsTop + 4} x2={cardW} y2={stepsTop + 4} stroke="#21262d" strokeWidth={1} />

        <StepCard
          step="1"
          title="把世界平移"
          desc="平移使相机图标滑到原点十字处"
          active={step1active}
          done={step1done}
          y={stepsTop + 16}
          cardWidth={cardW}
          cardHeight={cardH}
          fontSize={cardFontSize}
        />
        <StepCard
          step="2"
          title="把世界旋转"
          desc="旋转抵消相机朝向，使箭头指向 -Z"
          active={step2active}
          done={step2done}
          y={stepsTop + 16 + cardH + cardGap}
          cardWidth={cardW}
          cardHeight={cardH}
          fontSize={cardFontSize}
        />
        <StepCard
          step="3"
          title="翻转 Z 轴"
          desc="左手系 → 观察系 (镜像翻转)"
          active={step3active}
          done={false}
          y={stepsTop + 16 + 2 * (cardH + cardGap)}
          cardWidth={cardW}
          cardHeight={cardH}
          fontSize={cardFontSize}
        />
      </g>

      {/* ── Bottom safe area ─────────────────────────────────────────── */}
      <text
        x={width * 0.5}
        y={subY}
        fill="#8b949e"
        fontSize={subtitleFontSize}
        fontFamily="sans-serif"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        通过世界变换将相机对齐到 -Z 观察方向 | 视图变换 (View Transform)
      </text>

      <rect x={width * 0.12} y={progBarY} width={width * 0.76} height={3} rx={1.5} fill="#21262d" />
      <rect x={width * 0.12} y={progBarY} width={width * 0.76 * progress} height={3} rx={1.5} fill="#58a6ff" />
    </svg>
  );
};

export default Comp;
