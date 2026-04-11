/**
 * AutoVideo v2 — ContentRouter
 * Dispatches block content to the correct renderer component.
 */

import React from 'react';
import { getTheme } from '../engine/theme';
import type { Block, ContentSpec, Rect } from '../../types/block';

// Static content components
import { ImageContent }    from './contents/Image';
import { CodeContent }     from './contents/Code';
import { IconContent }     from './contents/Icon';
import { TextCardContent } from './contents/TextCard';
import { LottieContent }   from './contents/Lottie';
import { VideoContent }    from './contents/VideoClip';

interface ContentRouterProps {
  content: ContentSpec;
  block: Block;
  frame: number;
  totalFrames: number;
  fps: number;
  rect: Rect;
}

export const ContentRouter: React.FC<ContentRouterProps> = (props) => {
  const { content, block, frame, totalFrames, fps, rect } = props;
  const theme = getTheme();

  const commonProps = { frame, totalFrames, fps, rect, theme };

  switch (content.type) {
    case 'image':
      return <ImageContent spec={content.spec as any} {...commonProps} />;

    case 'code':
      return <CodeContent spec={content.spec as any} {...commonProps} />;

    case 'icon':
      return <IconContent spec={content.spec as any} {...commonProps} />;

    case 'textcard':
      return <TextCardContent spec={content.spec as any} {...commonProps} />;

    case 'lottie':
      return <LottieContent spec={content.spec as any} {...commonProps} />;

    case 'video':
      return <VideoContent spec={content.spec as any} {...commonProps} />;

    case 'animation': {
      // Dynamically load the AI-generated component from src/blocks/{id}/Component
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(`../blocks/${block.id}/Component`);
        const AnimComp = mod.default ?? mod.Component;
        if (AnimComp) {
          return (
            <AnimComp
              frame={frame}
              durationInFrames={totalFrames}
              rect={rect}
              theme={theme}
              fps={fps}
            />
          );
        }
      } catch (_e) {
        // Component not yet generated — show placeholder
      }
      return <AnimationPlaceholder title={block.title} description={(content.spec as any).description} />;
    }

    default:
      return <AnimationPlaceholder title={block.title} description="Unknown content type" />;
  }
};

const AnimationPlaceholder: React.FC<{ title: string; description?: string }> = ({ title, description }) => {
  const theme = getTheme();
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.bgCard,
        borderRadius: theme.borderRadius,
        border: `2px dashed ${theme.fgMuted}`,
        padding: 40,
        gap: 16,
      }}
    >
      <p style={{ fontFamily: theme.fonts.body, fontSize: 32, color: theme.fgMuted, margin: 0 }}>
        ⏳ 生成中…
      </p>
      <p style={{ fontFamily: theme.fonts.body, fontSize: 24, color: theme.fg, margin: 0, fontWeight: 700 }}>
        {title}
      </p>
      {description && (
        <p style={{
          fontFamily: theme.fonts.body, fontSize: 18, color: theme.fgMuted, margin: 0,
          textAlign: 'center', maxWidth: 600, lineHeight: 1.6,
        }}>
          {description.slice(0, 200)}
        </p>
      )}
    </div>
  );
};
