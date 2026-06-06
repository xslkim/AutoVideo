import { describe, expect, it } from 'vitest';
import { extractScriptAssetRefs } from '../../server/utils/scriptAssetRefs.js';

describe('scriptAssetRefs', () => {
  it('extracts paths with spaces and Unicode filenames', () => {
    const script = `
@visual: video(./最终渲染动画.mp4)
@visual: image(./Unity 原生的渲染效果1.jpg)
@visual: image(./MyRender 软渲染的效果1.jpg)
实际使用 ./所有参数保持和Unity UI面板一致，左手坐标系.jpg 图片
`;
    expect(extractScriptAssetRefs(script)).toEqual([
      './最终渲染动画.mp4',
      './Unity 原生的渲染效果1.jpg',
      './MyRender 软渲染的效果1.jpg',
      './所有参数保持和Unity UI面板一致，左手坐标系.jpg',
    ]);
  });
});
