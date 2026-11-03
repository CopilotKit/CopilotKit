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
  type Suggestion,
} from "@copilotkit/react-core/v2";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import Link from "fumadocs-core/link";
import { useTreePath } from "fumadocs-ui/contexts/tree";
import { ArrowUp, Plus } from "lucide-react";
import { PixelMatrix } from "@/components/brand/pixel-matrix";
import { MATRIX_GROUND, STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import {
  GenerativeUIGlyph,
  HumanInTheLoopGlyph,
  OpenPageGlyph,
  PageGlyph,
  QuickstartGlyph,
  SourcesGlyph,
  StackGlyph,
} from "@/components/icons/glyphs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { brandDark, brandLight } from "@/proto/code-theme";
import { cn } from "@/lib/cn";
import answerStyles from "./chat-answer.module.css";
import welcomeStyles from "./chat-welcome.module.css";

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

/**
 * Where the welcome's matrix sparkles: single squares light up and fade, in
 * turn, around the kite (`sparkle` in chat-welcome.module.css). Percent of
 * the badge, kept to the ring between the kite's disc and the rim.
 */
const SPARKLES = [
  [24, 30],
  [70, 20],
  [82, 56],
  [58, 80],
  [28, 72],
  [16, 48],
  [46, 14],
  [86, 38],
  [40, 86],
  [74, 72],
];

/**
 * The welcome's badge: the kite on a white disc, in a circle of the home's
 * blue stage with its white rim, the pixel matrix glistening and sparkling
 * around it, so the mark pops.
 */
function WelcomeBadge() {
  return (
    <div
      aria-hidden
      className={cn(
        "relative isolate mx-auto flex size-32 items-center justify-center rounded-full border-[1.5px] border-stage-rim shadow-lift-stage [@media(max-height:760px)]:size-24",
        MATRIX_GROUND,
      )}
    >
      <PixelMatrix interactive glisten />
      <div className={welcomeStyles.sparkles}>
        {SPARKLES.map(([x, y], i) => (
          <span
            key={i}
            className={welcomeStyles.sparkle}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              animationDelay: `${(i * 0.53).toFixed(2)}s`,
            }}
          />
        ))}
      </div>
      <div
        className={cn(
          "relative size-14 [@media(max-height:760px)]:size-12",
          welcomeStyles.settle,
        )}
      >
        <span
          className={cn(
            "absolute inset-0 rounded-full border-2 border-white",
            welcomeStyles.sonar,
          )}
        />
        <span className="relative flex size-full items-center justify-center rounded-full border border-white/80 bg-white shadow-[0_10px_24px_rgb(20_16_33/0.2)] dark:border-white/10 dark:bg-fd-background">
          <FrameworkLogo slug="built-in-agent" size={28} />
        </span>
      </div>
    </div>
  );
}

type WelcomeProps = ComponentProps<typeof CopilotChatView.WelcomeScreen>;

/**
 * The empty chat: the badge, what to ask, and four suggestions, centered
 * over the composer, which sits at the bottom as it does once the chat
 * starts. Everything rises in at once; the suggestions keep their place
 * until they load, then fade in together. On a short screen the badge and
 * the cards get smaller, and when it still doesn't fit the welcome scrolls
 * from its top instead of clipping the badge. The kite pulses while the
 * reader writes.
 */
export function ChatWelcome({
  input,
  suggestionView,
  lead,
}: WelcomeProps & {
  /** A line under the heading, where the chat has room for it. */
  lead?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", welcomeStyles.welcome)}>
      <div className="flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto px-3 pt-6 pb-[6vh] [@media(max-height:760px)]:pt-4 [@media(max-height:760px)]:pb-4">
        <div className={RISE_IN}>
          <WelcomeBadge />
        </div>
        <h2
          className={cn(
            "mt-6 text-center text-[1.75rem] leading-[1.15] font-normal tracking-[-0.03em] text-balance [@media(max-height:760px)]:mt-4",
            RISE_IN,
          )}
        >
          How can we help?
        </h2>
        {lead ? (
          <p
            className={cn(
              "mx-auto mt-3 max-w-[30rem] text-center text-sm leading-6 text-balance text-fd-muted-foreground [@media(max-height:760px)]:mt-2",
              RISE_IN,
            )}
          >
            {lead}
          </p>
        ) : null}
        <div className="mt-6 [@media(max-height:760px)]:mt-4">
          {suggestionView}
        </div>
      </div>
      <div className={RISE_IN}>{input}</div>
    </div>
  );
}

/** Each suggestion's glyph and its muted line, by its title (docs-agent.tsx). */
const SUGGESTION_CARDS: Record<
  string,
  { Glyph: typeof PageGlyph; detail: string | null }
> = {
  "Explain this page": { Glyph: PageGlyph, detail: null },
  "Set up my stack": { Glyph: StackGlyph, detail: "Step by step, for yours" },
  "Open the quickstart": {
    Glyph: OpenPageGlyph,
    detail: "Opens beside this chat",
  },
  "How AG-UI works": { Glyph: SourcesGlyph, detail: "The protocol, briefly" },
  // The full-page chat's (ask-agent.tsx): three of them write a guide.
  "Build your quickstart": {
    Glyph: QuickstartGlyph,
    detail: "A few questions, then your guide",
  },
  "Add generative UI": {
    Glyph: GenerativeUIGlyph,
    detail: "A guide for your app",
  },
  "Add human approval": {
    Glyph: HumanInTheLoopGlyph,
    detail: "Approvals in your chat",
  },
};

/**
 * The suggestions, through CopilotChat's `suggestionView` slot: four cards
 * in two columns, each a glyph on the stage-blue tile, a title, and a muted
 * line (the page it will explain, or what it does). A click sends it. Only
 * before the first message (`available` in docs-agent.tsx). Until they load,
 * four hidden cards hold their place, so nothing moves when they arrive;
 * then they fade in as one. On a short screen a card with room for it
 * puts its glyph beside its text.
 */
export function ChatSuggestions({
  suggestions,
  onSelectSuggestion,
  loadingIndexes,
}: {
  suggestions: Suggestion[];
  onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
  loadingIndexes?: ReadonlyArray<number>;
}) {
  const page = useTreePath().at(-1);
  const pageTitle =
    page?.type === "page" && typeof page.name === "string" ? page.name : null;
  if (suggestions.length === 0) {
    return (
      <ul aria-hidden className="invisible grid grid-cols-2 gap-2">
        {PLACEHOLDERS.map((s) => (
          <li key={s.title} className="@container flex">
            <SuggestionCard suggestion={s} detail="Loading" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={cn("grid grid-cols-2 gap-2", FADE_IN)}>
      {suggestions.map((s, i) => {
        const card = SUGGESTION_CARDS[s.title];
        const detail = card ? (card.detail ?? pageTitle ?? "This page") : null;
        return (
          <li key={s.title} className="@container flex">
            <SuggestionCard
              suggestion={s}
              detail={detail}
              disabled={s.isLoading || loadingIndexes?.includes(i)}
              onClick={() => onSelectSuggestion?.(s, i)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Stand-ins that size the grid before the suggestions load. */
const PLACEHOLDERS = Array.from({ length: 4 }, (_, i) => ({
  title: `Suggestion ${i + 1}`,
  message: "",
}));

/** One suggestion: its glyph on the stage-blue tile, title, and muted line. */
function SuggestionCard({
  suggestion,
  detail,
  disabled,
  onClick,
}: {
  suggestion: { title: string };
  detail: string | null;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Glyph = SUGGESTION_CARDS[suggestion.title]?.Glyph ?? SourcesGlyph;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group/card flex w-full cursor-pointer flex-col items-start gap-3 rounded-xl border border-fd-border bg-fd-background p-3 text-start shadow-lift transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-edge-action hover:shadow-lift-hover focus-visible:border-fd-primary focus-visible:ring-3 focus-visible:ring-fd-primary/15 focus-visible:outline-none disabled:cursor-progress disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0 [@media(max-height:760px)]:@min-[14rem]:flex-row [@media(max-height:760px)]:@min-[14rem]:items-center"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/50 bg-(image:--glyph-tile) text-white shadow-[0_2px_6px_rgb(76_92_214/0.3)] dark:border-white/15">
        <Glyph className="size-4.5" />
      </span>
      <span className="w-full min-w-0">
        <span className="block text-sm leading-5 font-semibold">
          {suggestion.title}
        </span>
        {detail ? (
          <span className="block truncate text-xs leading-5 text-fd-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The welcome's one entrance: everything rises 6px and fades in together
 * (`rise-in` in theme.css), and the suggestions fade in when they load.
 * Nothing moves for reduced motion.
 */
const RISE_IN =
  "motion-safe:animate-[rise-in_320ms_cubic-bezier(0.25,1,0.5,1)_both]";
const FADE_IN =
  "motion-safe:animate-[rise-in_240ms_cubic-bezier(0.25,1,0.5,1)_both]";

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
          // Its own tooltip group: the panel slides the composer under the
          // pointer that just clicked the chat's button, whose open tooltip
          // would otherwise make this one open at once. Only a deliberate
          // hover shows it.
          <TooltipProvider delay={500}>
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
          </TooltipProvider>
        ) : null}
        {textArea}
        {sendButton}
      </div>
    </div>
  );
}

/** The textarea's slot props: brand type, room for the context row below. */
export const CHAT_TEXTAREA = {
  // CopilotKit sets `overflow: auto` inline as it sizes the field, which can
  // flash scrollbars; the field never scrolls sideways, and long input still
  // scrolls up and down without a bar.
  className:
    "block min-w-0 flex-1 max-h-40 py-1.5 text-[16px]! leading-6 sm:text-sm! placeholder:text-fd-muted-foreground! overflow-x-hidden! [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden",
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
 * Where answers open docs pages. The docs' side chat opens them in place and
 * closes where it floats over the page (`onOpen`, docs-layout.tsx); the
 * full-page chat opens them in a new tab, so the conversation stays.
 */
export const ChatLinkContext = createContext<{
  newTab?: boolean;
  onOpen?: () => void;
}>({});

/**
 * Links in answers: a docs page opens in place, like `open_page` (or in a
 * new tab from the full-page chat). Other sites open in a new tab.
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
  const { newTab, onOpen } = useContext(ChatLinkContext);
  const path = sitePath(href);
  if (!path || newTab) {
    return (
      <a
        {...props}
        href={path ?? href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }
  return (
    <Link {...props} href={path} onClick={onOpen}>
      {children}
    </Link>
  );
}

/** The answer's type: one scale for any markdown (chat-answer.module.css). */
export const CHAT_MARKDOWN = answerStyles.answer;

/**
 * The "Worked for 4s" row (`toolCallDisplay: "turn"`), without its tool
 * count: the time says how long, and the folded work says what it did.
 */
export const CHAT_WORK_SUMMARY = answerStyles.workSummary;

export type Rating = "up" | "down";
type AssistantMessageProps = ComponentProps<typeof CopilotChatAssistantMessage>;

/** The reader's ratings by message id, and how to rate (docs-layout.tsx). */
export const RatingsContext = createContext<{
  ratings: Record<string, Rating>;
  rate: (message: AssistantMessageProps["message"], rating: Rating) => void;
}>({ ratings: {}, rate: () => {} });

/**
 * The answer's actions (copy, thumbs), sized to its 14px type: 14px glyphs
 * in 28px buttons, in the docs' muted ink with the hover grey, aligned to the
 * text's left edge, 8px under it.
 */
const TOOLBAR =
  "-ms-[7px]! mt-2! [&_button]:size-7! [&_button]:rounded-md [&_button:hover]:bg-fd-accent! [&_button:not([aria-pressed=true])]:text-fd-muted-foreground! [&_button:not([aria-pressed=true]):hover]:text-fd-foreground! [&_svg]:size-3.5!";

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
      toolbar={{ className: TOOLBAR }}
    />
  );
}

/** With CopilotKit's statics, so it fits the `assistantMessage` slot. */
export const ChatAssistantMessage = Object.assign(
  RatedAssistantMessage,
  CopilotChatAssistantMessage,
);
