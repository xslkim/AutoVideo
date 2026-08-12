import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, Easing } from "remotion";

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
  lineTimings: { startSec: number; endSec: number }[];
}

const Arrow: React.FC<{
  lit: number;
  flow: number;
  boxH: number;
  sw: number;
  accent: string;
}> = ({ lit, flow, boxH, sw, accent }) => {
  const w = boxH * 0.55;
  return (
    <svg
      width={w}
      height={boxH}
      viewBox={`0 0 ${w} ${boxH}`}
      style={{ overflow: "visible", display: "block" }}
    >
      <line
        x1={w / 2}
        y1={0}
        x2={w / 2}
        y2={boxH * 0.72}
        stroke={accent}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.22 + 0.63 * lit}
      />
      <path
        d={`M ${w / 2} ${boxH} L ${w / 2 - boxH * 0.2} ${boxH * 0.66} L ${w / 2 + boxH * 0.2} ${boxH * 0.66} Z`}
        fill={accent}
        opacity={0.3 + 0.65 * lit}
      />
      <circle
        cx={w / 2}
        cy={flow * boxH * 0.66}
        r={sw * 1.9}
        fill={accent}
        opacity={lit}
      />
    </svg>
  );
};

const Card: React.FC<{
  opacity: number;
  enterP: number;
  height: number;
  border: string;
  bg: string;
  accent: boolean;
  accentIntensity: number;
  accentColor: string;
  children: React.ReactNode;
}> = ({
  opacity,
  enterP,
  height,
  border,
  bg,
  accent,
  accentIntensity,
  accentColor,
  children,
}) => {
  const borderColor = accent ? accentColor : border;
  return (
    <div
      style={{
        width: "100%",
        height,
        opacity,
        transform: `translateY(${(1 - enterP) * 24}px)`,
        borderRadius: 12,
        background: bg,
        border: `1px solid ${borderColor}`,
        boxShadow: accent
          ? `0 0 ${8 + 18 * accentIntensity}px rgba(88,166,255,${0.18 + 0.32 * accentIntensity})`
          : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
};

const SubCard: React.FC<{
  title: string;
  sub: string;
  accent: boolean;
  emphasis: number;
  accentColor: string;
  borderColor: string;
  bg: string;
  fg: string;
  muted: string;
  titleSize: number;
  subSize: number;
  font: string;
}> = ({
  title,
  sub,
  accent,
  emphasis,
  accentColor,
  borderColor,
  bg,
  fg,
  muted,
  titleSize,
  subSize,
  font,
}) => {
  const border = accent ? accentColor : borderColor;
  const glow = 0.12 + emphasis * 0.5;
  return (
    <div
      style={{
        flex: 1,
        borderRadius: 12,
        background: bg,
        border: `1.5px solid ${border}`,
        boxShadow:
          emphasis > 0.05
            ? `0 0 ${10 + 26 * emphasis}px rgba(88,166,255,${glow})`
            : "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: titleSize * 0.3,
        padding: titleSize * 0.4,
        boxSizing: "border-box",
        transform: `scale(${1 + emphasis * 0.025})`,
      }}
    >
      <div
        style={{
          fontFamily: font,
          fontSize: titleSize,
          fontWeight: 700,
          color: accent ? accentColor : fg,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: font,
          fontSize: subSize,
          color: muted,
          textAlign: "center",
        }}
      >
        {sub}
      </div>
    </div>
  );
};

const LLMProbabilityProgram: React.FC<AnimationProps> = (props) => {
  const {
    width,
    height,
    subtitleSafeBottom,
    theme,
    fps,
    lineTimings,
    durationInFrames,
  } = props;
  const frame = useCurrentFrame();
  const t = frame / fps;

  const c = theme.colors;
  const cardBg = "#161b22";
  const cardBorder = "#30363d";
  const availH = height - subtitleSafeBottom;

  // ---- entrance helpers ----
  const enter = (delay: number, dur = 14) =>
    interpolate(frame - delay, [0, dur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

  const springIn = (delay: number) =>
    spring({
      frame: frame - delay,
      fps,
      config: { damping: 200, stiffness: 140 },
    });

  // ---- timing anchors ----
  const t0 = lineTimings[0]?.startSec ?? 0.5;
  const fr = (sec: number) => Math.round(sec * fps);

  const titleDelay = fr(t0);
  const inputDelay = fr(t0 + 0.35);
  const arrow1Delay = fr(t0 + 1.05);
  const middleDelay = fr(t0 + 1.4);
  const arrow2Delay = fr(t0 + 2.45);
  const outputDelay = fr(t0 + 2.85);

  // narration-synced beats
  const twoPartsStart = lineTimings[3]?.startSec ?? 13.7;
  const attnStart = lineTimings[4]?.startSec ?? 16.82;
  const ffnStart = lineTimings[5]?.startSec ?? 21.54;
  const label27BStart = lineTimings[6]?.startSec ?? 24.5;

  const attnActive = t >= attnStart;
  const ffnActive = t >= ffnStart;

  const twoPartsPulse =
    t >= twoPartsStart && t < attnStart
      ? 0.5 + 0.5 * Math.sin((t - twoPartsStart) * 4.5)
      : 0;

  // ---- exit (last-in-first-out staggered) ----
  const TOTAL_GROUPS = 7;
  const exitDur = Math.max(12, Math.round(durationInFrames * 0.14));
  const exitStart = durationInFrames - exitDur;
  const groupExit = (idx: number) => {
    const seg = exitDur / TOTAL_GROUPS;
    const s = exitStart + idx * seg * 0.6;
    const e = s + seg;
    return interpolate(frame, [s, e], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    });
  };
  const vis = (e: number, idx: number) => e * (1 - groupExit(idx));

  // ---- sizes (scaled from canvas) ----
  const pad = Math.min(width, height) * 0.05;
  const titleSize = height * 0.075;
  const inputMain = height * 0.034;
  const subFontSize = height * 0.028;
  const subCardMain = height * 0.04;
  const badgeSize = height * 0.042;
  const badgeSub = height * 0.03;

  const diagramW = width * 0.85;
  const inputH = height * 0.108;
  const outputH = height * 0.108;
  const middleH = height * 0.32;
  const arrowBoxH = height * 0.05;
  const arrowSw = Math.max(3, height * 0.0042);

  // ---- ambient motion (runs through the hold) ----
  const pulse = (phase: number) => 0.5 + 0.5 * Math.sin(frame / 16 + phase);
  const bgDriftX = Math.sin(frame / 60) * 18;
  const bgDriftY = Math.cos(frame / 70) * 12;
  const flow = (offset: number) => (frame / 10 + offset) % 1;

  // ---- per-group progress ----
  const titleP = springIn(titleDelay);
  const titleOp = vis(enter(titleDelay), 6);
  const inputP = springIn(inputDelay);
  const inputOp = vis(enter(inputDelay), 5);
  const arrow1Lit = vis(enter(arrow1Delay, 16), 4);
  const middleP = springIn(middleDelay);
  const middleOp = vis(enter(middleDelay), 3);
  const arrow2Lit = vis(enter(arrow2Delay, 16), 2);
  const outputP = springIn(outputDelay);
  const outputOp = vis(enter(outputDelay), 1);

  const badgeEnter = enter(fr(label27BStart), 20);
  const badgeOp = badgeEnter * (1 - groupExit(0));
  const badgeX = interpolate(badgeEnter, [0, 1], [width * 0.22, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const attnEmph = attnActive ? 0.6 + 0.4 * pulse(0) : twoPartsPulse * 0.5;
  const ffnEmph = ffnActive ? 0.6 + 0.4 * pulse(2) : twoPartsPulse * 0.5;

  return (
    <AbsoluteFill style={{ backgroundColor: c.bg, overflow: "hidden" }}>
      {/* drifting ambient glow */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle at ${(50 + (bgDriftX / width) * 100).toFixed(2)}% ${(38 + (bgDriftY / height) * 100).toFixed(2)}%, rgba(88,166,255,0.10), transparent 55%)`,
        }}
      />
      {/* faint structural grid */}
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage: `linear-gradient(${cardBorder} 1px, transparent 1px), linear-gradient(90deg, ${cardBorder} 1px, transparent 1px)`,
          backgroundSize: `${width / 24}px ${width / 24}px`,
        }}
      />

      {/* content root (clamped above subtitle band) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height: availH,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: pad,
          paddingLeft: pad,
          paddingRight: pad,
          boxSizing: "border-box",
        }}
      >
        {/* title */}
        <div
          style={{
            opacity: titleOp,
            transform: `translateY(${(1 - titleP) * -22}px)`,
            marginBottom: height * 0.035,
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.022,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: titleSize,
              fontWeight: 800,
              color: c.fg,
              letterSpacing: "-0.01em",
            }}
          >
            大模型
          </span>
          <span
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: titleSize * 0.7,
              fontWeight: 500,
              color: c.muted,
            }}
          >
            =
          </span>
          <span
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: titleSize,
              fontWeight: 800,
              color: c.accent,
              textShadow: "0 0 24px rgba(88,166,255,0.35)",
            }}
          >
            概率程序
          </span>
        </div>

        {/* architecture diagram */}
        <div
          style={{
            width: diagramW,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: height * 0.012,
          }}
        >
          {/* input layer */}
          <Card
            opacity={inputOp}
            enterP={inputP}
            height={inputH}
            border={cardBorder}
            bg={cardBg}
            accent={false}
            accentIntensity={0}
            accentColor={c.accent}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: inputMain,
                  fontWeight: 700,
                  color: c.fg,
                }}
              >
                词嵌入 Embedding
              </div>
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: subFontSize,
                  color: c.muted,
                  marginTop: height * 0.006,
                }}
              >
                文本 → token → 向量
              </div>
            </div>
          </Card>

          <Arrow
            lit={arrow1Lit}
            flow={flow(0)}
            boxH={arrowBoxH}
            sw={arrowSw}
            accent={c.accent}
          />

          {/* transformer middle layer */}
          <div
            style={{
              width: "100%",
              height: middleH,
              opacity: middleOp,
              transform: `translateY(${(1 - middleP) * 24}px) scale(${0.96 + 0.04 * middleP})`,
              borderRadius: 16,
              background: "rgba(22,27,34,0.55)",
              border: `1px solid ${cardBorder}`,
              padding: height * 0.022,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: height * 0.014,
            }}
          >
            <div
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: inputMain,
                fontWeight: 700,
                color: c.fg,
                textAlign: "center",
              }}
            >
              Transformer 块{" "}
              <span style={{ color: c.muted, fontWeight: 500 }}>
                × 数十层
              </span>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                gap: height * 0.022,
                alignItems: "stretch",
              }}
            >
              <SubCard
                title="自注意力"
                sub="每个词看到全句上下文"
                accent
                emphasis={attnEmph}
                accentColor={c.accent}
                borderColor={cardBorder}
                bg={cardBg}
                fg={c.fg}
                muted={c.muted}
                titleSize={subCardMain}
                subSize={subFontSize}
                font={theme.fonts.sans}
              />
              <SubCard
                title="前馈网络"
                sub="负责计算与推理"
                accent={false}
                emphasis={ffnEmph}
                accentColor={c.accent}
                borderColor={cardBorder}
                bg={cardBg}
                fg={c.fg}
                muted={c.muted}
                titleSize={subCardMain}
                subSize={subFontSize}
                font={theme.fonts.sans}
              />
            </div>
          </div>

          <Arrow
            lit={arrow2Lit}
            flow={flow(0.5)}
            boxH={arrowBoxH}
            sw={arrowSw}
            accent={c.accent}
          />

          {/* output layer */}
          <Card
            opacity={outputOp}
            enterP={outputP}
            height={outputH}
            border={cardBorder}
            bg={cardBg}
            accent
            accentIntensity={0.45 + 0.3 * pulse(4)}
            accentColor={c.accent}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: inputMain,
                  fontWeight: 700,
                  color: c.fg,
                }}
              >
                输出层
              </div>
              <div
                style={{
                  fontFamily: theme.fonts.sans,
                  fontSize: subFontSize,
                  color: c.muted,
                  marginTop: height * 0.006,
                }}
              >
                下一个词的概率分布
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 27B floating callout — slides in from the right */}
      <div
        style={{
          position: "absolute",
          right: width * 0.045,
          top: availH * 0.52,
          opacity: badgeOp,
          transform: `translateX(${badgeX}px)`,
          zIndex: 20,
        }}
      >
        <div
          style={{
            background: cardBg,
            border: `2px solid ${c.accent}`,
            borderRadius: 16,
            padding: `${height * 0.02}px ${width * 0.024}px`,
            boxShadow: `0 0 ${22 + 14 * pulse(6)}px rgba(88,166,255,${0.35 + 0.2 * pulse(6)})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: height * 0.006,
          }}
        >
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: badgeSize,
              fontWeight: 800,
              color: c.accent,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            27B = 270 亿个参数
          </div>
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: badgeSub,
              color: c.muted,
              whiteSpace: "nowrap",
            }}
          >
            权重矩阵 = 参数
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default LLMProbabilityProgram;
