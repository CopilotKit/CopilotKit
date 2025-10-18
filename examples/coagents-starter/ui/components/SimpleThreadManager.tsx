"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import {
  useCurrentThreadId,
  useSetCurrentThreadId,
  useThreads,
  useCreateThread,
} from "./CopilotKitWithThreads";

export function SimpleThreadManager() {
  const currentThreadId = useCurrentThreadId();
  const setCurrentThreadId = useSetCurrentThreadId();
  const threads = useThreads();
  const createThread = useCreateThread();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleNewThread = () => {
    createThread();
  };

  const handleSelectThread = (threadId: string) => {
    setCurrentThreadId(threadId);
    setIsExpanded(false);
  };

  const currentThread = threads.find(t => t.id === currentThreadId);
  // Sort other threads by creation date (newest first)
  const otherThreads = threads
    .filter(t => t.id !== currentThreadId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const showExpandIcon = threads.length > 1;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200/80 min-w-[280px] max-w-[320px]">
      {/* Header - Always visible */}
      <div className="flex items-center gap-2 p-3">
        {/* Expand/Collapse icon - only shown when multiple threads exist */}
        {showExpandIcon && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center bg-gray-200 hover:bg-gray-400 rounded-full transition-colors"
            aria-label={isExpanded ? "Collapse thread list" : "Expand thread list"}
            style={{ color: 'var(--copilot-kit-primary-color)' }}
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        )}

        {/* Current thread info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">
            {currentThread?.name || "Thread #1"}
          </div>
          {currentThread && (
            <div className="text-xs text-gray-500 mt-0.5">
              {formatDate(currentThread.createdAt)}
            </div>
          )}
          <div className="text-xs text-gray-400 font-mono truncate mt-0.5 select-all">
            {currentThreadId}
          </div>
        </div>

        {/* New Thread button */}
        <button
          onClick={handleNewThread}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all hover:scale-105"
          style={{
            backgroundColor: 'var(--copilot-kit-primary-color)',
            color: 'var(--copilot-kit-contrast-color)',
          }}
          title="Create new thread"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Expanded thread list */}
      {isExpanded && otherThreads.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="p-2 space-y-1">
            {otherThreads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => handleSelectThread(thread.id)}
                className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm select-text">
                    {thread.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 select-text">
                    {formatDate(thread.createdAt)}
                  </div>
                  <div className="text-xs text-gray-400 font-mono truncate mt-0.5 select-all">
                    {thread.id}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
