import { memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';

/**
 * Check if a URL is a YouTube URL and extract the video ID.
 */
function getYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match.length > 1) {
      // Non-null assertion is safe here since we checked match.length > 1
       
      return match[1]!;
    }
  }
  return null;
}

/**
 * Video component - renders a video player.
 *
 * Supports regular video URLs and YouTube URLs (renders as embedded iframe).
 */
export const Video = memo(function Video({ node, surfaceId }: A2UIComponentProps<Types.VideoNode>) {
  const { theme, resolveString } = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const url = resolveString(props.url);

  if (!url) {
    return null;
  }

  const youtubeId = getYouTubeVideoId(url);

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-video" style={hostStyle}>
      <section
        className={classMapToString(theme.components.Video)}
        style={stylesToObject(theme.additionalStyles?.Video)}
      >
        {youtubeId ? (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}`}
            title="YouTube video player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ border: 'none', width: '100%', aspectRatio: '16/9' }}
          />
        ) : (
          <video src={url} controls />
        )}
      </section>
    </div>
  );
});

export default Video;
