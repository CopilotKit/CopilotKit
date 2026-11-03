"use client";

import "@copilotkit/react-core/v2/styles.css";
import { useEffect, useState } from "react";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import { SquarePen } from "lucide-react";
import { DocsChat } from "@/components/ai/docs-chat";
import { PageGlyph } from "@/components/icons/glyphs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { AskAgent } from "./ask-agent";
import { GuidePanel } from "./guide-panel";
import { useGuide } from "./guide-state";
import { GUIDE_THEME, guideUI } from "./guide-ui";
import { takeConversation } from "./handoff";
import styles from "./ask-page.module.css";

/**
 * Ask CopilotKit on a full page (/ask): the docs' own chat, with the
 * standard catalog wired in, so it can answer with UI and write a reader a
 * guide. A separate CopilotKit from the docs' side chat, on the same agent.
 */
export function AskPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint
      enableInspector={false}
      generativeUI={{ ui: guideUI, theme: GUIDE_THEME }}
    >
      <AskAgent />
      <AskWorkspace />
    </CopilotKitProvider>
  );
}

/** Answers on a full page open docs pages in a new tab; the chat stays. */
const LINKS = { newTab: true };

const LEAD =
  "Ask about CopilotKit, or have it write a step-by-step guide for your stack that your coding agent can follow.";

/** Corner buttons: 32px, 40px on touch screens (as the docs' chat). */
const CORNER_BUTTON =
  "size-8 rounded-lg text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground max-md:size-10";

/**
 * Full screen under the navbar, edge to edge. Until there's a guide, the
 * chat fills it, its conversation in a centered column. When the agent
 * starts a guide, the guide takes the left and the chat narrows to the
 * right, where the docs keep it, with a hairline between them. Phones show
 * one at a time.
 */
function AskWorkspace() {
  const { agent, isReady } = useAgent();
  const guide = useGuide();
  const started = agent.messages.length > 0;

  // The guide the reader closed, or left behind with a new chat. It shows
  // again when the agent writes into it, as does any new guide.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "guide">("chat");
  const writing = guide?.status === "streaming";
  const [wasWriting, setWasWriting] = useState(false);
  if (writing !== wasWriting) {
    setWasWriting(writing);
    if (writing) {
      setDismissed(null);
      setView("guide");
    }
  }
  const shown = guide !== null && guide.surfaceId !== dismissed;

  // A conversation handed over from the docs' side chat ("Open full page"),
  // once the real agent is in (until then it's a stand-in).
  useEffect(() => {
    if (!isReady) return;
    const messages = takeConversation();
    if (messages) agent.setMessages(messages as typeof agent.messages);
  }, [agent, isReady]);

  return (
    <div
      className={cn("h-[calc(100dvh-3.5rem)] bg-fd-background", styles.page)}
    >
      <div
        className="grid h-full min-h-0 transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none max-lg:grid-cols-1!"
        style={{
          gridTemplateColumns: shown
            ? "minmax(0,2fr) minmax(0,1fr)"
            : "minmax(0,0fr) minmax(0,1fr)",
        }}
      >
        <div
          className={cn(
            "min-h-0 min-w-0",
            !shown && "invisible max-lg:hidden",
            shown && view === "chat" && "max-lg:hidden",
          )}
        >
          <GuidePanel
            guide={guide}
            onClose={() => setDismissed(guide?.surfaceId ?? null)}
            onShowChat={() => setView("chat")}
          />
        </div>
        <section
          aria-label="Chat"
          className={cn(
            "relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-fd-background",
            // Room for the corner's buttons, so a question pinned to the top
            // of the chat (pin-to-send) sits under them, not behind them.
            (started || guide) && "pt-12",
            shown && view === "guide" && "max-lg:hidden",
          )}
        >
          {/* No title bar: the navbar names the page. The guide and new-chat
              buttons float in the corner once there's something to act on. */}
          <div className="absolute end-2 top-2 z-10 flex items-center gap-0.5 rounded-lg bg-fd-background">
            {guide ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      aria-label="Show the guide"
                      onClick={() => {
                        setDismissed(null);
                        setView("guide");
                      }}
                      className={cn(
                        "h-8 gap-1.5 rounded-lg px-2.5 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground max-md:h-10",
                        shown && "lg:hidden",
                      )}
                    />
                  }
                >
                  <PageGlyph aria-hidden className="size-4" />
                  <span className="text-sm">Guide</span>
                </TooltipTrigger>
                <TooltipContent>Show the guide</TooltipContent>
              </Tooltip>
            ) : null}
            {started ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="New chat"
                      onClick={() => {
                        if (agent.isRunning) agent.abortRun();
                        agent.setMessages([]);
                        setDismissed(guide?.surfaceId ?? null);
                        setView("chat");
                      }}
                      className={CORNER_BUTTON}
                    />
                  }
                >
                  <SquarePen />
                </TooltipTrigger>
                <TooltipContent>New chat</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <DocsChat column={!shown} lead={LEAD} links={LINKS} />
        </section>
      </div>
    </div>
  );
}
