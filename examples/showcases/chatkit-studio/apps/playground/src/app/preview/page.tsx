"use client";
import { useEffect, useRef, useState } from "react";
import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import { PlaygroundConfig } from "@/types/playground";

export default function PreviewPage() {
  const [config, setConfig] = useState<PlaygroundConfig | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "UPDATE_CONFIG") setConfig(e.data.config);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "PREVIEW_READY" }, "*");

    // important: fill the iframe and avoid body growing
    document.documentElement.style.cssText = "margin:0; padding:0; overflow:scroll; height:100%;";
    document.body.style.cssText = "margin:0; padding:0; overflow:scroll; height:100%;";

    return () => window.removeEventListener("message", onMsg);
  }, []);

  // optional: if you are still auto-resizing the iframe from inside,
  // clamp the posted height so it never exceeds the iframe viewport
  useEffect(() => {
    const send = () => {
      const h = Math.min(
        Math.ceil(
          Math.max(document.documentElement.scrollHeight, document.documentElement.clientHeight)
        ),
        window.innerHeight
      );
      window.parent.postMessage({ type: "IFRAME_HEIGHT", height: h }, "*");
    };
    requestAnimationFrame(send);
    window.addEventListener("resize", send);
    return () => window.removeEventListener("resize", send);
  }, []);

  if (!config) {
    return (
      <div
        ref={rootRef}
        style={{
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ fontSize: "14px", color: "#6b7280" }}>Loading preview...</div>
        <div style={{ fontSize: "12px", color: "#9ca3af", maxWidth: "400px", textAlign: "center" }}>
          Make sure your AG-UI agent is running at the configured URL
        </div>
      </div>
    );
  }

  const cssVars = {
    "--copilot-kit-primary-color": config.colors.primary,
    "--copilot-kit-contrast-color": config.colors.contrast,
    "--copilot-kit-background-color": config.colors.background,
    "--copilot-kit-secondary-color": config.colors.secondary,
    "--copilot-kit-secondary-contrast-color": config.colors.secondaryContrast,
    "--copilot-kit-separator-color": config.colors.separator,
    "--copilot-kit-muted-color": config.colors.muted,
  } as CopilotKitCSSProperties;

  const customStyles = `
    /* Typography and radii you already had */
    .copilotKitMessages,.copilotKitInput,.copilotKitUserMessage,.copilotKitAssistantMessage,.copilotKitMarkdownElement{
      font-family:${config.typography.fontFamily}!important;
      font-size:${config.typography.fontSize}!important;
    }
    .copilotKitUserMessage,.copilotKitAssistantMessage{
      border-radius:${config.style.bubbleBorderRadius}!important;
    }
    .copilotKitMessages{padding:${config.style.padding}!important;}
    .copilotKitInput{
      padding:${config.style.padding}!important;
      background-color:${config.colors.inputBackground}!important;
    }
    .copilotKitInput input,
    .copilotKitInput textarea,
    .copilotKitInput [contenteditable]{
      background-color:${config.colors.inputBackground}!important;
      color:${config.colors.secondaryContrast}!important;
    }

    /* NEW: layout so only the message list scrolls */
    html, body { height:100%; }
    .chat-container {
      height: 100% !important;            /* fill parent element */
      display: flex;
      flex-direction: column;
      overflow: scroll;        /* prevent the page from growing */
    }
    .copilotKitChat {
      height: 100% !important;
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: customStyles }} />
      <div ref={rootRef} className="chat-container" style={cssVars}>
        <CopilotChat
          labels={{
            title: config.labels.title,
            initial: config.labels.initial,
            placeholder: config.labels.placeholder,
          }}
        />
      </div>
    </>
  );
}
