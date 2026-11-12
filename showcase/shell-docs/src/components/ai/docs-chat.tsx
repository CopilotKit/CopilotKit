"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import { usePathname } from "next/navigation";
import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import { sendAnswerFeedback } from "@/lib/feedback";
import { cn } from "@/lib/cn";
import {
  CHAT_TEXTAREA,
  CHAT_WORK_SUMMARY,
  ChatAssistantMessage,
  ChatComposer,
  ChatLinkContext,
  ChatSendButton,
  ChatSuggestions,
  ChatWelcome,
  RatingsContext,
  type Rating,
} from "./chat-parts";

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

/** The conversation's column on a full page: the docs' reading measure. */
const COLUMN = "mx-auto w-full max-w-[46rem]";

/**
 * The "Ask CopilotKit" conversation: CopilotKit's `CopilotChat` through its
 * slots, with the error line over it and thumbs that rate each answer. The
 * docs' side chat and the full-page chat (/ask) are both this, so they look
 * and behave the same; on a full page (`column`) the messages, the welcome,
 * and the composer keep to one centered column.
 */
export function DocsChat({
  column = false,
  lead,
  links,
}: {
  /** Keep the conversation to a centered column, on a full page. */
  column?: boolean;
  /** A line under the welcome's heading. */
  lead?: string;
  /** How answers open docs pages (ChatLinkContext). */
  links: ComponentProps<typeof ChatLinkContext>["value"];
}) {
  const { agent } = useAgent();
  const started = agent.messages.length > 0;
  // The last error, and whether the chat had started then: a new chat
  // clears an error from the conversation before it.
  const [failure, setFailure] = useState<{
    message: string;
    started: boolean;
  } | null>(null);
  const setError = useCallback(
    (message: string | null) =>
      setFailure(message ? { message, started } : null),
    [started],
  );
  const error =
    failure && (started || !failure.started) ? failure.message : null;

  // A new run clears the last error.
  useEffect(
    () =>
      agent.subscribe({ onRunInitialized: () => setFailure(null) }).unsubscribe,
    [agent],
  );

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

  // One component per layout, so the welcome doesn't remount (and replay its
  // entrance) on every render.
  const welcome = useMemo(
    () =>
      function Welcome(props: ComponentProps<typeof ChatWelcome>) {
        const body = <ChatWelcome {...props} lead={lead} />;
        return column ? (
          <div className={cn(COLUMN, "flex min-h-0 flex-1 flex-col")}>
            {body}
          </div>
        ) : (
          body
        );
      },
    [column, lead],
  );

  return (
    <>
      {error && (
        <p
          role="alert"
          className="border-b border-fd-error/30 bg-fd-error/8 px-4 py-2 text-xs leading-5 text-fd-foreground"
        >
          <span className={cn(column && COLUMN, "block")}>{error}</span>
        </p>
      )}
      <ChatLinkContext value={links}>
        <RatingsContext value={ratingsValue}>
          <CopilotChat
            className="min-h-0 flex-1 bg-fd-background"
            onError={(event) => {
              if ("error" in event) setError(readableError(event.error));
            }}
            labels={{
              chatInputPlaceholder: "Ask anything",
              welcomeMessageText: "How can we help?",
            }}
            welcomeScreen={welcome}
            // Welcome suggestions only: a conversation handed over from the
            // side chat starts with messages the suggestions don't know of.
            suggestionView={{
              children: (p) => (started ? null : <ChatSuggestions {...p} />),
            }}
            // A sent question pins to the top and the answer fills in under
            // it, instead of the view chasing the bottom as it streams.
            autoScroll="pin-to-send"
            // Screenshots of an error or a UI: "+" picks one, or drop or
            // paste it.
            attachments={{
              enabled: true,
              accept: "image/*",
              maxSize: 3 * 1024 * 1024,
              onUploadFailed: (e) => setError(e.message),
            }}
            input={{
              textArea: CHAT_TEXTAREA,
              sendButton: ChatSendButton,
              children: ({ textArea, sendButton, onAddFile }) => (
                <div className={cn(column && COLUMN)}>
                  <ChatComposer
                    textArea={textArea}
                    sendButton={sendButton}
                    onAddFile={onAddFile}
                  />
                </div>
              ),
            }}
            messageView={{
              className: cn("px-4 pt-4 pb-2", column && `${COLUMN} md:px-6`),
              // A reply's searches and thinking fold into one "Worked for" row.
              toolCallDisplay: "turn",
              workSummary: {
                className: cn(
                  "py-0.5 text-xs! leading-5 text-fd-muted-foreground!",
                  CHAT_WORK_SUMMARY,
                ),
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
              // The question in the answer's type (CopilotKit's prose would
              // set it larger), without a copy row under it, and room under
              // it so the reply starts clear of it.
              userMessage: {
                className: "pt-6! pb-4!",
                messageRenderer: {
                  className:
                    "max-w-[85%] rounded-2xl rounded-br-md bg-fd-secondary! px-3.5! py-2! text-sm! leading-6! text-fd-foreground!",
                },
                toolbar: { className: "hidden!" },
              },
            }}
          />
        </RatingsContext>
      </ChatLinkContext>
    </>
  );
}
