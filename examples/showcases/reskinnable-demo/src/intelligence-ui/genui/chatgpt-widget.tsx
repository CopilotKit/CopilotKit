"use client";

/**
 * Ledgerline's card as it rendered in ChatGPT: the real MCP App
 * (`src/skins/ledgerline/mcp-app`, built to one self-contained HTML file),
 * hosted here the way ChatGPT hosts it. An `AppBridge` answers the widget's
 * `ui/initialize` handshake and hands it the recorded tool input and result,
 * so the widget draws exactly the card the person saw. Nothing can be clicked
 * and no tool call leaves the frame: it is a recording.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

export function ChatGptWidget(props: {
  readonly html: string | null;
  readonly tool: string;
  readonly structuredContent: Record<string, unknown>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const iframe = frame.current;
    const win = iframe?.contentWindow;
    if (!props.html || !iframe || !win) return;
    const bridge = new AppBridge(
      null,
      { name: "ChatGPT", version: "1.0.0" },
      { openLinks: {} },
      {
        hostContext: {
          theme: "light",
          displayMode: "inline",
          platform: "web",
        },
      },
    );
    const sc = props.structuredContent;
    bridge.oninitialized = () => {
      void bridge.sendToolInput({
        arguments:
          sc.kind === "review-card"
            ? { sessionId: sc.sessionId }
            : { reportId: (sc.report as { id?: string } | undefined)?.id },
      });
      void bridge.sendToolResult({
        content: [{ type: "text", text: JSON.stringify(sc) }],
        structuredContent: sc,
      });
    };
    bridge.onsizechange = ({ height: h }) => {
      if (typeof h === "number" && h > 0) setHeight(Math.ceil(h));
    };
    bridge.onopenlink = async () => ({ isError: true });
    // Connect first, then load the widget: its `ui/initialize` must find the
    // bridge listening (a server-rendered srcdoc would load before hydration).
    bridge
      .connect(new PostMessageTransport(win, win))
      .then(() => {
        iframe.srcdoc = props.html ?? "";
      })
      .catch((error: unknown) => {
        console.error(
          "[intelligence] could not host the Ledgerline MCP app",
          error,
        );
        setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      void bridge.close();
    };
  }, [props.html, props.structuredContent]);

  if (!props.html) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <MessageCircle aria-hidden className="h-3.5 w-3.5" />
        <span>In ChatGPT</span>
        <span aria-hidden>·</span>
        <span>Ledgerline app, {props.tool}</span>
      </div>
      <div style={{ pointerEvents: "none" }}>
        <iframe
          ref={frame}
          title="Ledgerline in ChatGPT"
          sandbox="allow-scripts"
          style={{
            display: "block",
            width: "100%",
            height,
            border: 0,
            background: "transparent",
          }}
        />
      </div>
      {failed ? <p className="text-xs text-negative">{failed}</p> : null}
    </div>
  );
}
