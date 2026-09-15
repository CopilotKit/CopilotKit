"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

type ProductVideo = { title: string; url: string };

function VideoPlayer({ video }: { video: ProductVideo }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  return (
    <>
      <div className="partner-video-frame">
        <video
          src={`${video.url}#t=0.1`}
          controls
          playsInline
          preload="metadata"
          aria-label={`${video.title} — CopilotKit product walkthrough`}
          onLoadedMetadata={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
        {status !== "ready" && (
          <div className="partner-video-status" role="status">
            <span>
              {status === "error"
                ? "This video couldn’t load."
                : "Loading walkthrough…"}
            </span>
            <a href={video.url} target="_blank" rel="noreferrer">
              Open video <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
      <p className="partner-video-caption">
        CopilotKit product walkthrough · React
      </p>
    </>
  );
}

export function FrameworkVideos({ videos }: { videos: ProductVideo[] }) {
  const [selectedUrl, setSelectedUrl] = useState(videos[0]?.url);
  const active = videos.find((video) => video.url === selectedUrl) ?? videos[0];
  if (!active) return null;

  return (
    <div className="partner-videos">
      {videos.length > 1 && (
        <div
          className="partner-video-options"
          role="group"
          aria-label="Choose a product video"
        >
          {videos.map((video) => (
            <button
              key={video.url}
              type="button"
              aria-pressed={video.url === active.url}
              onClick={() => setSelectedUrl(video.url)}
            >
              {video.title}
            </button>
          ))}
        </div>
      )}
      <VideoPlayer key={active.url} video={active} />
    </div>
  );
}
