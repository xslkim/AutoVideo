import React from 'react';
import { interpolate, Easing, spring } from 'remotion';

interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: Record<string, unknown>;
  fps: number;
}

const ViewTransformDemo: React.FC<AnimationProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  fps,
}) => {
  /* ── palette ────────────────────────────────────────── */
  const accent = '#58a6ff';
  const bg = '#0d1117';
  const border = '#30363d';
  const gridLine = '#21262d';
  const cardBg = '#161b22';
  const dimText = '#8b949e';

  /* ── timing markers ─────────────────────────────────── */
  const tFadeEnd = fps * 0.6;
  const t1 = fps * 1;
  const t2 = fps * 3;
  const t3 = fps * 5;
  const animDur = fps * 0.9; // shared animation duration ~0.9s

  /* ── layout geometry ────────────────────────────────── */
  const safeBot = subtitleSafeBottom || 50;
  const pad = Math.min(width, height) * 0.055;
  const contentW = width - pad * 2;
  const contentH = height - pad * 2 - safeBot;

  const leftW = contentW * 0.49;
  const rightW = contentW * 0.46;
  const colGap = contentW * 0.03;

  const panelSize = Math.min(leftW, contentH * 0.88);
  const panelLeft = pad;
  const panelTop = pad + (contentH - panelSize) / 2;

  const rightLeft = pad + leftW + colGap;
  const cardH = contentH * 0.24;
  const cardGap = contentH * 0.04;
  const cardsTotalH = cardH * 3 + cardGap * 2;
  const rightTop = pad + (contentH - cardsTotalH) / 2;

  /* ── font sizes (scaled from canvas) ────────────────── */
  const cardFontSize = height * 0.03;
  const stepNumSize = height * 0.026;
  const originLabelSize = height * 0.018;
  const cmLabelSize = height * 0.016;

  /* ── world initial state ────────────────────────────── */
  const camOffsetX = panelSize * 0.25;   // camera offset from origin (right)
  const camOffsetY = -panelSize * 0.18;  // camera offset from origin (up)
  const camInitAngle = 38;               // arrow tilted 38° right of downward

  // Car sits elsewhere in the world as a visual anchor
  const carX = -panelSize * 0.22;
  const carY = panelSize * 0.2;

  /* ── animated transforms ────────────────────────────── */
  const worldOpacity = interpolate(frame, [0, tFadeEnd], [0, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  // Step 1  translate — bring camera to origin
  const tx = interpolate(frame, [t1, t1 + animDur], [0, -camOffsetX], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });
  const ty = interpolate(frame, [t1, t1 + animDur], [0, -camOffsetY], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });

  // Step 2  rotate — cancel camera orientation
  const rot = interpolate(frame, [t2, t2 + animDur], [0, -camInitAngle], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });

  // Step 3  scaleX flip — left-hand → view space
  const sx = interpolate(frame, [t3, t3 + fps * 0.55], [1, -1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });

  // Mirror flash during the flip
  const flash = interpolate(
    frame,
    [t3 + fps * 0.05, t3 + fps * 0.18, t3 + fps * 0.55],
    [0, 0.55, 0],
    { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' },
  );

  /* ── step highlight state ───────────────────────────── */
  const activeStep =
    frame >= t3 ? 3 : frame >= t2 ? 2 : frame >= t1 ? 1 : 0;

  const pop = (triggerFrame: number) =>
    1 +
    spring({
      frame: frame - triggerFrame,
      fps,
      config: { damping: 11, stiffness: 120 },
      durationRestThreshold: 0.001,
    }) * 0.035;

  const getCardScale = (stepNum: number) => {
    if (stepNum === activeStep && activeStep > 0) {
      const trig = stepNum === 1 ? t1 : stepNum === 2 ? t2 : t3;
      return pop(trig);
    }
    return 1;
  };

  /* ── grid helper ────────────────────────────────────── */
  const gridCount = 12;
  const cellSize = panelSize / gridCount;

  const gridLines: React.ReactNode[] = [];
  for (let i = 0; i <= gridCount; i++) {
    const offset = i * cellSize;
    gridLines.push(
      <line key={`v${i}`} x1={offset} y1={0} x2={offset} y2={panelSize} stroke={gridLine} strokeWidth={1} />,
      <line key={`h${i}`} x1={0} y1={offset} x2={panelSize} y2={offset} stroke={gridLine} strokeWidth={1} />,
    );
  }

  /* ── camera icon sub-render ─────────────────────────── */
  const camIconW = panelSize * 0.09;
  const camIconH = panelSize * 0.1;

  const camIcon = (
    <div
      style={{
        position: 'absolute',
        width: camIconW,
        height: camIconH,
        left: panelSize / 2 + camOffsetX - camIconW / 2,
        top: panelSize / 2 + camOffsetY - camIconH / 2,
        transform: `rotate(${camInitAngle}deg)`,
        transformOrigin: 'center center',
      }}
    >
      {/* body */}
      <div
        style={{
          width: '100%',
          height: '62%',
          background: '#f0f6fc',
          borderRadius: 5,
          border: '2px solid #c9d1d9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}
      >
        {/* lens dot */}
        <div
          style={{
            width: '28%',
            height: '28%',
            borderRadius: '50%',
            background: accent,
          }}
        />
      </div>
      {/* direction triangle */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: `${camIconW * 0.38}px solid transparent`,
          borderRight: `${camIconW * 0.38}px solid transparent`,
          borderTop: `${camIconH * 0.36}px solid #f0f6fc`,
          margin: '1px auto 0',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
        }}
      />
    </div>
  );

  /* ── car icon sub-render ────────────────────────────── */
  const carW = panelSize * 0.1;
  const carH = panelSize * 0.055;

  const carIcon = (
    <div
      style={{
        position: 'absolute',
        width: carW,
        height: carH,
        left: panelSize / 2 + carX - carW / 2,
        top: panelSize / 2 + carY - carH / 2,
      }}
    >
      {/* lower body */}
      <div
        style={{
          width: '100%',
          height: '55%',
          position: 'absolute',
          bottom: 0,
          background: accent,
          borderRadius: 4,
        }}
      />
      {/* upper cabin */}
      <div
        style={{
          width: '48%',
          height: '65%',
          position: 'absolute',
          top: 0,
          left: '38%',
          background: accent,
          borderRadius: '3px 3px 0 0',
          opacity: 0.7,
        }}
      />
      {/* wheel hint */}
      <div
        style={{
          position: 'absolute',
          bottom: -cellSize * 0.06,
          left: '15%',
          width: carW * 0.15,
          height: carH * 0.3,
          borderRadius: '50%',
          background: '#30363d',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -cellSize * 0.06,
          right: '15%',
          width: carW * 0.15,
          height: carH * 0.3,
          borderRadius: '50%',
          background: '#30363d',
        }}
      />
    </div>
  );

  /* ── step cards ─────────────────────────────────────── */
  const stepDefs = [
    { n: '1', text: '把世界平移，让相机到原点' },
    { n: '2', text: '把世界旋转，抵消相机朝向' },
    { n: '3', text: '翻转 Z 轴：左手系 → 观察系' },
  ];

  /* ── camera label (below origin cross) ──────────────── */
  const camTargetLabel = (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, 18px)',
        color: accent,
        fontSize: originLabelSize,
        whiteSpace: 'nowrap',
        opacity: 0.8,
        zIndex: 6,
        textAlign: 'center',
        lineHeight: 1.3,
      }}
    >
      原点
      <br />
      <span style={{ fontSize: cmLabelSize, opacity: 0.65 }}>相机目标位置</span>
    </div>
  );

  /* ══════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════ */
  return (
    <div
      style={{
        width,
        height,
        background: bg,
        position: 'relative',
        overflow: 'hidden',
        fontFamily:
          '"PingFang SC","Noto Sans SC","Microsoft YaHei","Helvetica Neue",sans-serif',
      }}
    >
      {/* ── Left: World panel ──────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: panelLeft,
          top: panelTop,
          width: panelSize,
          height: panelSize,
          border: `1px solid ${border}`,
          borderRadius: 10,
          overflow: 'hidden',
          opacity: worldOpacity,
          background: bg,
          boxShadow: '0 0 40px rgba(88,166,255,0.06)',
        }}
      >
        {/* --- fixed origin cross (above world group) --- */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: panelSize * 0.06,
            height: panelSize * 0.06,
            transform: 'translate(-50%, -50%)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              width: '100%',
              height: 2,
              background: accent,
              transform: 'translateY(-50%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              width: 2,
              height: '100%',
              background: accent,
              transform: 'translateX(-50%)',
            }}
          />
          {/* small accent dot at center */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: accent,
              transform: 'translate(-50%, -50%)',
              boxShadow: `0 0 12px ${accent}`,
            }}
          />
        </div>

        {/* --- origin label --- */}
        {camTargetLabel}

        {/* --- transform group (grid + car + camera) --- */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: panelSize,
            height: panelSize,
            marginLeft: -panelSize / 2,
            marginTop: -panelSize / 2,
            transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scaleX(${sx})`,
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          {/* grid */}
          <svg
            width={panelSize}
            height={panelSize}
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            {gridLines}
          </svg>

          {/* car */}
          {carIcon}

          {/* camera */}
          {camIcon}
        </div>

        {/* --- mirror flash overlay --- */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse at center, ${accent}44 0%, transparent 70%)`,
            opacity: flash,
            pointerEvents: 'none',
            zIndex: 8,
          }}
        />
      </div>

      {/* ── Right: Step cards ──────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: rightLeft,
          top: rightTop,
          width: rightW,
          display: 'flex',
          flexDirection: 'column',
          gap: cardGap,
        }}
      >
        {stepDefs.map((step, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === activeStep;
          const cardScale = getCardScale(stepNum);

          const leftBorderColor = isActive ? accent : border;
          const leftBorderW = isActive ? 4 : 1;
          const textColor = isActive ? '#ffffff' : dimText;
          const numOpacity = isActive ? 1 : 0.5;
          const glow = isActive
            ? `inset 0 0 30px ${accent}15, 0 0 20px ${accent}08`
            : 'none';

          return (
            <div
              key={stepNum}
              style={{
                height: cardH,
                background: cardBg,
                borderRadius: 8,
                borderLeft: `${leftBorderW}px solid ${leftBorderColor}`,
                display: 'flex',
                alignItems: 'center',
                paddingLeft: rightW * 0.06,
                paddingRight: rightW * 0.04,
                transform: `scale(${cardScale})`,
                transformOrigin: 'left center',
                boxShadow: glow,
                transition: 'box-shadow 0.4s ease',
              }}
            >
              {/* step number badge */}
              <div
                style={{
                  width: cardH * 0.36,
                  height: cardH * 0.36,
                  borderRadius: '50%',
                  border: `2px solid ${isActive ? accent : border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: rightW * 0.04,
                  flexShrink: 0,
                  opacity: numOpacity,
                  color: isActive ? accent : dimText,
                  fontSize: stepNumSize,
                  fontWeight: 700,
                }}
              >
                {step.n}
              </div>

              {/* text */}
              <span
                style={{
                  fontSize: cardFontSize,
                  color: textColor,
                  lineHeight: 1.45,
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {step.text}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Bottom caption hint ────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: safeBot * 0.25,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: height * 0.02,
          color: dimText,
          opacity: interpolate(frame, [fps * 0.8, fps * 1.5], [0, 0.7], {
            extrapolateRight: 'clamp',
            extrapolateLeft: 'clamp',
          }),
          pointerEvents: 'none',
        }}
      >
        视图变换 · 世界空间 → 观察空间
      </div>
    </div>
  );
};

export default ViewTransformDemo;
