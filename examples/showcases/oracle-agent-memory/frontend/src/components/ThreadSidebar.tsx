"use client";

import type { Thread } from "@/lib/threads";

interface ThreadSidebarProps {
  threads: Thread[];
  activeThreadId: string;
  collapsed: boolean;
  onToggle: () => void;
  onNewThread: () => void;
  onSelectThread: (id: string) => void;
}

export function ThreadSidebar({
  threads,
  activeThreadId,
  collapsed,
  onToggle,
  onNewThread,
  onSelectThread,
}: ThreadSidebarProps) {
  return (
    <div
      className="h-full shrink-0 min-w-0 overflow-hidden border-r border-gray-200 bg-white flex flex-col"
      style={{ width: collapsed ? "3.5rem" : "16rem" }}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 pt-3 px-2">
          <button
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 text-lg"
          >
            &#9776;
          </button>
          <button
            onClick={onNewThread}
            aria-label="New thread"
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 text-lg font-semibold"
          >
            +
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <span className="text-sm font-semibold text-gray-800 tracking-wide">
              Conversations
            </span>
            <button
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-500"
            >
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="10 4 6 8 10 12" />
                <polyline points="6 4 2 8 6 12" />
              </svg>
            </button>
          </div>

          <div className="px-3 py-3 shrink-0">
            <button
              onClick={onNewThread}
              className="w-full bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              + New thread
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {threads.map((t) => {
              const isActive = t.id === activeThreadId;
              return (
                <button
                  key={t.id}
                  data-testid="thread-item"
                  data-active={isActive}
                  onClick={() => onSelectThread(t.id)}
                  className={`w-full text-left rounded-lg px-3 py-2 mb-1 transition-colors ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <div className="truncate text-sm leading-snug">{t.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
