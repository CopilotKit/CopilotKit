"use client"

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
    <YouTube
      videoId={videoId}
      className="max-w-[600px] w-full rounded-lg"
      opts={opts}
      onReady={onPlayerReady}
    />
  );
}