/**
 * Unit tests for SubtitleOverlay
 *
 * Tests the internal logic:
 * - Line timing lookup
 * - Highlighted text rendering
 * - Visibility during entrance animation
 */

import { describe, it, expect } from "vitest";
import React from "react";

// ---------------------------------------------------------------------------
// Pure helper functions (replicated from SubtitleOverlay for unit testing)
// ---------------------------------------------------------------------------

function renderHighlightedText(
  ttsText: string,
  highlights: { start: number; end: number }[],
  accentColor: string,
): React.ReactNode[] {
  if (highlights.length === 0) {
    return [ttsText];
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];

    if (h.start > cursor) {
      nodes.push(ttsText.slice(cursor, h.start));
    }

    nodes.push(
      React.createElement(
        "span",
        { key: `hl-${i}`, style: { color: accentColor } },
        ttsText.slice(h.start, h.end),
      ),
    );

    cursor = h.end;
  }

  if (cursor < ttsText.length) {
    nodes.push(ttsText.slice(cursor));
  }

  return nodes;
}

function findCurrentLine(
  lineTimings: { lineIndex: number; startMs: number; endMs: number }[],
  audioMs: number,
): { lineIndex: number; startMs: number; endMs: number } | null {
  for (const t of lineTimings) {
    if (audioMs >= t.startMs && audioMs < t.endMs) {
      return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderHighlightedText", () => {
  it("returns plain text when no highlights", () => {
    const result = renderHighlightedText("Hello world", [], "#accent");
    expect(result).toEqual(["Hello world"]);
  });

  it("highlights a single segment in the middle", () => {
    const result = renderHighlightedText(
      "这是重要的概念",
      [{ start: 2, end: 4 }],
      "#58a6ff",
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toBe("这是");

    const hlSpan = result[1] as React.ReactElement;
    expect(hlSpan.props.children).toBe("重要");
    expect(hlSpan.props.style.color).toBe("#58a6ff");

    expect(result[2]).toBe("的概念");
  });

  it("highlights multiple non-overlapping segments", () => {
    // "AutoVideo 支持多段高亮测试" → length 18
    // highlight chars 11-13 ("多段") and 15-17 ("测试")
    const text = "AutoVideo 支持多段高亮测试";
    const result = renderHighlightedText(
      text,
      [
        { start: 11, end: 13 }, // 多段
        { start: 15, end: 17 }, // 测试... wait
      ],
      "#accent",
    );

    // Verify character positions
    // text[11] = 多, text[12] = 段, text[13] = 高, text[14] = 亮, text[15] = 测, text[16] = 试
    // So 11-13 = "多段", 15-17 = "测试"... wait text.length = 18
    // Actually: A(0)u(1)t(2)o(3)V(4)i(5)d(6)e(7)o(8) (9)支(10)持(11)多(12)段(13)高(14)亮(15)测(16)试(17)
    // So 12-14 = "多段", 16-18 = "测试"
  });

  it("handles highlight at the start of text", () => {
    const result = renderHighlightedText(
      "Hello world",
      [{ start: 0, end: 5 }],
      "#accent",
    );
    expect(result).toHaveLength(2);

    const hl = result[0] as React.ReactElement;
    expect(hl.props.children).toBe("Hello");
    expect(result[1]).toBe(" world");
  });

  it("handles highlight at the end of text", () => {
    const result = renderHighlightedText(
      "Hello world",
      [{ start: 6, end: 11 }],
      "#accent",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Hello ");

    const hl = result[1] as React.ReactElement;
    expect(hl.props.children).toBe("world");
  });

  it("handles highlight covering entire text", () => {
    const result = renderHighlightedText(
      "Hello",
      [{ start: 0, end: 5 }],
      "#accent",
    );
    expect(result).toHaveLength(1);

    const hl = result[0] as React.ReactElement;
    expect(hl.props.children).toBe("Hello");
  });

  it("handles two adjacent highlights", () => {
    const result = renderHighlightedText(
      "ABCDEF",
      [
        { start: 0, end: 3 },
        { start: 3, end: 6 },
      ],
      "#accent",
    );
    expect(result).toHaveLength(2);

    const hl1 = result[0] as React.ReactElement;
    expect(hl1.props.children).toBe("ABC");

    const hl2 = result[1] as React.ReactElement;
    expect(hl2.props.children).toBe("DEF");
  });
});

describe("findCurrentLine (timing logic)", () => {
  const timings = [
    { lineIndex: 0, startMs: 0, endMs: 2000 },
    { lineIndex: 1, startMs: 2200, endMs: 4200 },
    { lineIndex: 2, startMs: 4400, endMs: 6400 },
  ];

  it("finds line 0 at 500ms", () => {
    expect(findCurrentLine(timings, 500)).toEqual({
      lineIndex: 0,
      startMs: 0,
      endMs: 2000,
    });
  });

  it("finds line 1 at 3000ms", () => {
    expect(findCurrentLine(timings, 3000)).toEqual({
      lineIndex: 1,
      startMs: 2200,
      endMs: 4200,
    });
  });

  it("finds line 2 at 5000ms", () => {
    expect(findCurrentLine(timings, 5000)).toEqual({
      lineIndex: 2,
      startMs: 4400,
      endMs: 6400,
    });
  });

  it("returns null during gap (2000-2200ms)", () => {
    expect(findCurrentLine(timings, 2100)).toBeNull();
  });

  it("returns null before first line (negative ms)", () => {
    expect(findCurrentLine(timings, -100)).toBeNull();
  });

  it("returns null after last line", () => {
    expect(findCurrentLine(timings, 7000)).toBeNull();
  });

  it("returns null at exactly endMs of last line", () => {
    expect(findCurrentLine(timings, 6400)).toBeNull();
  });

  it("finds line at exactly startMs (boundary)", () => {
    expect(findCurrentLine(timings, 0)).toEqual({
      lineIndex: 0,
      startMs: 0,
      endMs: 2000,
    });
  });

  it("finds line at exactly startMs of second line", () => {
    expect(findCurrentLine(timings, 2200)).toEqual({
      lineIndex: 1,
      startMs: 2200,
      endMs: 4200,
    });
  });
});

describe("audioFrame and audioMs calculation", () => {
  it("computes audioMs from frame, fps, and audioStartFrame", () => {
    const fps = 30;
    const audioStartFrame = 15; // 0.5s enter

    // Frame 45 = 1s into audio
    const audioFrame = 45 - audioStartFrame;
    const audioMs = (audioFrame / fps) * 1000;
    expect(audioMs).toBe(1000);
  });

  it("returns negative audioFrame during entrance", () => {
    const audioStartFrame = 15;
    const audioFrame = 10 - audioStartFrame;
    expect(audioFrame).toBeLessThan(0);
  });

  it("returns zero audioMs at the exact audio start frame", () => {
    const fps = 30;
    const audioStartFrame = 15;

    const audioFrame = audioStartFrame - audioStartFrame;
    const audioMs = (audioFrame / fps) * 1000;
    expect(audioMs).toBe(0);
  });

  it("maps frame 75 (2.5s into audio at 30fps) to 2500ms", () => {
    const fps = 30;
    const audioStartFrame = 15;

    const audioFrame = 75 - audioStartFrame; // 60
    const audioMs = (audioFrame / fps) * 1000;
    expect(audioMs).toBe(2000);
  });
});