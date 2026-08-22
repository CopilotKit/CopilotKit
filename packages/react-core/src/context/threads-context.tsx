import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  ReactNode,
  SetStateAction,
} from "react";
import { randomUUID } from "@copilotkit/shared";

export interface ThreadsContextValue {
  threadId: string;
  setThreadId: (value: SetStateAction<string>) => void;
  // True when the current threadId was chosen by the caller — either via
  // the `threadId` prop on <CopilotKit> / <ThreadsProvider>, or via a later
  // setThreadId() call. False when the provider minted a UUID on first
  // mount so downstream consumers don't have to treat that placeholder as
  // a real backend thread.
  isThreadIdExplicit: boolean;
}

const ThreadsContext = createContext<ThreadsContextValue | undefined>(
  undefined,
);

export interface ThreadsProviderProps {
  children: ReactNode;
  threadId?: string;
}

export function ThreadsProvider({
  children,
  threadId: explicitThreadId,
}: ThreadsProviderProps) {
  const [internalThreadId, setInternalThreadId] = useState<string>(() =>
    randomUUID(),
  );
  const [internalIsExplicit, setInternalIsExplicit] = useState<boolean>(false);

  const threadId = explicitThreadId ?? internalThreadId;
  const isThreadIdExplicit = explicitThreadId != null || internalIsExplicit;

  const setThreadId = useCallback((value: SetStateAction<string>) => {
    setInternalThreadId(value);
    setInternalIsExplicit(true);
  }, []);

  return (
    <ThreadsContext.Provider
      value={{
        threadId,
        setThreadId,
        isThreadIdExplicit,
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
