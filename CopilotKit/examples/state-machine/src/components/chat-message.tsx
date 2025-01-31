import { UserMessageProps, AssistantMessageProps } from "@copilotkit/react-ui";
import { Markdown } from "@copilotkit/react-ui";

export function UserMessage({ message, rawData }: UserMessageProps) {
  return (
    <div className="flex items-start gap-4 px-6 py-4 flex-row-reverse">
      {/* Avatar */}
      <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden border-2 border-neutral-200 bg-white">
        <div className="w-full h-full flex items-center justify-center">
          <svg className="w-6 h-6 text-neutral-600" viewBox="0 0 24 24" fill="none">
            <path d="M18.685 19.097A9.723 9.723 0 0021.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 003.065 7.097A9.716 9.716 0 0012 21.75a9.716 9.716 0 006.685-2.653zm-12.54-1.285A7.486 7.486 0 0112 15a7.486 7.486 0 015.855 2.812A8.224 8.224 0 0112 20.25a8.224 8.224 0 01-5.855-2.438zM15.75 9a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
          <svg className="w-6 h-6 text-neutral-600" viewBox="0 0 24 24" fill="none">
            <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 12.75c3.182 0 6.019 1.013 7.842 2.593M16.75 16l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Message */}
      <div className="relative py-2 px-4 rounded-2xl rounded-tl-sm max-w-[80%] text-sm leading-relaxed bg-white border border-neutral-200 shadow-sm">
        <div className="font-medium text-blue-600 mb-1">Fio</div>
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