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
      className="w-full h-[425px] rounded-lg"
      iframeClassName="rounded-2xl w-full h-full shadow-xl border"
      opts={opts}
      onReady={onPlayerReady}
    />
  );
}