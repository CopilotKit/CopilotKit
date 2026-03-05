import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useState, useEffect, useCallback, useRef } from "react";

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

export function useThreads({
  userId,
  agentId,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

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
  }, [copilotkit.runtimeUrl, copilotkit.headers, userId, agentId]);

  useEffect(() => {
    fetchThreads();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchThreads]);

  return { threads, isLoading, error, refetch: fetchThreads };
}
