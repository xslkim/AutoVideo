import React from "react";

export default function Component({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width,
        height,
        backgroundColor: "#16213e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontSize: 48,
      }}
    >
      Block B02
    </div>
  );
}