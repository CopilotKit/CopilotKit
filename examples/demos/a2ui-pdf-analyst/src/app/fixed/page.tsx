"use client";

import { useState } from "react";
import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/Brand";
import { SurfaceCanvas, CanvasEmptyState } from "@/components/SurfaceCanvas";
import { FilteredUserMessage } from "@/components/FilteredUserMessage";
import { FilteredAssistantMessage } from "@/components/FilteredAssistantMessage";
import { Split } from "@/components/Split";
import { extractPdfText } from "@/lib/pdf";

const AGENT_ID = "fixed_agent";

export default function FixedPage() {
  const { agent: _agent } = useAgent({ agentId: AGENT_ID });
  const [loaded, setLoaded] = useState<{
    filename: string;
    pages: number;
    chars: number;
  } | null>(null);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav active="fixed" />

      <Split
        persistKey="fixed.split"
        initialLeftFraction={0.32}
        left={
          <div className="h-full flex flex-col copilot-chat-wrapper">
            {loaded && (
              <div className="shrink-0 px-4 py-2 border-b border-[var(--line)] flex items-center gap-2 bg-[color-mix(in_oklab,var(--mint)_8%,var(--surface))]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0d6b4f]" />
                <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink)]">
                  loaded
                </span>
                <span className="text-[12.5px] font-medium text-[var(--ink)] truncate">
                  {loaded.filename}
                </span>
                <span className="text-[11px] text-[var(--ink)] ml-auto">
                  {loaded.pages} pg · {Math.round(loaded.chars / 1000)}k chars
                </span>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <CopilotChat
                agentId={AGENT_ID}
                chatView={{
                  messageView: {
                    userMessage: FilteredUserMessage,
                    assistantMessage: FilteredAssistantMessage,
                  },
                }}
                attachments={{
                  enabled: true,
                  accept: "application/pdf",
                  maxSize: 20 * 1024 * 1024,
                  onUpload: async (file) => {
                    const { text, pages } = await extractPdfText(file);
                    setLoaded({
                      filename: file.name,
                      pages,
                      chars: text.length,
                    });
                    return {
                      type: "data",
                      value: text.slice(0, 60_000),
                      mimeType: "text/plain",
                      metadata: {
                        filename: file.name,
                        pages,
                        originalMime: "application/pdf",
                      },
                    };
                  },
                  onUploadFailed: (err) =>
                    console.warn("[pdf upload failed]", err),
                }}
                labels={{
                  chatInputPlaceholder:
                    "Attach a PDF (📎), then ask to render the dashboard…",
                  welcomeMessageText:
                    "Attach a PDF using the 📎 button, then ask: “Render the dashboard.”",
                }}
              />
            </div>
          </div>
        }
        right={
          <SurfaceCanvas
            channel={AGENT_ID}
            emptyState={
              <CanvasEmptyState
                title="Canvas is empty"
                subtitle="Attach a PDF in the chat (📎 in the input toolbar) and ask the agent to render the dashboard. The rendered A2UI surface will fill this canvas."
                hint={
                  <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
                    try: “Render the dashboard.”
                  </span>
                }
              />
            }
          />
        }
      />
    </div>
  );
}
