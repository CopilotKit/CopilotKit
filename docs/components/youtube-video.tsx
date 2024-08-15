import YouTube from "react-youtube";

export function YouTubeVideo({ videoId }: { videoId: string }) {
  const onPlayerReady: YouTube["props"]["onReady"] = (event) => {
    const player = event.target;
    player.setPlaybackRate(1.25);
  }

  const opts: YouTube["props"]["opts"] = {
    playerVars: {},
  }

  return (
    <YouTube
      videoId={videoId}
      className="max-w-[600px] w-full rounded-lg"
      opts={opts}
      onReady={onPlayerReady}
    />
  );
}