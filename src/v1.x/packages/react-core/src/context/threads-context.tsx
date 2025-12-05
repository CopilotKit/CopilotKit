import React, { createContext, useContext, useState, ReactNode, SetStateAction } from "react";
import { randomUUID } from "@copilotkit/shared";

export interface ThreadsContextValue {
  threadId: string;
  setThreadId: (value: SetStateAction<string>) => void;
}

const ThreadsContext = createContext<ThreadsContextValue | undefined>(undefined);

export interface ThreadsProviderProps {
  children: ReactNode;
  threadId?: string;
}

export function ThreadsProvider({ children, threadId: explicitThreadId }: ThreadsProviderProps) {
  const [internalThreadId, setThreadId] = useState<string>(explicitThreadId ?? randomUUID());

  const threadId = internalThreadId;

  return (
    <ThreadsContext.Provider
      value={{
        threadId,
        setThreadId,
      }}
    >
      {children}
    </ThreadsContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadsContext);
  if (!context) {
    throw new Error("useThreads must be used within ThreadsProvider");
  }
  return context;
}

export { ThreadsContext };
