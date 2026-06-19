import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

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

const KW = "#ff7b72";
const STR = "#a5d6ff";
const COM = "#8b949e";
const FG = "#e6edf3";
const PANEL = "#161b22";
const BLUE = "#58a6ff";
const RED = "#ff5c5c";

const SyncBlockingSlide: React.FC<AnimationProps> = (props) => {
  const { width, height, subtitleSafeBottom, fps } = props;
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const f = frame;
  const FPS = fps || cfg.fps || 30;

  const availH = height - subtitleSafeBottom;
  const margin = Math.min(width, height) * 0.06;

  // ---- timeline (seconds -> frames) ----
  const tStart = 0.4 * FPS; // thread begins moving
  const tFreeze = tStart + 1.5 * FPS; // hits Download, freezes
  const tThaw = tFreeze + 2.5 * FPS; // freeze of ~3s, resumes ~4s mark
  const tEnd = tThaw + 2.0 * FPS;

  const phaseFrozen = f >= tFreeze && f < tThaw;
  const phaseAfter = f >= tThaw;

  // ---- layout ----
  const titleSize = height * 0.052;
  const codeFont = height * 0.030;
  const labelFont = height * 0.028;

  const contentTop = margin + titleSize * 2.0;
  const contentH = availH - contentTop - margin;

  const codeW = width * 0.55;
  const codeX = margin;
  const codeH = Math.min(contentH * 0.78, codeFont * 1.9 * 5 + 80);
  const codeY = contentTop + (contentH - codeH) / 2;

  const lineH = codeFont * 1.9;
  const codePadX = codeFont * 1.2;
  const codePadTop = codeFont * 2.6;

  // timeline column
  const tlX = codeX + codeW + width * 0.05;
  const tlW = width - tlX - margin;
  const trackX = tlX + tlW * 0.18;
  const trackTop = codeY + codePadTop + lineH * 0.4;
  const trackBottom = codeY + codeH - lineH * 0.3;
  const trackLen = trackBottom - trackTop;

  // y position of the client.Download line (line index 1, 0-based) inside code
  const downloadLineY =
    codeY + codePadTop + lineH * 1 + codeFont * 0.7;
  // fraction along track where freeze happens
  const freezeFrac = (downloadLineY - trackTop) / trackLen;
  const freezeFracClamped = Math.max(0.18, Math.min(0.55, freezeFrac));

  // progress fraction along the track
  let progress = 0;
  if (f < tStart) {
    progress = 0;
  } else if (f < tFreeze) {
    progress = interpolate(f, [tStart, tFreeze], [0, freezeFracClamped], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.linear,
    });
  } else if (f < tThaw) {
    progress = freezeFracClamped;
  } else {
    progress = interpolate(f, [tThaw, tEnd], [freezeFracClamped, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  }

  const barColor = phaseFrozen ? RED : BLUE;
  const barGlow = phaseFrozen
    ? "0 0 24px rgba(255,92,92,0.8)"
    : "0 0 18px rgba(88,166,255,0.6)";

  // snowflake pulse
  const pulse =
    0.6 + 0.4 * Math.sin((f / FPS) * Math.PI * 2.2);

  // title fade-in
  const titleOp = interpolate(f, [0, 0.5 * FPS], [0, 1], {
    extrapolateRight: "clamp",
  });

  // code highlight on download line during freeze
  const dlHighlight = phaseFrozen ? 0.18 + 0.12 * pulse : 0;

  // label text + color
  let labelText = "调用线程";
  let labelColor = BLUE;
  if (phaseFrozen) {
    labelText = "❄ 冻结 3 秒";
    labelColor = RED;
  } else if (phaseAfter) {
    labelText = "线程白白等了 3 秒";
    labelColor = "#f0a868";
  }

  // marker dot y
  const dotY = trackTop + trackLen * progress;

  // background subtle grid
  const gridCount = 14;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1117", fontFamily: props.theme.fonts.sans }}>
      {/* background grid */}
      <AbsoluteFill style={{ opacity: 0.05 }}>
        {Array.from({ length: gridCount }).map((_, i) => (
          <div
            key={"v" + i}
            style={{
              position: "absolute",
              left: (width / gridCount) * i,
              top: 0,
              width: 1,
              height: availH,
              backgroundColor: "#ffffff",
            }}
          />
        ))}
      </AbsoluteFill>

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: margin * 0.6,
          left: 0,
          width: width,
          textAlign: "center",
          color: FG,
          fontSize: titleSize,
          fontWeight: 800,
          opacity: titleOp,
          letterSpacing: 1,
        }}
      >
        同步：一行卡住，全线等待
      </div>

      {/* Code window */}
      <div
        style={{
          position: "absolute",
          left: codeX,
          top: codeY,
          width: codeW,
          height: codeH,
          backgroundColor: PANEL,
          borderRadius: 16,
          border: "1px solid #30363d",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* window chrome */}
        <div
          style={{
            position: "absolute",
            top: codeFont * 0.9,
            left: codePadX,
            display: "flex",
            gap: codeFont * 0.5,
          }}
        >
          {["#ff5f56", "#ffbd2e", "#27c93f"].map((c) => (
            <div
              key={c}
              style={{
                width: codeFont * 0.55,
                height: codeFont * 0.55,
                borderRadius: "50%",
                backgroundColor: c,
              }}
            />
          ))}
        </div>

        {/* highlight band over download line during freeze */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: codePadTop + lineH * 1 - lineH * 0.25,
            width: codeW,
            height: lineH,
            backgroundColor: `rgba(255,92,92,${dlHighlight})`,
            borderLeft: phaseFrozen ? `4px solid ${RED}` : "4px solid transparent",
          }}
        />

        {/* code lines */}
        <div
          style={{
            position: "absolute",
            left: codePadX,
            top: codePadTop,
            fontFamily: props.theme.fonts.mono,
            fontSize: codeFont,
            lineHeight: `${lineH}px`,
            whiteSpace: "pre",
          }}
        >
          <div>
            <span style={{ color: KW }}>string</span>
            <span style={{ color: FG }}> DownloadData() {"{"}</span>
          </div>
          <div>
            <span style={{ color: FG }}>{"    var data = client.Download("}</span>
            <span style={{ color: STR }}>url</span>
            <span style={{ color: FG }}>{"); "}</span>
            <span style={{ color: COM }}>// 阻塞 3 秒</span>
          </div>
          <div>
            <span style={{ color: KW }}>{"    return"}</span>
            <span style={{ color: FG }}> Parse(data);</span>
          </div>
          <div>
            <span style={{ color: FG }}>{"}"}</span>
          </div>
        </div>
      </div>

      {/* Thread timeline */}
      {/* header */}
      <div
        style={{
          position: "absolute",
          left: tlX,
          top: codeY - labelFont * 1.6,
          width: tlW,
          color: BLUE,
          fontSize: labelFont * 0.95,
          fontWeight: 700,
        }}
      >
        线程时间轴
      </div>

      {/* [0s] marker */}
      <div
        style={{
          position: "absolute",
          left: tlX,
          top: trackTop - labelFont * 0.6,
          color: COM,
          fontSize: labelFont * 0.8,
          fontFamily: props.theme.fonts.mono,
        }}
      >
        [0s]
      </div>

      {/* track background */}
      <div
        style={{
          position: "absolute",
          left: trackX,
          top: trackTop,
          width: 10,
          height: trackLen,
          backgroundColor: "#21262d",
          borderRadius: 6,
        }}
      />

      {/* progress fill */}
      <div
        style={{
          position: "absolute",
          left: trackX,
          top: trackTop,
          width: 10,
          height: trackLen * progress,
          backgroundColor: barColor,
          borderRadius: 6,
          boxShadow: barGlow,
        }}
      />

      {/* leading dot */}
      <div
        style={{
          position: "absolute",
          left: trackX - 7,
          top: dotY - 12,
          width: 24,
          height: 24,
          borderRadius: "50%",
          backgroundColor: barColor,
          boxShadow: barGlow,
          opacity: f < tStart ? 0 : 1,
        }}
      />

      {/* freeze connector line to code download line */}
      {phaseFrozen && (
        <div
          style={{
            position: "absolute",
            left: codeX + codeW,
            top: dotY,
            width: trackX - (codeX + codeW),
            height: 2,
            backgroundColor: `rgba(255,92,92,${0.5 + 0.4 * pulse})`,
          }}
        />
      )}

      {/* dynamic label next to dot */}
      <div
        style={{
          position: "absolute",
          left: trackX + 26,
          top: dotY - labelFont * 0.7,
          width: width - (trackX + 26) - margin * 0.5,
          color: labelColor,
          fontSize: labelFont,
          fontWeight: 700,
          textShadow: phaseFrozen ? "0 0 16px rgba(255,92,92,0.6)" : "none",
          opacity: f < tStart ? 0 : 1,
          transform: phaseFrozen ? `scale(${0.96 + 0.06 * pulse})` : "scale(1)",
          transformOrigin: "left center",
        }}
      >
        {labelText}
      </div>

      {/* timestamp annotations along the track */}
      <div
        style={{
          position: "absolute",
          left: trackX + 26,
          top: trackTop + trackLen * freezeFracClamped - labelFont * 1.9,
          color: COM,
          fontSize: labelFont * 0.72,
          fontFamily: props.theme.fonts.mono,
        }}
      >
        [1.5s] client.Download
      </div>
      <div
        style={{
          position: "absolute",
          left: trackX + 26,
          top: trackBottom - labelFont * 1.2,
          color: phaseAfter ? "#f0a868" : COM,
          fontSize: labelFont * 0.72,
          fontFamily: props.theme.fonts.mono,
        }}
      >
        [4s] 恢复执行
      </div>
    </AbsoluteFill>
  );
};

export default SyncBlockingSlide;
