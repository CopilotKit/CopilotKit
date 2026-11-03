"use client";

import "@copilotkit/react-core/v2/styles.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import {
  DocsLayout as SpaciousLayout,
  useSpaciousLayout,
  type DocsLayoutProps,
} from "fumadocs-ui/layouts/spacious";
import { Maximize2, SquarePen, X } from "lucide-react";
import { AskAIGlyph } from "@/components/icons/glyphs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KiteMark } from "./chat-parts";
import { stashConversation } from "@/components/ask/handoff";
import { DocsAgent, SIDE_BY_SIDE } from "./docs-agent";
import { DocsChat } from "./docs-chat";

/**
 * Spacious' DocsLayout with CopilotKit in its `aiChat` slot, following
 * Fumadocs' "Ask AI" guide. One chat per tab: it lives as long as the page.
 * Used by `/docs` and the prototypes' docs pages.
 */
export function DocsLayout({
  agent,
  children,
  ...props
}: DocsLayoutProps & {
  /** Where this layout keeps the reader's stack, for the agent. */
  agent?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint
      // Its floating button would sit over the chat's close button.
      enableInspector={false}
    >
      <SpaciousLayout
        {...props}
        aiChat={{ open, onOpenChange: setOpen, panel: <ChatPanel /> }}
      >
        <DocsAgent />
        {agent}
        {children}
        {open ? null : <AskAITrigger onOpen={() => setOpen(true)} />}
      </SpaciousLayout>
    </CopilotKitProvider>
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
  const { agent } = useAgent();
  const started = agent.messages.length > 0;

  // A docs link in an answer opens in place; where the chat floats over the
  // page, it closes to show it.
  const setOpen = props.aiChat?.onOpenChange;
  const links = useMemo(
    () => ({
      onOpen: () => {
        if (!window.matchMedia(SIDE_BY_SIDE).matches) setOpen?.(false);
      },
    }),
    [setOpen],
  );

  // The full-page chat (/ask), with this conversation carried over.
  const router = useRouter();
  const openFullPage = () => {
    if (agent.isRunning) agent.abortRun();
    stashConversation(agent.messages);
    router.push("/ask");
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-fd-background">
      <ResizeHandle />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-fd-border bg-fd-background ps-4 pe-2">
        <KiteMark />
        <h2 className="text-sm font-medium">Ask CopilotKit</h2>
        <div className="ms-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open full page"
                  onClick={openFullPage}
                  className={HEADER_BUTTON}
                />
              }
            >
              <Maximize2 />
            </TooltipTrigger>
            <TooltipContent>Open full page</TooltipContent>
          </Tooltip>
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={() => props.aiChat?.onOpenChange(false)}
            className={HEADER_BUTTON}
          >
            <X />
          </Button>
        </div>
      </header>
      <DocsChat links={links} />
    </div>
  );
}
