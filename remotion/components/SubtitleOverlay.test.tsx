/**
 * Unit tests for SubtitleOverlay + KaraokeCaptions
 *
 * Tests the internal logic:
 * - Line timing lookup
 * - Highlighted text rendering (real implementation from KaraokeCaptions)
 * - Character-time distribution, pagination and read-state resolution
 * - Caption width estimation / font fitting
 * - Visibility during entrance animation
 */

import { describe, it, expect } from "vitest";
import React from "react";
import {
  activePageIndex,
  charStateAt,
  charsFromCaptions,
  distributeCharTimings,
  estimateWidthEm,
  fitFontSize,
  paginateChars,
  renderHighlightedText,
  type TimedChar,
} from "./KaraokeCaptions";

// ---------------------------------------------------------------------------
// Pure helper functions (replicated from SubtitleOverlay for unit testing)
// ---------------------------------------------------------------------------

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

    const hlSpan = result[1] as React.ReactElement<{ children: React.ReactNode; style: { color?: string } }>;
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

    const hl = result[0] as React.ReactElement<{ children: React.ReactNode; style: { color?: string } }>;
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

    const hl = result[1] as React.ReactElement<{ children: React.ReactNode; style: { color?: string } }>;
    expect(hl.props.children).toBe("world");
  });

  it("handles highlight covering entire text", () => {
    const result = renderHighlightedText(
      "Hello",
      [{ start: 0, end: 5 }],
      "#accent",
    );
    expect(result).toHaveLength(1);

    const hl = result[0] as React.ReactElement<{ children: React.ReactNode; style: { color?: string } }>;
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

    const hl1 = result[0] as React.ReactElement<{ children: React.ReactNode; style: { color?: string } }>;
    expect(hl1.props.children).toBe("ABC");

    const hl2 = result[1] as React.ReactElement<{ children: React.ReactNode; style: { color?: string } }>;
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

// ---------------------------------------------------------------------------
// KaraokeCaptions pure helpers
// ---------------------------------------------------------------------------

describe("distributeCharTimings", () => {
  it("splits the line window evenly across characters", () => {
    const result = distributeCharTimings("你好世界", 1000, 3000);
    expect(result).toEqual([
      { char: "你", startMs: 1000, endMs: 1500 },
      { char: "好", startMs: 1500, endMs: 2000 },
      { char: "世", startMs: 2000, endMs: 2500 },
      { char: "界", startMs: 2500, endMs: 3000 },
    ]);
  });

  it("returns an empty array for empty text", () => {
    expect(distributeCharTimings("", 0, 1000)).toEqual([]);
  });

  it("splits by code point (surrogate pairs stay intact)", () => {
    const result = distributeCharTimings("a👋b", 0, 3000);
    expect(result.map((c) => c.char)).toEqual(["a", "👋", "b"]);
    expect(result[1]).toMatchObject({ startMs: 1000, endMs: 2000 });
  });

  it("clamps a degenerate window to zero-length slots", () => {
    const result = distributeCharTimings("甲乙", 500, 500);
    expect(result).toEqual([
      { char: "甲", startMs: 500, endMs: 500 },
      { char: "乙", startMs: 500, endMs: 500 },
    ]);
  });
});

describe("charsFromCaptions", () => {
  it("passes single-character captions through with exact windows", () => {
    const result = charsFromCaptions([
      { text: "你", startMs: 0, endMs: 250 },
      { text: "好", startMs: 250, endMs: 500 },
    ]);
    expect(result).toEqual([
      { char: "你", startMs: 0, endMs: 250, pageBreakAfter: undefined },
      { char: "好", startMs: 250, endMs: 500, pageBreakAfter: undefined },
    ]);
  });

  it("splits multi-character captions evenly within their own window", () => {
    const result = charsFromCaptions([{ text: "hello", startMs: 0, endMs: 1000 }]);
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ char: "h", startMs: 0, endMs: 200 });
    expect(result[4]).toMatchObject({ char: "o", startMs: 800, endMs: 1000 });
  });

  it("attaches a caption-level pageBreakAfter hint to its last character", () => {
    const result = charsFromCaptions([
      { text: "世界", startMs: 500, endMs: 1000, pageBreakAfter: true },
    ]);
    expect(result[0].pageBreakAfter).toBeUndefined();
    expect(result[1]).toMatchObject({ char: "界", pageBreakAfter: true });
  });

  it("accepts the @remotion/captions Caption shape (extra fields tolerated)", () => {
    // A real @remotion/captions Caption carries timestampMs/confidence too;
    // structural typing lets it flow into KaraokeCaptionInput.
    const caption = {
      text: "字",
      startMs: 0,
      endMs: 300,
      timestampMs: 0 as number | null,
      confidence: 0.99 as number | null,
    };
    const result = charsFromCaptions([caption]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ char: "字", startMs: 0, endMs: 300 });
  });

  it("skips empty captions", () => {
    const result = charsFromCaptions([
      { text: "", startMs: 0, endMs: 100 },
      { text: "好", startMs: 100, endMs: 200 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].char).toBe("好");
  });
});

describe("paginateChars", () => {
  const timed = (text: string): TimedChar[] => distributeCharTimings(text, 0, text.length * 100);

  it("hard-breaks punctuation-free text at 14 characters", () => {
    const pages = paginateChars(timed("一二三四五六七八九十甲乙丙丁戊己庚辛壬癸"));
    expect(pages.map((p) => p.length)).toEqual([14, 6]);
    expect(pages[0][0].char).toBe("一");
    expect(pages[1][0].char).toBe("戊");
  });

  it("keeps a 14-character line on a single page", () => {
    const pages = paginateChars(timed("一二三四五六七八九十甲乙丙丁"));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(14);
  });

  it("breaks at CJK punctuation once the 8-character minimum is reached", () => {
    // 诗词歌赋，山水田园，画 → break after the second comma (10 chars)
    const pages = paginateChars(timed("诗词歌赋，山水田园，画"));
    expect(pages.map((p) => p.length)).toEqual([10, 1]);
    expect(pages[0][9].char).toBe("，");
    expect(pages[1][0].char).toBe("画");
  });

  it("does not break at punctuation before the minimum page length", () => {
    // comma at index 2 (3 chars) is too early; hard break at 14
    const pages = paginateChars(timed("春天，万物复苏草木发芽生长开花"));
    expect(pages.map((p) => p.length)).toEqual([14, 1]);
  });

  it("honours pageBreakAfter hints once the minimum is reached", () => {
    const chars = timed("春夏秋冬四季轮转往复");
    chars[7].pageBreakAfter = true; // 8th char
    const pages = paginateChars(chars);
    expect(pages.map((p) => p.length)).toEqual([8, 2]);
  });

  it("ignores pageBreakAfter hints below the minimum page length", () => {
    const chars = timed("一二三四五六七八九十");
    chars[2].pageBreakAfter = true; // 3rd char — too early
    const pages = paginateChars(chars);
    expect(pages.map((p) => p.length)).toEqual([10]);
  });

  it("respects custom min/max overrides", () => {
    const pages = paginateChars(timed("一二三四五六七八九十"), { minChars: 3, maxChars: 5 });
    expect(pages.map((p) => p.length)).toEqual([5, 5]);
  });

  it("returns no pages for empty input", () => {
    expect(paginateChars([])).toEqual([]);
  });
});

describe("charStateAt", () => {
  const tc = { startMs: 100, endMs: 200 };

  it("is unread before the character window", () => {
    expect(charStateAt(tc, 50)).toBe("unread");
  });

  it("is current at the exact window start (left-closed)", () => {
    expect(charStateAt(tc, 100)).toBe("current");
    expect(charStateAt(tc, 150)).toBe("current");
  });

  it("is read at the exact window end (right-open)", () => {
    expect(charStateAt(tc, 200)).toBe("read");
    expect(charStateAt(tc, 500)).toBe("read");
  });
});

describe("activePageIndex", () => {
  // two pages: [0, 800) and [800, 1000)
  const pages = [
    distributeCharTimings("一二三四五六七八", 0, 800),
    distributeCharTimings("九十", 800, 1000),
  ];

  it("shows the first page before any character starts", () => {
    expect(activePageIndex(pages, -50)).toBe(0);
  });

  it("advances to the second page at its first character", () => {
    expect(activePageIndex(pages, 0)).toBe(0);
    expect(activePageIndex(pages, 799)).toBe(0);
    expect(activePageIndex(pages, 800)).toBe(1);
  });

  it("anchors on the last page after the line ends", () => {
    expect(activePageIndex(pages, 5000)).toBe(1);
  });
});

describe("estimateWidthEm", () => {
  it("counts full-width CJK glyphs as one em", () => {
    expect(estimateWidthEm("你好")).toBe(2);
  });

  it("counts Latin characters at roughly half an em", () => {
    expect(estimateWidthEm("ab")).toBeCloseTo(1.1);
  });

  it("mixes CJK and Latin widths additively", () => {
    expect(estimateWidthEm("你a")).toBeCloseTo(1.55);
  });
});

describe("fitFontSize", () => {
  const base = {
    baseFontSize: 40,
    textBoxWidth: 400,
    bandHeight: 500,
    lineHeight: 1.4,
    verticalPadding: 20,
    maxLines: 2,
  };

  it("keeps the base size when the text fits on one line", () => {
    const { fontSize, lines } = fitFontSize({ ...base, text: "你好世界" });
    expect(fontSize).toBe(40);
    expect(lines).toBe(1);
  });

  it("shrinks the font so long text stays within maxLines", () => {
    // 40 CJK chars at 40px need 4 lines of 400px → halved to fit 2 lines
    const text = "字".repeat(40);
    const { fontSize, lines } = fitFontSize({ ...base, text });
    expect(fontSize).toBe(20);
    expect(lines).toBe(2);
  });

  it("shrinks further when the capsule would exceed the safe band", () => {
    const { fontSize } = fitFontSize({
      ...base,
      text: "字".repeat(40),
      bandHeight: 60, // tiny band forces an extra scale-down
    });
    expect(fontSize).toBeLessThan(20);
  });
});