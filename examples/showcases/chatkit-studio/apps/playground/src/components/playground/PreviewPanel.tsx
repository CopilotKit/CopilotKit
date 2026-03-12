"use client";

import { useEffect, useRef, useState } from "react";
import { PlaygroundConfig } from "@/types/playground";
import { Button } from "@/components/ui/button";

interface PreviewPanelProps {
  config: PlaygroundConfig;
  onExport: () => void;
}

export function PreviewPanel({ config, onExport }: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  const iframeSrc = `/preview`;

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (event.data?.type === "PREVIEW_READY") setIsReady(true);
    };

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (isReady && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "UPDATE_CONFIG", config }, "*");
    }
  }, [config, isReady]);

  return (
    <div className="flex-1 flex flex-col border-2 border-white bg-white/50 backdrop-blur-sm rounded-lg overflow-hidden">
      <div className="border-b border-palette-border-container px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-palette-text-primary">Preview</h2>
          <p className="text-xs text-palette-text-secondary mt-0.5">
            Live preview of your chat component
          </p>
        </div>
        <Button onClick={onExport} size="sm">
          Export Code
        </Button>
      </div>

      <div className="p-6 flex-1 flex flex-col bg-palette-surface-main">
        <iframe
          key={iframeSrc}
          ref={iframeRef}
          src={iframeSrc}
          title="CopilotChat Preview"
          style={{
            width: "100%",
            height: "100%",
            border: 0,
            display: "block",
            borderRadius: config.style.borderRadius,
          }}
        />
      </div>
    </div>
  );
}
