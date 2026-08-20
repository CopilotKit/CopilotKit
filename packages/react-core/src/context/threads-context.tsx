/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — ThreadsContext:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — ThreadsContextValue:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — ThreadsProvider:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — ThreadsProviderProps:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — useThreads:
 *   V2 import and usage:
 *     import { useThreads } from "@copilotkit/react-core/v2";
 *     useThreads({});
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-threads.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useThreads
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
