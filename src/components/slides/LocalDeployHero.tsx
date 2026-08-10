import React from "react";
import { interpolate, spring, Easing, AbsoluteFill } from "remotion";

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
}

const LocalDeployHero: React.FC<AnimationProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}) => {
  const c = theme.colors;
  const fonts = theme.fonts;

  // --- geometry ---
  const pad = Math.min(width, height) * 0.045;
  const subZone = subtitleSafeBottom > 0 ? subtitleSafeBottom : pad;

  const t = (s: number) => Math.round(s * fps);

  // --- entrance helpers (staggered) ---
  const fade = (startSec: number, dur = 14) =>
    interpolate(frame - t(startSec), [0, dur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  const up = (p: number, dist: number) => interpolate(p, [0, 1], [dist, 0]);

  // --- exit (whole group, eased) ---
  const exitStart =
    durationInFrames - Math.max(10, Math.round(durationInFrames * 0.15));
  const exitFade = interpolate(
    frame,
    [exitStart, durationInFrames - 1],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    }
  );
  const exitScale = interpolate(
    frame,
    [exitStart, durationInFrames - 1],
    [1, 0.985],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    }
  );

  // --- per-element entrances ---
  const labelP = fade(0);
  const epP = fade(0.4);

  const titleDelay = t(0.8);
  const titleSpring = spring({
    frame: frame - titleDelay,
    fps,
    config: { damping: 200, stiffness: 90, mass: 1 },
  });
  const titleY = interpolate(titleSpring, [0, 1], [60, 0]);
  const titleOp = interpolate(frame - titleDelay, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subP = fade(1.8);

  // GPU flow
  const gpuSingleP = fade(3.0);
  const gpuArrowP = fade(3.2);
  const gpuClusterP = fade(3.4);

  // Reason cards (supporting content for the subtitle)
  const reasonBase = 3.3;
  const reasonCards = [
    { n: "01", title: "隐私优先", sub: "数据不离本地" },
    { n: "02", title: "零成本运行", sub: "部署一次 长期免费" },
    { n: "03", title: "完全可控", sub: "可微调 可定制" },
  ];

  // Terminal (bottom-right) — slides in, then shrinks/fades out
  const termIn = interpolate(frame - t(4.5), [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const termOut = interpolate(frame - t(6.5), [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const termOpacity = termIn * (1 - termOut);
  const termScale =
    interpolate(termIn, [0, 1], [0.85, 1]) *
    interpolate(termOut, [0, 1], [1, 0.82]);
  const termX =
    interpolate(termIn, [0, 1], [120, 0]) +
    interpolate(termOut, [0, 1], [0, 90]);

  // Stat badge takes the terminal's slot after it leaves (keeps footer full)
  const statP = fade(6.5);

  // Hint bar
  const hintP = fade(6.5);

  // --- ambient motion (keeps frame alive during hold) ---
  const drift = Math.sin(frame / 55) * 30;
  const cursorOn = Math.floor(frame / 15) % 2 === 0;
  const arrowProg = (frame % 42) / 42;
  const singlePulse = 0.5 + ((Math.sin(frame / 16) + 1) / 2) * 0.5;
  const dotPulse = 0.5 + ((Math.sin(frame / 12) + 1) / 2) * 0.5;
  const scanY = (frame % 120) / 120;

  // --- font sizes (all computed from height, ≥ height*0.028 floor) ---
  const labelFs = height * 0.032;
  const epSmall = height * 0.028;
  const epNum = height * 0.05;
  const titleFs = Math.min(height * 0.125, width * 0.115);
  const subFs = height * 0.04;
  const gpuLabelFs = height * 0.034;
  const arrowGlyphFs = height * 0.07;
  const cardIdxFs = height * 0.028;
  const cardTitleFs = height * 0.04;
  const cardSubFs = height * 0.028;
  const termFs = height * 0.029;
  const termTitleFs = height * 0.028;
  const statBigFs = height * 0.06;
  const statUnitFs = height * 0.029;
  const statLabelFs = height * 0.028;
  const hintFs = height * 0.032;

  // --- GPU card geometry ---
  const singleW = width * 0.085;
  const singleH = height * 0.15;
  const clusterCardW = width * 0.05;
  const clusterCardH = height * 0.064;
  const clusterGap = width * 0.012;

  const dot = Math.round(width * 0.035);
  const bracketSize = Math.min(width, height) * 0.038;
  const bracketInset = pad * 0.4;

  const corners: React.CSSProperties[] = [
    {
      top: bracketInset,
      left: bracketInset,
      borderTop: `2px solid ${c.accent}`,
      borderLeft: `2px solid ${c.accent}`,
    },
    {
      top: bracketInset,
      right: bracketInset,
      borderTop: `2px solid ${c.accent}`,
      borderRight: `2px solid ${c.accent}`,
    },
    {
      bottom: bracketInset + subZone,
      left: bracketInset,
      borderBottom: `2px solid ${c.accent}`,
      borderLeft: `2px solid ${c.accent}`,
    },
    {
      bottom: bracketInset + subZone,
      right: bracketInset,
      borderBottom: `2px solid ${c.accent}`,
      borderRight: `2px solid ${c.accent}`,
    },
  ];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: c.bg,
        fontFamily: fonts.sans,
        overflow: "hidden",
        opacity: exitFade,
      }}
    >
      {/* dot grid background */}
      <AbsoluteFill
        style={{
          opacity: 0.5,
          backgroundImage: `radial-gradient(circle, ${c.muted}22 1.2px, transparent 1.2px)`,
          backgroundSize: `${dot}px ${dot}px`,
        }}
      />

      {/* giant faint LLM watermark */}
      <div
        style={{
          position: "absolute",
          top: "42%",
          left: "50%",
          transform: `translate(-50%, -50%) translateX(${drift * 0.3}px)`,
          fontSize: height * 0.42,
          fontWeight: 900,
          color: c.accent,
          opacity: 0.04,
          fontFamily: fonts.mono,
          letterSpacing: width * 0.02,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        LLM
      </div>

      {/* concentric rings behind title */}
      {[0.34, 0.5, 0.66].map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            width: width * r,
            height: width * r,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            border: `1px solid ${c.accent}`,
            opacity: 0.05,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* drifting radial glow */}
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: "50%",
          width: width * 0.95,
          height: width * 0.6,
          transform: `translate(-50%, -50%) translateX(${drift}px)`,
          background: `radial-gradient(ellipse, ${c.accent}1f 0%, transparent 60%)`,
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />

      {/* corner brackets */}
      {corners.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: bracketSize,
            height: bracketSize,
            opacity: 0.5,
            ...s,
          }}
        />
      ))}

      {/* ===== main content — vertical bands distribute over full canvas ===== */}
      <div
        style={{
          position: "absolute",
          top: pad,
          left: pad,
          right: pad,
          bottom: subZone + pad,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          transform: `scale(${exitScale})`,
          transformOrigin: "center center",
        }}
      >
        {/* ---------- BAND 1: header ---------- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* label badge */}
          <div
            style={{
              opacity: labelP,
              display: "flex",
              alignItems: "center",
              gap: labelFs * 0.45,
              padding: `${labelFs * 0.28}px ${labelFs * 0.85}px`,
              borderRadius: labelFs,
              border: `1px solid ${c.accent}66`,
              background: `${c.accent}14`,
              fontSize: labelFs,
              color: c.accent,
              letterSpacing: 1.5,
            }}
          >
            <span
              style={{
                width: labelFs * 0.3,
                height: labelFs * 0.3,
                borderRadius: "50%",
                background: c.accent,
                boxShadow: `0 0 ${6 + dotPulse * 12}px ${c.accent}`,
                opacity: 0.6 + dotPulse * 0.4,
              }}
            />
            本地部署 LLM 系列 · 第 1 集
          </div>

          {/* episode badge */}
          <div
            style={{
              opacity: epP,
              display: "flex",
              alignItems: "center",
              gap: epNum * 0.4,
            }}
          >
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: epSmall,
                  color: c.muted,
                  letterSpacing: 4,
                }}
              >
                EPISODE
              </div>
              <div
                style={{
                  fontSize: epNum,
                  fontWeight: 800,
                  color: c.accent,
                  fontFamily: fonts.mono,
                  lineHeight: 1,
                }}
              >
                01
              </div>
            </div>
            <div
              style={{
                width: 3,
                height: epNum * 1.5,
                background: c.accent,
                opacity: 0.5,
              }}
            />
          </div>
        </div>

        {/* ---------- BAND 2: title + subtitle ---------- */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: titleFs,
              color: c.fg,
              fontWeight: 800,
              lineHeight: 1.05,
              opacity: titleOp,
              transform: `translateY(${titleY}px)`,
              textShadow: `0 0 40px ${c.accent}33`,
            }}
          >
            本地部署大模型
          </div>
          <div
            style={{
              marginTop: height * 0.035,
              fontSize: subFs,
              color: c.muted,
              opacity: subP,
              transform: `translateY(${up(subP, 24)}px)`,
            }}
          >
            为什么每个程序员都该学会它
          </div>
        </div>

        {/* ---------- BAND 3: GPU flow (single → cluster) ---------- */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: width * 0.04,
          }}
        >
          {/* single GPU card */}
          <div
            style={{
              opacity: gpuSingleP,
              transform: `translateY(${up(gpuSingleP, 24)}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: gpuLabelFs * 0.6,
            }}
          >
            <div
              style={{
                width: singleW,
                height: singleH,
                borderRadius: 12,
                border: `1.5px solid ${c.accent}cc`,
                background: `linear-gradient(150deg, ${c.accent}26, ${c.accent}08)`,
                boxShadow: `0 0 ${12 + singlePulse * 22}px ${
                  c.accent
                }66, inset 0 0 22px ${c.accent}26`,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "14%",
                  left: "12%",
                  right: "12%",
                  height: "15%",
                  borderRadius: 4,
                  background: `${c.accent}66`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "34%",
                  left: "12%",
                  right: "12%",
                  height: "8%",
                  borderRadius: 3,
                  background: `${c.muted}66`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "52%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: singleW * 0.34,
                  height: singleW * 0.34,
                  borderRadius: "50%",
                  border: `1.5px solid ${c.accent}88`,
                  background: `radial-gradient(circle, ${c.accent}33, transparent 70%)`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: "9%",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontFamily: fonts.mono,
                  fontSize: gpuLabelFs * 0.85,
                  color: c.fg,
                  fontWeight: 700,
                  letterSpacing: 1,
                }}
              >
                GPU
              </div>
            </div>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: gpuLabelFs,
                color: c.muted,
              }}
            >
              单张显卡
            </div>
          </div>

          {/* animated arrow + big glyph */}
          <div
            style={{
              opacity: gpuArrowP,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: height * 0.012,
            }}
          >
            <div
              style={{
                position: "relative",
                width: width * 0.14,
                height: 3,
                background: `linear-gradient(to right, ${c.accent}22, ${c.accent})`,
                boxShadow: `0 0 10px ${c.accent}88`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: `${arrowProg * 100}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: c.accent,
                  boxShadow: `0 0 16px ${c.accent}`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: -2,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 0,
                  height: 0,
                  borderTop: "10px solid transparent",
                  borderBottom: "10px solid transparent",
                  borderLeft: `16px solid ${c.accent}`,
                  filter: `drop-shadow(0 0 6px ${c.accent})`,
                }}
              />
            </div>
            <div
              style={{
                fontSize: arrowGlyphFs,
                color: c.accent,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              →
            </div>
          </div>

          {/* GPU cluster */}
          <div
            style={{
              opacity: gpuClusterP,
              transform: `translateY(${up(gpuClusterP, 24)}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: gpuLabelFs * 0.6,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(3, ${clusterCardW}px)`,
                gridTemplateRows: `repeat(2, ${clusterCardH}px)`,
                gap: clusterGap,
              }}
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const cardEnt = interpolate(
                  frame - t(3.4) - i * 2,
                  [0, 10],
                  [0, 1],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.out(Easing.cubic),
                  }
                );
                const cpulse =
                  0.5 + ((Math.sin((frame + i * 7) / 14) + 1) / 2) * 0.5;
                return (
                  <div
                    key={i}
                    style={{
                      width: clusterCardW,
                      height: clusterCardH,
                      borderRadius: 7,
                      border: `1px solid ${c.accent}aa`,
                      background: `linear-gradient(150deg, ${c.accent}33, ${
                        c.accent
                      }0d)`,
                      boxShadow: `0 0 ${6 + cpulse * 14}px ${c.accent}66`,
                      opacity: cardEnt,
                    }}
                  />
                );
              })}
            </div>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: gpuLabelFs,
                color: c.muted,
              }}
            >
              大型 GPU 集群
            </div>
          </div>
        </div>

        {/* ---------- BAND 4: footer — reason cards + terminal/stat slot ---------- */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            gap: width * 0.02,
            height: height * 0.17,
          }}
        >
          {/* reason cards (left ~66%) */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "row",
              gap: width * 0.015,
            }}
          >
            {reasonCards.map((card, i) => {
              const p = fade(reasonBase + i * 0.18);
              const barProg = (((frame + i * 40) % 90) / 90);
              return (
                <div
                  key={card.n}
                  style={{
                    flex: 1,
                    opacity: p,
                    transform: `translateY(${up(p, 28)}px)`,
                    borderRadius: 14,
                    border: `1px solid ${c.muted}55`,
                    background: `linear-gradient(160deg, ${c.muted}18, transparent)`,
                    padding: `${cardTitleFs * 0.45}px ${cardTitleFs * 0.6}px`,
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: cardIdxFs,
                      color: c.accent,
                      letterSpacing: 2,
                      marginBottom: cardSubFs * 0.4,
                    }}
                  >
                    REASON {card.n}
                  </div>
                  <div
                    style={{
                      fontSize: cardTitleFs,
                      color: c.fg,
                      fontWeight: 700,
                      lineHeight: 1.1,
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontSize: cardSubFs,
                      color: c.muted,
                      marginTop: 6,
                    }}
                  >
                    {card.sub}
                  </div>
                  {/* animated accent progress bar (ambient) */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      bottom: 0,
                      height: 3,
                      width: `${barProg * 100}%`,
                      background: `linear-gradient(to right, ${c.accent}, ${c.accent}00)`,
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* right slot: terminal (4.5s–6.5s) crossfades into stat badge (6.5s+) */}
          <div
            style={{
              width: width * 0.3,
              position: "relative",
            }}
          >
            {/* terminal window */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 14,
                border: `1px solid #30363d`,
                background: c.bg,
                padding: `${termFs * 0.45}px ${termFs * 0.7}px ${termFs * 0.6}px`,
                boxShadow: `0 28px 80px rgba(0,0,0,0.6), 0 0 0 1px ${c.accent}14`,
                opacity: termOpacity,
                transform: `translateX(${termX}px) scale(${termScale})`,
                transformOrigin: "bottom right",
                overflow: "hidden",
              }}
            >
              {/* title bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: termFs * 0.55,
                }}
              >
                <div style={{ display: "flex", gap: termFs * 0.26 }}>
                  <span
                    style={{
                      width: termFs * 0.42,
                      height: termFs * 0.42,
                      borderRadius: "50%",
                      background: "#ff5f56",
                    }}
                  />
                  <span
                    style={{
                      width: termFs * 0.42,
                      height: termFs * 0.42,
                      borderRadius: "50%",
                      background: "#ffbd2e",
                    }}
                  />
                  <span
                    style={{
                      width: termFs * 0.42,
                      height: termFs * 0.42,
                      borderRadius: "50%",
                      background: "#27c93f",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: termTitleFs,
                    color: c.muted,
                  }}
                >
                  bash — llama.cpp
                </span>
              </div>
              {/* lines */}
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: termFs,
                  color: c.muted,
                  lineHeight: 1.5,
                }}
              >
                <div>
                  <span style={{ color: c.accent, opacity: 0.7 }}>$</span>{" "}
                  ./llama-server
                </div>
                <div>llama-server 已启动</div>
              </div>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: termFs,
                  color: c.accent,
                  fontWeight: 700,
                  lineHeight: 1.5,
                }}
              >
                {"speed: 35.0 tokens/s"}
                <span
                  style={{ opacity: cursorOn ? 1 : 0.15, marginLeft: 3 }}
                >
                  ▋
                </span>
              </div>
              {/* scanning line (ambient) */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${scanY * 100}%`,
                  height: 2,
                  background: `linear-gradient(to right, transparent, ${c.accent}55, transparent)`,
                  opacity: 0.5,
                }}
              />
            </div>

            {/* stat badge (appears after terminal leaves) */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 14,
                border: `1px solid ${c.accent}55`,
                background: `linear-gradient(160deg, ${c.accent}1f, transparent)`,
                padding: `${statLabelFs * 0.7}px ${statLabelFs * 1.1}px`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                opacity: statP,
                transform: `translateY(${up(statP, 24)}px)`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: statLabelFs,
                  color: c.muted,
                  letterSpacing: 2,
                }}
              >
                实测吞吐 · llama.cpp
              </div>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: statBigFs,
                  fontWeight: 800,
                  color: c.accent,
                  lineHeight: 1.05,
                  marginTop: 4,
                  textShadow: `0 0 24px ${c.accent}55`,
                }}
              >
                35.0{" "}
                <span
                  style={{
                    fontSize: statUnitFs,
                    color: c.muted,
                    fontWeight: 600,
                  }}
                >
                  tokens/s
                </span>
              </div>
              {/* fill bar (ambient, tied to frame) */}
              <div
                style={{
                  marginTop: statLabelFs * 0.7,
                  height: 4,
                  borderRadius: 2,
                  background: `${c.muted}33`,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${70 + singlePulse * 25}%`,
                    background: `linear-gradient(to right, ${c.accent}, ${c.accent}66)`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ---------- BAND 5: hint bar ---------- */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            opacity: hintP,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: hintFs,
              fontSize: hintFs,
              color: c.muted,
              letterSpacing: 5,
              padding: `${hintFs * 0.3}px ${hintFs * 1.2}px`,
              borderTop: `1px solid ${c.muted}55`,
              borderBottom: `1px solid ${c.muted}55`,
            }}
          >
            <span
              style={{
                width: hintFs * 0.2,
                height: hintFs * 0.2,
                borderRadius: "50%",
                background: c.accent,
                opacity: 0.7,
              }}
            />
            本集 · 入门第一课 · 讲透原理
            <span
              style={{
                width: hintFs * 0.2,
                height: hintFs * 0.2,
                borderRadius: "50%",
                background: c.accent,
                opacity: 0.7,
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default LocalDeployHero;
