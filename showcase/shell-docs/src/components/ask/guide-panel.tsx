"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  GenerativeUISurface,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/v2/generative-ui";
import { ArrowLeft, Check, Copy, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { componentsOf, guideToMarkdown } from "./guide-markdown";
import { GUIDE_COMPONENTS, guideUI } from "./guide-ui";
import { GUIDE_TARGET, type Guide } from "./guide-state";
import styles from "./guide.module.css";

const GUIDE_DESCRIPTION =
  "The guide panel beside the chat, a docs page written for this reader. Write how-to guides here, one at a time; update this surface when the reader asks for changes.";

/** The guide as markdown, from its surface's operations and data. */
function useGuideDocument(guide: Guide | null) {
  const manager = useGenerativeUIRuntime()?.manager;
  return useCallback(() => {
    if (!guide || !manager) return null;
    const surface = manager
      .debugSurfaces()
      .find((s) => s.surfaceId === guide.surfaceId);
    if (!surface) return null;
    return guideToMarkdown(
      surface.operations,
      surface.dataModel,
      window.location.origin,
    );
  }, [guide, manager]);
}

/** The guide's title, while it streams: its first Title. */
function titleOf(operations: readonly unknown[]) {
  const title = componentsOf(operations).find(
    (node) => node.component === "Title" && typeof node.text === "string",
  );
  return (title?.text as string | undefined) ?? null;
}

/** What the reader's coding agent gets: the guide, and how to work it. */
function handoffPrompt(markdown: string) {
  return [
    "Set this up in this project by following the guide below, one step at a time. Ask CopilotKit wrote it from the CopilotKit docs. When a step needs more detail, read the docs page it links. After the last step, run the app and check what “Check it works” lists.",
    "",
    markdown,
  ].join("\n");
}

const slug = (title: string | null) =>
  (title ?? "copilotkit-guide")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "copilotkit-guide";

/**
 * The guide's outline while its first lines are on the way: the title, its
 * lead, the stack's badges, and a first step with its code, as shadcn
 * skeleton bars on the page's own white.
 */
function GuideSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col motion-reduce:[&_[data-slot=skeleton]]:animate-none"
    >
      <Skeleton className="h-10 w-4/5 rounded-lg" />
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2.5 h-4 w-2/3" />
      <div className="mt-6 flex gap-2">
        {["w-14", "w-16", "w-28"].map((w) => (
          <Skeleton key={w} className={cn("h-5 rounded-full", w)} />
        ))}
      </div>
      <Skeleton className="mt-11 h-7 w-1/2 rounded-lg" />
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2.5 h-4 w-5/6" />
      <Skeleton className="mt-5 h-28 w-full rounded-[20px]" />
    </div>
  );
}

/**
 * Where the next section will land while the agent writes it: a step's
 * outline (its heading and two lines), settling in like a section does.
 */
function NextSection() {
  return (
    <div
      aria-hidden
      className={cn(
        "mt-11 flex flex-col motion-reduce:[&_[data-slot=skeleton]]:animate-none",
        styles.next,
      )}
    >
      <Skeleton className="h-7 w-2/5 rounded-lg" />
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2.5 h-4 w-4/5" />
    </div>
  );
}

/** The guide surface's root Column, whose children are its sections. */
const SECTIONS = ".a2ui-surface > [data-a2ui-std]";

/**
 * Sections that mount together step in 80ms apart (`section-in` in
 * guide.module.css), whether the agent sent the head as one operation or
 * the whole guide at once; a section that arrives on its own settles in
 * right away. Set before the first frame, so the delay is in from the start.
 */
function useSectionStagger(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new MutationObserver((mutations) => {
      const batch: HTMLElement[] = [];
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          // A section added to the guide, or a guide (or its root) added
          // with its first sections already in it.
          if (m.target instanceof Element && m.target.matches(SECTIONS)) {
            batch.push(node);
            continue;
          }
          const roots = node.matches(SECTIONS)
            ? [node]
            : Array.from(node.querySelectorAll(SECTIONS));
          for (const root of roots) {
            batch.push(...(Array.from(root.children) as HTMLElement[]));
          }
        }
      }
      batch.slice(0, 10).forEach((section, i) => {
        section.style.animationDelay = `${i * 80}ms`;
      });
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref]);
}

/** Corner buttons: 32px, 40px on touch screens (as the chat's). */
const HEADER_BUTTON =
  "size-8 rounded-lg text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground max-md:size-10";

/**
 * copilotkit.ai's "Copy prompt" pill, the docs' hand-off to a coding agent:
 * mono, white, with the Claude and Codex marks. `compact` sits in a header.
 */
function CopyPrompt({
  getText,
  disabled,
  compact,
}: {
  getText: () => string | null;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={async () => {
        const text = getText();
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className={cn(
        "gap-2.5 rounded-full bg-card font-mono shadow-lift",
        compact ? "h-8 gap-2 px-3 text-xs max-md:h-10" : "h-11 px-4",
      )}
    >
      {copied ? (
        <Check className="text-primary" aria-hidden="true" />
      ) : (
        <Copy className="text-muted-foreground" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy prompt"}</span>
      <span
        className={cn("w-px bg-border", compact ? "h-4" : "h-5")}
        aria-hidden="true"
      />
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {["claude", "codex"].map((mark) => (
          <Image
            key={mark}
            unoptimized
            src={`/images/prompt-${mark}.webp`}
            alt=""
            width={compact ? 16 : 18}
            height={compact ? 16 : 18}
          />
        ))}
      </span>
    </Button>
  );
}

/**
 * The guide: a docs page the agent writes for this reader, beside the chat.
 * Its corner carries the hand-off (copy as a prompt, download as markdown);
 * the page itself is the guide target, drawn by the standard catalog, which
 * fills in section by section; and once it's written, the hand-off closes
 * it, where the reader finishes.
 */
export function GuidePanel({
  guide,
  onClose,
  onShowChat,
}: {
  guide: Guide | null;
  onClose: () => void;
  /** Phones: back to the chat. */
  onShowChat: () => void;
}) {
  const writing = guide?.status === "streaming";
  const ready = guide?.status === "ready";
  const title = guide ? titleOf(guide.operations) : null;
  const [scrolled, setScrolled] = useState(false);
  const article = useRef<HTMLElement>(null);
  useSectionStagger(article);
  const getDocument = useGuideDocument(guide);
  const getPrompt = () => {
    const doc = getDocument();
    return doc?.markdown ? handoffPrompt(doc.markdown) : null;
  };
  const download = () => {
    const doc = getDocument();
    if (!doc?.markdown) return;
    const url = URL.createObjectURL(
      new Blob([doc.markdown + "\n"], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(doc.title)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Your guide"
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-fd-border bg-fd-background lg:border-e"
    >
      {/* No title bar under the navbar: the guide's own title heads it, and
          its controls float in the corners, as the chat's do. Once the
          guide scrolls under them, they lift off it. */}
      <div
        className={cn(
          "absolute start-2 top-2 z-10 rounded-lg bg-fd-background transition-shadow duration-200 lg:hidden",
          scrolled && "shadow-lift",
        )}
      >
        <Button
          variant="ghost"
          aria-label="Back to the chat"
          onClick={onShowChat}
          className="h-10 gap-1.5 rounded-lg px-2.5 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
        >
          <ArrowLeft aria-hidden />
          <span className="text-sm">Chat</span>
        </Button>
      </div>
      <div
        className={cn(
          "absolute end-2 top-2 z-10 flex items-center gap-0.5 rounded-xl bg-fd-background p-0.5 transition-shadow duration-200",
          scrolled && "shadow-lift",
        )}
      >
        {writing ? (
          <span
            aria-live="polite"
            className="flex h-8 items-center gap-2 px-2.5 text-xs text-fd-muted-foreground max-md:h-10"
          >
            <Spinner
              aria-hidden
              className="size-3.5 text-brand-mint-deep dark:text-brand-mint"
            />
            Writing your guide
          </span>
        ) : (
          <span className="flex items-center gap-0.5 motion-safe:animate-[rise-in_320ms_cubic-bezier(0.25,1,0.5,1)_both]">
            <span className="me-1 max-sm:hidden">
              <CopyPrompt getText={getPrompt} disabled={!ready} compact />
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Download as markdown"
                    disabled={!ready}
                    onClick={download}
                    className={HEADER_BUTTON}
                  />
                }
              >
                <Download />
              </TooltipTrigger>
              <TooltipContent>Download as markdown</TooltipContent>
            </Tooltip>
          </span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close the guide"
                onClick={onClose}
                className={cn(HEADER_BUTTON, "max-lg:hidden")}
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>Close the guide</TooltipContent>
        </Tooltip>
      </div>
      <div
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
      >
        <article
          ref={article}
          className={cn(
            "mx-auto w-full max-w-[47.5rem] px-5 pt-16 pb-16 md:px-10 md:pt-14",
            styles.guide,
          )}
        >
          {writing && !title ? <GuideSkeleton /> : null}
          <GenerativeUISurface
            id={GUIDE_TARGET}
            ui={guideUI}
            components={GUIDE_COMPONENTS}
            description={GUIDE_DESCRIPTION}
            autoScroll={false}
          />
          {writing && title ? <NextSection /> : null}
          {ready ? (
            <footer className="mt-14 border-t border-fd-border pt-8 motion-safe:animate-[rise-in_480ms_cubic-bezier(0.25,1,0.5,1)_both]">
              <h2 className="text-xl leading-8 font-semibold">
                Hand it to your coding agent
              </h2>
              <p className="mt-1.5 max-w-[34rem] text-sm leading-6 text-fd-muted-foreground">
                Copy the guide as a prompt for Claude Code, Codex, or Cursor, or
                download it as markdown. It links every docs page it used, so
                your agent can read more.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <CopyPrompt getText={getPrompt} />
                <Button
                  variant="outline"
                  onClick={download}
                  className="h-11 gap-2 rounded-full bg-card px-4 font-mono shadow-lift"
                >
                  <Download
                    className="text-muted-foreground"
                    aria-hidden="true"
                  />
                  Download .md
                </Button>
              </div>
            </footer>
          ) : null}
        </article>
      </div>
    </section>
  );
}
