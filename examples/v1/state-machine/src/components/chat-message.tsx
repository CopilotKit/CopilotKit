import { UserMessageProps, AssistantMessageProps } from "@copilotkit/react-ui";
import { Markdown } from "@copilotkit/react-ui";

function normalizeMarkdownContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content))
    return content.map((c) => normalizeMarkdownContent(c)).join("");

  if (typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  return String(content);
}

export function UserMessage({ message }: UserMessageProps) {
  const content = normalizeMarkdownContent(message?.content);

  return (
    <div className="flex flex-row-reverse items-start gap-4 px-6 py-4">
      {/* Avatar */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border-2 border-neutral-200 bg-white">
        <div className="flex h-full w-full items-center justify-center">
          <svg className="text-primary h-6 w-6" viewBox="0 0 24 24" fill="none">
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
      <div className="relative max-w-[80%] rounded-2xl rounded-tr-sm border border-neutral-200 bg-white px-4 py-2 text-sm leading-relaxed shadow-sm">
        <div className="mb-1 font-medium text-blue-600">You</div>
        {content}
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  subComponent,
  isLoading,
}: AssistantMessageProps) {
  const content = normalizeMarkdownContent(message?.content);

  return (
    <div className="flex items-start gap-4 px-6 py-4">
      {/* Avatar */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border-2 border-neutral-200 bg-white">
        <div className="flex h-full w-full items-center justify-center">
          <svg
            className="h-6 w-6 text-pink-600"
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
      {(message || isLoading) && (
        <div className="relative max-w-[80%] rounded-2xl rounded-tl-sm border border-neutral-200 bg-white px-4 py-2 text-sm leading-relaxed shadow-sm">
          <div className="mb-1 font-medium text-pink-600">Fio</div>
          {isLoading ? (
            <div className="flex items-center gap-2 p-1">
              <div className="h-2 w-2 animate-bounce rounded-full bg-pink-600 [animation-delay:-0.3s]"></div>
              <div className="h-2 w-2 animate-bounce rounded-full bg-pink-600 [animation-delay:-0.15s]"></div>
              <div className="h-2 w-2 animate-bounce rounded-full bg-pink-600"></div>
            </div>
          ) : (
            <>{content && <Markdown content={content} />}</>
          )}
        </div>
      )}
      {subComponent}
    </div>
  );
}
