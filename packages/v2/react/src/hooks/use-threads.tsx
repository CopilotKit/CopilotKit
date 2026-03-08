import { useCopilotKit } from "@/providers/CopilotKitProvider";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { phoenixExponentialBackoff } from "@copilotkitnext/shared";
import { Socket, Channel } from "phoenix";
import {
  createActionGroup,
  createReducer,
  createStore,
  createSelector,
  props,
  on,
  type Store,
  type AnyAction,
} from "@copilotkitnext/core";

export interface Thread {
  id: string;
  name: string;
  lastRunAt: string;
  lastUpdatedAt: string;
}

export interface UpdateThreadInput {
  name?: string;
}

export interface UseThreadsInput {
  userId: string;
  agentId: string;
}

export interface UseThreadsResult {
  threads: Thread[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  updateThread: (threadId: string, input: UpdateThreadInput) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

const THREADS_CHANNEL_EVENT = "thread_metadata";
const MAX_SOCKET_RETRIES = 5;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const ThreadActions = createActionGroup("Threads", {
  loaded: props<{ threads: Thread[] }>(),
  created: props<{ thread: Thread }>(),
  updated: props<{ thread: Thread }>(),
  deleted: props<{ threadId: string }>(),
  archived: props<{ threadId: string }>(),
});

// ---------------------------------------------------------------------------
// State & Reducer
// ---------------------------------------------------------------------------

interface ThreadsState {
  threads: Thread[];
}

const initialState: ThreadsState = { threads: [] };

const threadsReducer = createReducer<ThreadsState>(
  initialState,
  on(ThreadActions.loaded, (_state, { threads }) => ({ threads })),
  on(ThreadActions.created, (state, { thread }) => ({
    threads: [thread, ...state.threads],
  })),
  on(ThreadActions.updated, (state, { thread }) => ({
    threads: state.threads.map((t) => (t.id === thread.id ? thread : t)),
  })),
  on(ThreadActions.deleted, (state, { threadId }) => ({
    threads: state.threads.filter((t) => t.id !== threadId),
  })),
  on(ThreadActions.archived, (state, { threadId }) => ({
    threads: state.threads.filter((t) => t.id !== threadId),
  })),
);

const selectThreads = createSelector((s: ThreadsState) => s.threads);

export function useThreads({
  userId,
  agentId,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  const [storeRef] = useState(() => {
    const store = createStore<ThreadsState, AnyAction>({
      reducer: threadsReducer as any,
    });
    store.init();
    return { current: store };
  });

  const threads = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        const sub = storeRef.current
          .select(selectThreads)
          .subscribe(onStoreChange);
        return () => sub.unsubscribe();
      },
      [storeRef],
    ),
    () => selectThreads(storeRef.current.getState()),
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchThreadsRef = useRef<() => Promise<void>>(async () => {});
  const abortControllerRef = useRef<AbortController | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const channelRef = useRef<Channel | null>(null);

  const teardownChannel = useCallback(() => {
    channelRef.current?.leave();
    channelRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  const subscribeToUpdates = useCallback(
    (joinToken: string) => {
      teardownChannel();

      const wsUrl = copilotkit.intelligence?.wsUrl;
      if (!wsUrl) return;

      let errorCount = 0;
      const socket = new Socket(wsUrl, {
        params: { join_token: joinToken },
        reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
        rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
      });
      socket.onError(() => {
        errorCount++;
        if (errorCount >= MAX_SOCKET_RETRIES) {
          console.warn(
            `[useThreads] WebSocket failed after ${MAX_SOCKET_RETRIES} attempts, giving up`,
          );
          teardownChannel();
        }
      });
      socket.onOpen(() => {
        errorCount = 0;
      });
      socket.connect();
      socketRef.current = socket;

      const channel = socket.channel(`user_meta:${userId}`);
      channelRef.current = channel;

      channel.on(THREADS_CHANNEL_EVENT, () => {
        void fetchThreadsRef.current();
      });

      channel
        .join()
        .receive("error", () => {
          teardownChannel();
        })
        .receive("timeout", () => {
          teardownChannel();
        });
    },
    [userId, copilotkit.intelligence?.wsUrl, teardownChannel, storeRef],
  );

  const runtimeRequest = useCallback(
    async (path: string, method: string, body?: Record<string, unknown>) => {
      const runtimeUrl = copilotkit.runtimeUrl;
      if (!runtimeUrl) {
        throw new Error("Runtime URL is not configured");
      }

      const headers: Record<string, string> = {
        ...copilotkit.headers,
        "Content-Type": "application/json",
      };

      const response = await fetch(`${runtimeUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      return response;
    },
    [copilotkit.runtimeUrl, copilotkit.headers],
  );

  const updateThread = useCallback(
    async (threadId: string, input: UpdateThreadInput) => {
      await runtimeRequest(
        `/threads/${encodeURIComponent(threadId)}`,
        "PATCH",
        {
          ...input,
          userId,
        },
      );
    },
    [runtimeRequest, userId],
  );

  const archiveThread = useCallback(
    async (threadId: string) => {
      await runtimeRequest(
        `/threads/${encodeURIComponent(threadId)}/archive`,
        "POST",
        { userId },
      );
    },
    [runtimeRequest, userId],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      await runtimeRequest(
        `/threads/${encodeURIComponent(threadId)}`,
        "DELETE",
        { userId },
      );
    },
    [runtimeRequest, userId],
  );

  const fetchThreads = useCallback(async () => {
    const runtimeUrl = copilotkit.runtimeUrl;
    if (!runtimeUrl) {
      setError(new Error("Runtime URL is not configured"));
      setIsLoading(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeoutId = setTimeout(() => controller.abort("timeout"), 15_000);

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ userId, agentId });

      const response = await fetch(`${runtimeUrl}/threads?${params}`, {
        method: "GET",
        headers: { ...copilotkit.headers },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch threads: ${response.status}`);
      }

      const data = await response.json();
      storeRef.current.dispatch(
        ThreadActions.loaded({ threads: data.threads }),
      );
      if (data.joinToken) {
        subscribeToUpdates(data.joinToken);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (controller.signal.reason === "timeout") {
          setError(new Error("Request timed out"));
        } else {
          return;
        }
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [
    copilotkit.runtimeUrl,
    copilotkit.headers,
    userId,
    agentId,
    subscribeToUpdates,
    storeRef,
  ]);

  fetchThreadsRef.current = fetchThreads;

  useEffect(() => {
    fetchThreads();
    return () => {
      abortControllerRef.current?.abort();
      teardownChannel();
      storeRef.current.stop();
    };
  }, [fetchThreads, teardownChannel, storeRef]);

  return {
    threads,
    isLoading,
    error,
    refetch: fetchThreads,
    updateThread,
    archiveThread,
    deleteThread,
  };
}
