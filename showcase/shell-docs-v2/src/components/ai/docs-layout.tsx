"use client";

import "@copilotkit/react-core/v2/styles.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import {
  CopilotChat,
  useAgent,
  useCopilotChatConfiguration,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  DocsLayout as SpaciousLayout,
  useSpaciousLayout,
  type DocsLayoutProps,
} from "fumadocs-ui/layouts/spacious";
import { SquarePen, X } from "lucide-react";
import { AskAIGlyph } from "@/components/icons/glyphs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CHAT_TEXTAREA,
  ChatAssistantMessage,
  ChatComposer,
  ChatSendButton,
  ChatWelcome,
  HomeChatWelcome,
  KiteMark,
  RatingsContext,
  type Rating,
} from "./chat-parts";
import { sendAnswerFeedback } from "@/lib/feedback";
import { DocsAgent } from "./docs-agent";
import { DocsChatProvider, useDocsChatSession } from "./chat-session";
import { DocsChatWorkspace } from "./docs-chat-workspace";

/**
 * Spacious' DocsLayout with CopilotKit in its `aiChat` slot, following
 * Fumadocs' "Ask AI" guide. One chat per tab: it lives as long as the page.
 * Used by `/docs` and the prototypes' docs pages.
 */
export function DocsLayout({
  ...props
}: DocsLayoutProps & { agent?: ReactNode }) {
  const session = useDocsChatSession();
  return session ? (
    <DocsLayoutContent {...props} />
  ) : (
    <DocsChatProvider>
      <DocsLayoutContent {...props} />
    </DocsChatProvider>
  );
}

function DocsLayoutContent({
  agent,
  children,
  ...props
}: DocsLayoutProps & {
  /** Where this layout keeps the reader's stack, for the agent. */
  agent?: ReactNode;
}) {
  const { open, setOpen } = useDocsChatSession()!;

  return (
    <SpaciousLayout
      {...props}
      aiChat={{ open, onOpenChange: setOpen, panel: <ChatPanel /> }}
    >
      <DocsAgent />
      {agent}
      {children}
      {open ? null : <AskAITrigger onOpen={() => setOpen(true)} />}
    </SpaciousLayout>
  );
}

/**
 * On tablets and desktops the chat opens from a round button in the page's bottom-right
 * corner, the primary pill's plum with a chat glyph. Phones open it from the
 * sidebar drawer, as Spacious does.
 */
function AskAITrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Ask CopilotKit"
            onClick={onOpen}
            className="fixed end-6 bottom-6 z-30 size-12 rounded-full bg-foreground text-background shadow-lift hover:bg-foreground/85 max-md:hidden"
          />
        }
      >
        <AskAIGlyph className="size-[22px]" />
      </TooltipTrigger>
      <TooltipContent side="left">Ask CopilotKit</TooltipContent>
    </Tooltip>
  );
}

/** A message's text, without its attachments. */
function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) =>
        part?.type === "text" ? (part.text ?? "") : "",
      )
      .join("");
  }
  return "";
}

/** The runtime's own message (rate limit, length), or a generic one. */
function readableError(error: Error) {
  return (
    /"error":"([^"]+)"/.exec(error.message)?.[1] ??
    "Something went wrong. Try again in a moment."
  );
}

const WIDTH_KEY = "cpk-chat-width";
const MIN_WIDTH = 320;
/** The widest gap between the page and the chat the handle will cover. */
const MAX_GUTTER = 48;
const maxWidth = () => Math.min(760, Math.round(window.innerWidth * 0.55));
const clampWidth = (w: number) =>
  Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()));

/**
 * The chat's resize handle: the whole gutter between the page and the chat
 * drags (or focus it and use the arrow keys). It lives in a portal over that
 * gutter, which belongs to neither panel. Spacious sizes its chat column with
 * its own `--fd-ai-chat-width` variable, so this sets that variable on the
 * column; the reader's width is kept for next time.
 */
function ResizeHandle() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const column = () => anchor.current?.closest("aside") ?? null;
  const apply = (w: number, persist = true) => {
    const aside = column();
    if (!aside) return;
    const next = clampWidth(w);
    aside.style.setProperty("--fd-ai-chat-width", `${next}px`);
    setWidth(next);
    if (persist) localStorage.setItem(WIDTH_KEY, String(next));
  };

  // The reader's last width.
  useEffect(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved) apply(saved, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the handle over the gutter: from the page panel's edge to just
  // inside the chat's (6px either side of the chat's edge where it floats
  // over the page). Each page brings its own panel, so this starts over on
  // every navigation; a gutter wider than MAX_GUTTER means the panel isn't
  // beside the chat, and the handle falls back to the chat's edge.
  const pathname = usePathname();
  useEffect(() => {
    const aside = column();
    if (!aside) return;
    const panel = document.getElementById("nd-page-panel");
    const measure = () => {
      const a = aside.getBoundingClientRect();
      if (
        a.width < MIN_WIDTH / 2 ||
        getComputedStyle(aside).visibility === "hidden"
      ) {
        setBox(null);
        return;
      }
      const p = panel?.isConnected ? panel.getBoundingClientRect() : null;
      const gutter = p ? a.left - p.right : -1;
      const start = gutter >= 0 && gutter <= MAX_GUTTER ? p!.right : a.left - 6;
      setBox({
        left: start,
        top: a.top,
        width: a.left + 6 - start,
        height: a.height,
      });
      setWidth(Math.round(a.width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(aside);
    if (panel) observer.observe(panel);
    aside.addEventListener("transitionend", measure);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      aside.removeEventListener("transitionend", measure);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      <span ref={anchor} hidden />
      {box
        ? createPortal(
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat"
              aria-valuemin={MIN_WIDTH}
              aria-valuemax={760}
              aria-valuenow={width ?? undefined}
              tabIndex={0}
              style={box}
              onPointerDown={(e) => {
                const aside = column();
                if (!aside) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const start = aside.getBoundingClientRect().width;
                // Follow the pointer, not Spacious' width transition.
                aside.style.transition = "none";
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                const move = (ev: PointerEvent) =>
                  apply(start + (startX - ev.clientX), false);
                const up = (ev: PointerEvent) => {
                  apply(start + (startX - ev.clientX));
                  aside.style.transition = "";
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
              onKeyDown={(e) => {
                const current =
                  width ?? column()?.getBoundingClientRect().width ?? 400;
                if (e.key === "ArrowLeft") apply(current + 24);
                else if (e.key === "ArrowRight") apply(current - 24);
                else return;
                e.preventDefault();
              }}
              className="group/resize fixed z-50 cursor-col-resize touch-none outline-none max-md:hidden"
            >
              <span className="absolute inset-y-4 start-1/2 w-0.5 -translate-x-1/2 rounded-full bg-fd-primary/60 opacity-0 transition-opacity duration-150 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-active/resize:opacity-100 motion-reduce:transition-none" />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Header buttons: 32px, 40px on touch screens. */
const HEADER_BUTTON =
  "size-8 rounded-lg text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground max-md:size-10";

function ChatPanel() {
  const { props } = useSpaciousLayout();
  return (
    <>
      <ResizeHandle />
      <DocsChatWorkspace>
        <DocsChat onClose={() => props.aiChat?.onOpenChange(false)} />
      </DocsChatWorkspace>
    </>
  );
}

/** Layout-neutral chat using the same built-in slots on home and docs. */
export function DocsChat({
  home = false,
  onClose,
}: {
  home?: boolean;
  onClose?: () => void;
}) {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const chatConfiguration = useCopilotChatConfiguration();
  const [error, setError] = useState<string | null>(null);

  // A new run clears the last error.
  useEffect(
    () =>
      agent.subscribe({ onRunInitialized: () => setError(null) }).unsubscribe,
    [agent],
  );

  const started = agent.messages.length > 0;

  // Thumbs on an answer: rate it (sent with its question to the feedback
  // action), switch the rating, or click the same thumb to clear it.
  const pathname = usePathname();
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const rate = useCallback(
    (message: { id: string; content?: unknown }, rating: Rating) => {
      const cleared = ratings[message.id] === rating;
      setRatings((current) => {
        const next = { ...current };
        if (cleared) delete next[message.id];
        else next[message.id] = rating;
        return next;
      });
      if (cleared) return;
      const index = agent.messages.findIndex((m) => m.id === message.id);
      const question = agent.messages
        .slice(0, index)
        .findLast((m) => m.role === "user");
      void sendAnswerFeedback({
        rating,
        messageId: message.id,
        url: pathname,
        question: textOf(question?.content).slice(0, 2_000),
        answer: textOf(message.content).slice(0, 8_000),
      }).catch(() => {});
    },
    [agent, pathname, ratings],
  );
  const ratingsValue = useMemo(() => ({ ratings, rate }), [ratings, rate]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-fd-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-fd-border bg-fd-background ps-4 pe-2">
        <KiteMark />
        <h2 className="text-sm font-medium">
          {started ? "Ask Kite" : "Explore the docs"}
        </h2>
        <div className="ms-auto flex items-center gap-0.5">
          {started ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="New chat"
                    onClick={() => {
                      // CopilotChat owns the old run's teardown and message
                      // reset when the shared configuration changes thread.
                      copilotkit.stopAgent({ agent });
                      chatConfiguration?.startNewThread();
                      setRatings({});
                      setError(null);
                    }}
                    className={HEADER_BUTTON}
                  />
                }
              >
                <SquarePen />
              </TooltipTrigger>
              <TooltipContent>New chat</TooltipContent>
            </Tooltip>
          ) : null}
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close chat"
              onClick={onClose}
              className={HEADER_BUTTON}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="border-b border-fd-error/30 bg-fd-error/8 px-4 py-2 text-xs leading-5 text-fd-foreground"
        >
          {error}
        </p>
      )}
      <RatingsContext value={ratingsValue}>
        <CopilotChat
          className="min-h-0 flex-1 bg-fd-background"
          onError={(event) => {
            if ("error" in event) setError(readableError(event.error));
          }}
          labels={{
            chatInputPlaceholder: "Ask Kite anything",
            welcomeMessageText: home
              ? "Hi, I’m Kite, your guide to CopilotKit. How can I help?"
              : "How can we help?",
          }}
          welcomeScreen={home ? HomeChatWelcome : ChatWelcome}
          suggestionView={{
            children: ({ suggestions, onSelectSuggestion, loadingIndexes }) => (
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion, index) => (
                  <Button
                    key={suggestion.title}
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-11 whitespace-normal text-xs"
                    disabled={loadingIndexes?.includes(index)}
                    onClick={() => onSelectSuggestion?.(suggestion, index)}
                  >
                    {suggestion.title}
                  </Button>
                ))}
              </div>
            ),
          }}
          // Screenshots of an error or a UI: "+" picks one, or drop or paste it.
          attachments={{
            enabled: true,
            accept: "image/*",
            maxSize: 3 * 1024 * 1024,
            onUploadFailed: (e) => setError(e.message),
          }}
          input={{
            textArea: { ...CHAT_TEXTAREA, "aria-label": "Your question" },
            sendButton: ChatSendButton,
            children: ({ textArea, sendButton, onAddFile }) => (
              <ChatComposer
                textArea={textArea}
                sendButton={sendButton}
                onAddFile={onAddFile}
              />
            ),
          }}
          messageView={{
            className: "px-4 pt-4 pb-2",
            // A reply's searches and thinking fold into one "Worked for" row.
            toolCallDisplay: "turn",
            workSummary: {
              className: "py-0.5 text-xs! leading-5 text-fd-muted-foreground!",
            },
            assistantMessage: ChatAssistantMessage,
            // "Thought for 3 seconds" reads as quietly as a tool status.
            reasoningMessage: {
              className: "my-0.5",
              header: {
                className:
                  "py-0.5 text-xs! leading-5 text-fd-muted-foreground!",
              },
              contentView: {
                className: "[&>div]:text-xs! [&>div]:leading-5",
              },
            },
            // The question in the answer's type (CopilotKit's prose would set
            // it larger), without a copy row under it.
            userMessage: {
              className: "pt-6!",
              messageRenderer: {
                className:
                  "max-w-[85%] rounded-2xl rounded-br-md bg-fd-secondary! px-3.5! py-2! text-sm! leading-6! text-fd-foreground!",
              },
              toolbar: { className: "hidden!" },
            },
          }}
        />
      </RatingsContext>
    </div>
  );
}
