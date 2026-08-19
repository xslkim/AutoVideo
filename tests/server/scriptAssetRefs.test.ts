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

  it('ignores paths inside HTML comments', () => {
    const script = `
@visual: video(./assets/e02-b06-mount.mp4)
<!-- 文档参考：--patch ./scratch-plugin/cordis.yml，素材 ./docs/old.mp4 -->
`;
    expect(extractScriptAssetRefs(script)).toEqual([
      './assets/e02-b06-mount.mp4',
    ]);
  });
});
