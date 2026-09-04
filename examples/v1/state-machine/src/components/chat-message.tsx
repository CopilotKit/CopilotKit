import type {
  AssistantMessage as AgUiAssistantMessage,
  Message,
  UserMessage as AgUiUserMessage,
} from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";

interface UserMessageProps {
  message: AgUiUserMessage;
}

interface AssistantMessageProps {
  message: AgUiAssistantMessage;
  messages?: Message[];
  isRunning?: boolean;
  markdownRenderer: ReactNode;
  toolCallsView: ReactNode;
}

const unsupportedMessageContent = "Unsupported message content";

function textFromContentPart(content: unknown): string | undefined {
  if (typeof content === "string") return content;

  if (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    content.type === "text" &&
    "text" in content &&
    typeof content.text === "string"
  ) {
    return content.text;
  }

  return undefined;
}

/** Convert supported message content into text without exposing protocol data. */
export function normalizeMarkdownContent(content: unknown): string {
  if (content == null) return "";

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => textFromContentPart(part))
      .filter((text): text is string => text !== undefined);

    return textParts.length > 0
      ? textParts.join("\n")
      : unsupportedMessageContent;
  }

  return textFromContentPart(content) ?? unsupportedMessageContent;
}

const mediaPartTypes = ["image", "audio", "video", "document"] as const;

type MediaPartType = (typeof mediaPartTypes)[number];

interface MediaPart {
  type: MediaPartType;
  source: { type: "data" | "url"; value: string; mimeType?: string };
  metadata?: unknown;
}

function mediaPartFrom(part: unknown): MediaPart | undefined {
  if (typeof part !== "object" || part === null) return undefined;
  if (!("type" in part) || !("source" in part)) return undefined;
  if (!mediaPartTypes.includes(part.type as MediaPartType)) return undefined;

  const { source } = part as { source: unknown };
  if (typeof source !== "object" || source === null) return undefined;
  if (!("value" in source) || typeof source.value !== "string") {
    return undefined;
  }

  return part as MediaPart;
}

/** Resolve a content part's source to something an element can load. */
function mediaPartSrc(part: MediaPart): string {
  if (part.source.type === "url") return part.source.value;

  return `data:${part.source.mimeType ?? "application/octet-stream"};base64,${part.source.value}`;
}

/** Read the filename an agent attached to a content part, when it sent one. */
function mediaPartFilename(part: MediaPart): string | undefined {
  const { metadata } = part;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  if (!("filename" in metadata)) return undefined;

  return typeof metadata.filename === "string" ? metadata.filename : undefined;
}

function MediaContentPart({ part }: { part: MediaPart }) {
  const src = mediaPartSrc(part);
  const filename = mediaPartFilename(part);

  switch (part.type) {
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- an attachment can be a data URI or an unconfigured host, which next/image rejects
        <img
          className="mt-1 max-h-60 w-auto rounded-lg"
          src={src}
          alt={filename ?? "Image attachment"}
        />
      );
    case "audio":
      return (
        <div className="mt-1 flex flex-col gap-1">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied audio has no caption track */}
          <audio className="w-full" controls src={src} />
          {filename && <span className="text-xs">{filename}</span>}
        </div>
      );
    case "video":
      return (
        <div className="mt-1 flex flex-col gap-1">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied video has no caption track */}
          <video className="max-h-60 w-full rounded-lg" controls src={src} />
          {filename && <span className="text-xs">{filename}</span>}
        </div>
      );
    case "document":
      return (
        <a
          className="mt-1 flex items-center gap-1 text-xs underline"
          href={src}
          target="_blank"
          rel="noreferrer"
        >
          {filename ?? "Document attachment"}
        </a>
      );
  }
}

/**
 * Render a user message's content parts, keeping text and attachments.
 *
 * V2 user messages can carry image, audio, video, and document parts next to
 * their text. Reducing them to markdown would drop whatever the person
 * attached, so each part renders as itself.
 */
function UserMessageContent({ content }: { content: unknown }): ReactNode {
  const parts = Array.isArray(content) ? content : [content];
  const rendered = parts
    .map((part, index) => {
      const text = textFromContentPart(part);
      if (text !== undefined) {
        return <p key={`text-${index}`}>{text}</p>;
      }

      const mediaPart = mediaPartFrom(part);
      if (mediaPart) {
        return <MediaContentPart key={`media-${index}`} part={mediaPart} />;
      }

      return undefined;
    })
    .filter((part): part is React.JSX.Element => part !== undefined);

  if (rendered.length === 0) {
    return unsupportedMessageContent;
  }

  return rendered;
}

export function UserMessage({ message }: UserMessageProps) {
  const content = <UserMessageContent content={message?.content} />;

  return (
    <div className="flex items-start gap-4 px-6 py-4 flex-row-reverse">
      {/* Avatar */}
      <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden border-2 border-neutral-200 bg-white">
        <div className="w-full h-full flex items-center justify-center">
          <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none">
            <path
              d="M17.5 21.0001H6.5C5.11929 21.0001 4 19.8808 4 18.5001C4 14.4194 10 14.5001 12 14.5001C14 14.5001 20 14.4194 20 18.5001C20 19.8808 18.8807 21.0001 17.5 21.0001Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Message */}
      <div className="relative py-2 px-4 rounded-2xl rounded-tr-sm max-w-[80%] text-sm leading-relaxed bg-white border border-neutral-200 shadow-sm">
        <div className="font-medium text-blue-600 mb-1">You</div>
        {content}
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  messages,
  isRunning,
  markdownRenderer,
  toolCallsView,
}: AssistantMessageProps) {
  const content = normalizeMarkdownContent(message?.content);
  const isLatestMessage = messages?.[messages.length - 1]?.id === message.id;
  const showLoading = Boolean(isRunning && isLatestMessage && !content);

  return (
    <div className="flex items-start gap-4 px-6 py-4">
      {/* Avatar */}
      <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden border-2 border-neutral-200 bg-white">
        <div className="w-full h-full flex items-center justify-center">
          <svg
            className="w-6 h-6 text-pink-600"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M12 4L14 6H18C19.1046 6 20 6.89543 20 8V17C20 18.1046 19.1046 19 18 19H6C4.89543 19 4 18.1046 4 17V8C4 6.89543 4.89543 6 6 6H10L12 4Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 14C9 14 10 15 12 15C14 15 15 14 15 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 11H9.01"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M15 11H15.01"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Message */}
      {(content || showLoading) && (
        <div className="relative py-2 px-4 rounded-2xl rounded-tl-sm max-w-[80%] text-sm leading-relaxed bg-white border border-neutral-200 shadow-sm">
          <div className="font-medium text-pink-600 mb-1">Fio</div>
          {showLoading ? (
            <div className="flex items-center gap-2 p-1">
              <div className="w-2 h-2 bg-pink-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-2 h-2 bg-pink-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-2 h-2 bg-pink-600 rounded-full animate-bounce" />
            </div>
          ) : (
            markdownRenderer
          )}
        </div>
      )}
      {toolCallsView}
    </div>
  );
}
