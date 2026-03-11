"use client";

import YouTube from "react-youtube";

export function YouTubeVideo({
  videoId,
  defaultPlaybackRate = 1.0,
}: {
  videoId: string;
  defaultPlaybackRate?: number;
}) {
  const onPlayerReady: YouTube["props"]["onReady"] = (event) => {
    const player = event.target;

    if (defaultPlaybackRate) {
      player.setPlaybackRate(defaultPlaybackRate);
    }
  };

  const opts: YouTube["props"]["opts"] = {
    playerVars: {},
  };

  return (
    <div className="w-full aspect-video rounded-lg overflow-hidden">
      <YouTube
        videoId={videoId}
        className="w-full h-full rounded-lg"
        iframeClassName="rounded-2xl w-full h-full shadow-xl border"
        opts={opts}
        onReady={onPlayerReady}
      />
    </div>
  );
}
