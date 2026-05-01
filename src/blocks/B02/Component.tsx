import React from "react";
import { AbsoluteFill, Img, useCurrentFrame, interpolate } from "remotion";
import { staticFile } from "remotion";

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
  const scale = interpolate(frame, [0, fps * 0.3], [0.8, 1], {
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
      <div style={{ transform: `scale(${scale})` }}>
        <Img
          src={staticFile("assets/90c144a4.png")}
          style={{
            maxWidth: width * 0.7,
            maxHeight: (height - subtitleSafeBottom) * 0.7,
            objectFit: "contain",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export default Component;