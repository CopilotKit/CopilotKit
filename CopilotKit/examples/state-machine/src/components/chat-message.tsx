import { UserMessageProps, AssistantMessageProps } from "@copilotkit/react-ui";
import { Markdown } from "@copilotkit/react-ui";

export function UserMessage({ message, rawData }: UserMessageProps) {
  return (
    <div className="flex items-start gap-4 px-6 py-4 flex-row-reverse">
      {/* Avatar */}
      <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden border-2 border-neutral-200 bg-white">
        <div className="w-full h-full flex items-center justify-center">
          <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none">
            <path d="M17.5 21.0001H6.5C5.11929 21.0001 4 19.8808 4 18.5001C4 14.4194 10 14.5001 12 14.5001C14 14.5001 20 14.4194 20 18.5001C20 19.8808 18.8807 21.0001 17.5 21.0001Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Message */}
      <div className="relative py-2 px-4 rounded-2xl rounded-tr-sm max-w-[80%] text-sm leading-relaxed bg-white border border-neutral-200 shadow-sm">
        <div className="font-medium text-blue-600 mb-1">You</div>
        {message}
      </div>
    </div>
  );
}

export function AssistantMessage({ message, subComponent, isLoading }: AssistantMessageProps) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-4 px-6 py-4">
      {/* Avatar */}
      <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden border-2 border-neutral-200 bg-white">
        <div className="w-full h-full flex items-center justify-center">
          <svg className="w-6 h-6 text-pink-600" viewBox="0 0 24 24" fill="none">
            <path d="M12 4L14 6H18C19.1046 6 20 6.89543 20 8V17C20 18.1046 19.1046 19 18 19H6C4.89543 19 4 18.1046 4 17V8C4 6.89543 4.89543 6 6 6H10L12 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 14C9 14 10 15 12 15C14 15 15 14 15 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 11H9.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M15 11H15.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      {/* Message */}
      <div className="relative py-2 px-4 rounded-2xl rounded-tl-sm max-w-[80%] text-sm leading-relaxed bg-white border border-neutral-200 shadow-sm">
        <div className="font-medium text-pink-600 mb-1">Fio</div>
        {isLoading ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
          </div>
        ) : (
          <>
            {message && <Markdown content={message ?? ""} /> }
            {subComponent}
          </>
        )}
      </div>
    </div>
  );
} 