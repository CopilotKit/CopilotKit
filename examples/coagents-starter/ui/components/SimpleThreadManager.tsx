"use client";

import { useState, useEffect } from "react";

// Thread metadata structure - compatible with future RemoteThreadManager
export type ThreadMetadata = {
  id: string;
  name: string;
  createdAt: Date;
};

export function SimpleThreadManager({
  currentThreadId,
  onThreadChange,
}: {
  currentThreadId: string;
  onThreadChange: (threadId: string) => void;
}) {
  const [threads, setThreads] = useState<ThreadMetadata[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Track threads as they're created
  useEffect(() => {
    if (!threads.find(t => t.id === currentThreadId)) {
      const newThread: ThreadMetadata = {
        id: currentThreadId,
        name: `Thread #${threads.length + 1}`,
        createdAt: new Date(),
      };
      setThreads(prev => [...prev, newThread]);
    }
  }, [currentThreadId, threads]);

  const handleNewThread = () => {
    const newThreadId = crypto.randomUUID();
    onThreadChange(newThreadId);
  };

  const handleSelectThread = (threadId: string) => {
    onThreadChange(threadId);
    setIsExpanded(false);
  };

  const currentThread = threads.find(t => t.id === currentThreadId);
  const otherThreads = threads.filter(t => t.id !== currentThreadId);
  const showExpandIcon = threads.length > 1;

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg">
      {/* Header - Always visible */}
      <div className="flex items-center gap-2 p-3">
        {/* Expand/Collapse icon - only shown when multiple threads exist */}
        {showExpandIcon && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-600 hover:text-gray-800 transition-colors"
            aria-label={isExpanded ? "Collapse thread list" : "Expand thread list"}
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Current thread name */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">
            {currentThread?.name || "Thread #1"}
          </div>
          <div className="text-xs text-gray-500 font-mono truncate">
            {currentThreadId.slice(0, 8)}...
          </div>
        </div>

        {/* New Thread button */}
        <button
          onClick={handleNewThread}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors"
          title="Create new thread"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>New</span>
        </button>
      </div>

      {/* Expanded thread list */}
      {isExpanded && otherThreads.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="p-2 space-y-1">
            {otherThreads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => handleSelectThread(thread.id)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 text-sm">
                      {thread.name}
                    </div>
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {thread.id.slice(0, 8)}...
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 ml-2">
                    {formatDate(thread.createdAt)}
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
