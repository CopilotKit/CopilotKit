import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useState, useEffect, useCallback, useRef } from "react";
import { phoenixExponentialBackoff } from "@copilotkitnext/shared";
import { Socket, Channel } from "phoenix";

export interface Thread {
  id: string;
  name: string;
  lastRunAt: string;
  lastUpdatedAt: string;
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
}

const THREADS_CHANNEL_EVENT = "threads:update";

export function useThreads({
  userId,
  agentId,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
    (joinCode: string) => {
      teardownChannel();

      const runtimeUrl = copilotkit.runtimeUrl;
      if (!runtimeUrl) return;

      // Derive the websocket URL from the runtime HTTP URL.
      const wsUrl = runtimeUrl
        .replace(/^http/, "ws")
        .replace(/\/$/, "")
        .concat("/socket");

      const socket = new Socket(wsUrl, {
        params: { joinCode },
        reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
        rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
      });
      socket.connect();
      socketRef.current = socket;

      const channel = socket.channel(`threads:${agentId}`, { joinCode });
      channelRef.current = channel;

      channel.on(THREADS_CHANNEL_EVENT, (_payload: unknown) => {
        // TODO: reduce the CRUD update into the threads list via NgRx-style reducer
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
    [agentId, copilotkit.runtimeUrl, teardownChannel],
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
      setThreads(data.threads);
      subscribeToUpdates(data.joinCode);
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
  }, [copilotkit.runtimeUrl, copilotkit.headers, userId, agentId, subscribeToUpdates]);

  useEffect(() => {
    fetchThreads();
    return () => {
      abortControllerRef.current?.abort();
      teardownChannel();
    };
  }, [fetchThreads, teardownChannel]);

  return { threads, isLoading, error, refetch: fetchThreads };
}
