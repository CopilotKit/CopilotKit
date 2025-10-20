"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { CopilotKit, CopilotKitProps } from "@copilotkit/react-core";

// Thread metadata structure
export type ThreadMetadata = {
  id: string;
  name: string;
  createdAt: Date;
};

// Thread context type
interface ThreadContextType {
  currentThreadId: string;
  setCurrentThreadId: (threadId: string) => void;
  threads: ThreadMetadata[];
  createThread: () => string;
  deleteThread: (threadId: string) => void;
}

// Create the thread context
const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

// Hook to use thread context
export function useThreadContext(): ThreadContextType {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreadContext must be used within a CopilotKitWithThreads");
  }
  return context;
}

// Hook to get current thread ID
export function useCurrentThreadId(): string {
  const { currentThreadId } = useThreadContext();
  return currentThreadId;
}

// Hook to set current thread ID
export function useSetCurrentThreadId(): (threadId: string) => void {
  const { setCurrentThreadId } = useThreadContext();
  return setCurrentThreadId;
}

// Hook to get all threads
export function useThreads(): ThreadMetadata[] {
  const { threads } = useThreadContext();
  return threads;
}

// Hook to create a new thread
export function useCreateThread(): () => string {
  const { createThread } = useThreadContext();
  return createThread;
}

// Hook to delete a thread
export function useDeleteThread(): (threadId: string) => void {
  const { deleteThread } = useThreadContext();
  return deleteThread;
}

// Props for CopilotKitWithThreads
interface CopilotKitWithThreadsProps extends Omit<CopilotKitProps, 'children'> {
  children: CopilotKitProps["children"];
}

export function CopilotKitWithThreads({
  children,
  threadId,
  ...copilotKitProps
}: CopilotKitWithThreadsProps) {
  const [currentThreadId, setCurrentThreadId] = useState<string>(threadId || "");
  const [threads, setThreads] = useState<ThreadMetadata[]>([]);
  const addedThreadIds = useRef(new Set<string>());
  const threadsRef = useRef<ThreadMetadata[]>([]);

  // Initialize threadId on client side to avoid hydration mismatch
  useEffect(() => {
    if (!currentThreadId) {
      const newThreadId = threadId || crypto.randomUUID();
      setCurrentThreadId(newThreadId);
    }
  }, [currentThreadId, threadId]);

  // Keep threadsRef in sync with threads state
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // Track threads as they're created/switched to
  useEffect(() => {
    if (!currentThreadId || addedThreadIds.current.has(currentThreadId)) {
      return;
    }

    addedThreadIds.current.add(currentThreadId);

    setThreads(prev => {
      const newThread: ThreadMetadata = {
        id: currentThreadId,
        name: `Thread #${prev.length + 1}`,
        createdAt: new Date(),
      };
      return [...prev, newThread];
    });
  }, [currentThreadId]);

  // Create a new thread
  const createThread = useCallback(() => {
    const newThreadId = crypto.randomUUID();
    setCurrentThreadId(newThreadId);
    return newThreadId;
  }, []);

  const deleteThread = useCallback((threadId: string) => {
    setCurrentThreadId(current => {
      if (current !== threadId) return current;

      const remaining = threadsRef.current.filter(t => t.id !== threadId);
      return remaining.length > 0 ? remaining[0].id : current;
    });

    setThreads(prev => prev.filter(t => t.id !== threadId));
    addedThreadIds.current.delete(threadId);
  }, []);

  const contextValue: ThreadContextType = {
    currentThreadId,
    setCurrentThreadId,
    threads,
    createThread,
    deleteThread,
  };

  return (
    <ThreadContext.Provider value={contextValue}>
      <CopilotKit {...copilotKitProps} threadId={currentThreadId}>
        {children}
      </CopilotKit>
    </ThreadContext.Provider>
  );
}