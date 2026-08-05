import { describe, it, expect } from "vitest";
import { scaleFontMentions } from "../../src/compile/font-scale.js";

const H = 1080; // floor = 1080 * 0.028 ≈ 30.24px

describe("scaleFontMentions", () => {
  it("leaves descriptions without font mentions alone", () => {
    const d = "居中卡片，圆角 16px，内边距 24px";
    const res = scaleFontMentions(d, H);
    expect(res.description).toBe(d);
    expect(res.scale).toBe(1);
    expect(res.originalMinPx).toBeNull();
  });

  it("leaves already-large fonts alone", () => {
    const d = "主标题 字号 72px，正文 字号 34px";
    expect(scaleFontMentions(d, H).description).toBe(d);
  });

  it("scales the whole hierarchy so the smallest font clears the floor", () => {
    const res = scaleFontMentions("标题 字号 48px，正文 字号 24px", H);
    // 30.24 / 24 = 1.26
    expect(res.originalMinPx).toBe(24);
    expect(res.scale).toBeCloseTo(1.26, 2);
    expect(res.description).toBe("标题 字号 60px，正文 字号 30px");
  });

  it("does not touch corner radius, padding or offsets", () => {
    const res = scaleFontMentions("卡片圆角 16px、内边距 24px、距顶 50px，字号 20px", H);
    expect(res.description).toContain("圆角 16px");
    expect(res.description).toContain("内边距 24px");
    expect(res.description).toContain("距顶 50px");
    expect(res.description).not.toContain("字号 20px");
  });

  it("handles the font-size spelling and colon form", () => {
    const res = scaleFontMentions("caption font-size: 18px", H);
    expect(res.description).toBe("caption font-size: 30px");
  });

  it("caps the factor so a stray tiny size cannot blow up the title", () => {
    // Floor/2 would be a 15x factor; the 120px title must stay ≤ height*0.14.
    const res = scaleFontMentions("标题 字号 120px，角标 字号 2px", H);
    const sizes = [...res.description.matchAll(/字号 (\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(Math.round(H * 0.14));
    // The floor still wins for the smallest mention.
    expect(Math.min(...sizes)).toBe(Math.round(H * 0.028));
  });

  it("scales relative to the actual canvas height", () => {
    // 720p floor ≈ 20.2px, so 24px is already fine there.
    expect(scaleFontMentions("字号 24px", 720).scale).toBe(1);
  });
});
