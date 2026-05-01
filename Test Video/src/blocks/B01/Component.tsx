import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

interface AnimationProps {
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
  subtitleSafeBottom: number;
  theme: {
    name: string;
    colors: {
      bg: string;
      fg: string;
      accent: string;
      muted: string;
    };
    fonts: { sans: string; mono: string };
  };
  fps: number;
}

const Component: React.FC<AnimationProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
}) => {
  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.bg,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        paddingBottom: subtitleSafeBottom,
      }}
    >
      <div
        style={{
          opacity,
          color: theme.colors.fg,
          fontSize: width * 0.06,
          fontFamily: theme.fonts.sans,
          fontWeight: "bold",
          textAlign: "center",
        }}
      >
        Hello World
      </div>
    </AbsoluteFill>
  );
};

export default Component;