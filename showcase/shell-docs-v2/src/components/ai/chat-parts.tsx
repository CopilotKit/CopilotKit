"use client";

import {
  createContext,
  isValidElement,
  useContext,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  CopilotChatAssistantMessage,
  type CopilotChatView,
} from "@copilotkit/react-core/v2";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import Link from "fumadocs-core/link";
import { ArrowUp, Plus } from "lucide-react";
import { STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { brandDark, brandLight } from "@/proto/code-theme";
import { cn } from "@/lib/cn";
import answerStyles from "./chat-answer.module.css";
import { useDocsChatSession } from "./chat-session";

/*
 * The "Ask CopilotKit" chat's own pieces, passed to CopilotChat through its
 * slots: the empty state, the composer, the send button, code, and links.
 * One white surface with hairlines, so the conversation is the loudest
 * thing in the panel.
 */

/** CopilotKit's kite in its own colors, the header's only mark. */
export function KiteMark() {
  return (
    <span aria-hidden className="flex shrink-0">
      <FrameworkLogo slug="built-in-agent" size={18} />
    </span>
  );
}

type WelcomeProps = ComponentProps<typeof CopilotChatView.WelcomeScreen>;

/**
 * The empty chat: what to ask and how answers are made, with the composer
 * right under them, all centered. Once a message is sent, CopilotChat moves
 * the composer to the bottom.
 */
export function ChatWelcome({ input }: WelcomeProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-8">
      <div className="px-4">
        <h2
          className={cn(
            "text-center text-2xl leading-[1.25] font-medium tracking-[-0.03em] text-balance",
            RISE_IN,
          )}
        >
          How can we help?
        </h2>
        <p
          className={cn(
            "mx-auto mt-2 max-w-xs text-center text-sm leading-6 text-pretty text-fd-muted-foreground",
            RISE_IN,
          )}
          style={{ animationDelay: "70ms" }}
        >
          Ask about CopilotKit or AG-UI in your own words. It searches the docs
          and source before it answers, and links the pages it used.
        </p>
      </div>
      <div className={cn("mt-6", RISE_IN)} style={{ animationDelay: "140ms" }}>
        {input}
      </div>
    </div>
  );
}

/** Homepage uses CopilotChat's own input and suggestion submission lifecycle. */
export function HomeChatWelcome({ input, suggestionView }: WelcomeProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-6">
      <h2 className="px-4 text-center text-2xl font-medium tracking-tight">
        What are you building?
      </h2>
      <div className="mt-6">{input}</div>
      <div className="mt-3 px-4">{suggestionView}</div>
    </div>
  );
}

/**
 * The welcome's one entrance: each piece rises 6px and fades in, in turn
 * (`rise-in` in theme.css). Nothing moves for reduced motion.
 */
const RISE_IN =
  "motion-safe:animate-[rise-in_480ms_cubic-bezier(0.25,1,0.5,1)_both]";

/**
 * The composer, through CopilotChatInput's own layout slot: one field on the
 * panel's white, with "add an image" and send inside it. Images can also be
 * dropped on the chat or pasted (CopilotChat's attachments).
 */
export function ChatComposer({
  textArea,
  sendButton,
  onAddFile,
}: {
  textArea: ReactNode;
  sendButton: ReactNode;
  onAddFile?: () => void;
}) {
  return (
    <div className="pointer-events-auto bg-fd-background px-3 pt-2 pb-3">
      <div
        className="flex cursor-text items-end gap-2 rounded-xl border border-input bg-fd-background p-1.5 ps-3 transition-[border-color,box-shadow] duration-200 focus-within:border-fd-primary/50 focus-within:ring-3 focus-within:ring-fd-primary/15 motion-reduce:transition-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            e.currentTarget.querySelector("textarea")?.focus();
          }
        }}
      >
        {onAddFile ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Add an image"
                  onClick={onAddFile}
                  className="-ms-1.5 size-8 shrink-0 rounded-full text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground max-md:size-10"
                />
              }
            >
              <Plus className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              Add an image, or drop one here
            </TooltipContent>
          </Tooltip>
        ) : null}
        {textArea}
        {sendButton}
      </div>
    </div>
  );
}

/** The textarea's slot props: brand type, room for the context row below. */
export const CHAT_TEXTAREA = {
  className:
    "block min-w-0 flex-1 max-h-40 py-1.5 text-[16px]! leading-6 sm:text-sm! placeholder:text-fd-muted-foreground!",
};

/** Send (and stop): the primary pill's plum, as a round icon button. */
export function ChatSendButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      size="icon"
      {...props}
      className={cn(
        "size-8 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85 disabled:bg-foreground/15 disabled:text-fd-muted-foreground disabled:opacity-100 max-md:size-10 [&_svg]:size-4",
        className,
      )}
    >
      {children ?? <ArrowUp />}
    </Button>
  );
}

/**
 * Code in answers, as in the docs: inline code is the lilac chip, and blocks
 * are Fumadocs' own code block in the brand theme on the matrix's stage. Streamdown marks inline code
 * by its node staying on one line.
 */
export function ChatCode({
  node,
  className,
  children,
}: {
  node?: { position?: { start: { line: number }; end: { line: number } } };
  className?: string;
  children?: ReactNode;
}) {
  const inline =
    node?.position && node.position.start.line === node.position.end.line;
  if (inline) {
    return (
      <code className="not-prose rounded-md bg-fd-primary/10 px-1 py-px font-mono text-[0.85em] text-fd-primary">
        {children}
      </code>
    );
  }
  const lang = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? "text";
  const text =
    typeof children === "string"
      ? children
      : isValidElement<{ children?: unknown }>(children) &&
          typeof children.props.children === "string"
        ? children.props.children
        : String(children ?? "");
  // Answers sit in a narrow column, so every block takes the compact frame.
  return (
    <Stage compact className="my-3 shadow-none">
      <DynamicCodeBlock
        lang={lang}
        code={text.replace(/\n$/, "")}
        // The language names the bar, which also keeps copy off the code.
        codeblock={{
          title: lang === "text" ? "Code" : lang,
          className: `my-0 ${STAGE_WINDOW}`,
        }}
        options={{ themes: { light: brandLight, dark: brandDark } }}
      />
    </Stage>
  );
}

/** This site serves the docs at their docs.copilotkit.ai URLs. */
const DOCS_ORIGIN = "https://docs.copilotkit.ai";

/** A link's path on this site, or null when it leaves the docs. */
function sitePath(href: string) {
  try {
    const here = typeof window === "undefined" ? DOCS_ORIGIN : location.origin;
    const url = new URL(href, here);
    if (url.origin !== here && url.origin !== DOCS_ORIGIN) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/**
 * Links in answers: a docs page opens in place, like `open_page`, closing
 * the chat where it floats over the page. Other sites open in a new tab.
 */
export function ChatLink({
  href = "",
  children,
  // Streamdown marks every link to open a new tab; this decides instead.
  node: _node,
  target: _target,
  rel: _rel,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const session = useDocsChatSession();
  const path = sitePath(href);
  if (!path) {
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link {...props} href={path} onClick={() => session?.followLink()}>
      {children}
    </Link>
  );
}

/** The answer's type: one scale for any markdown (chat-answer.module.css). */
export const CHAT_MARKDOWN = answerStyles.answer;

export type Rating = "up" | "down";
type AssistantMessageProps = ComponentProps<typeof CopilotChatAssistantMessage>;

/** The reader's ratings by message id, and how to rate (docs-layout.tsx). */
export const RatingsContext = createContext<{
  ratings: Record<string, Rating>;
  rate: (message: AssistantMessageProps["message"], rating: Rating) => void;
}>({ ratings: {}, rate: () => {} });

/** The rated thumb stays lilac, and says so to assistive tech. */
const thumb = (pressed: boolean) => ({
  "aria-pressed": pressed,
  className: pressed ? "text-fd-primary!" : undefined,
});

/**
 * CopilotKit's own assistant message, with the answer's type and code, and
 * thumbs that rate it (the chosen one pressed; click it again to clear).
 */
function RatedAssistantMessage(props: AssistantMessageProps) {
  const { ratings, rate } = useContext(RatingsContext);
  const rating = ratings[props.message.id];
  return (
    <CopilotChatAssistantMessage
      {...props}
      markdownRenderer={{
        className: CHAT_MARKDOWN,
        components: { code: ChatCode, a: ChatLink },
      }}
      onThumbsUp={(message) => rate(message, "up")}
      onThumbsDown={(message) => rate(message, "down")}
      thumbsUpButton={thumb(rating === "up")}
      thumbsDownButton={thumb(rating === "down")}
    />
  );
}

/** With CopilotKit's statics, so it fits the `assistantMessage` slot. */
export const ChatAssistantMessage = Object.assign(
  RatedAssistantMessage,
  CopilotChatAssistantMessage,
);
