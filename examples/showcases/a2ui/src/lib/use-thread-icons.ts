import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useRef, useState } from "react";
import type { DeskAgentState } from "./agent";

const CACHE_KEY = "research-desk:thread-icons";

interface ThreadLike {
  id: string;
  updatedAt: string;
  lastRunAt?: string;
}

/** Icon names by thread id; null once a thread is known to have none. */
type IconMap = Record<string, string | null>;

function readCache(): IconMap {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(CACHE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" ? (parsed as IconMap) : {};
  } catch {
    return {};
  }
}

/**
 * The icon the agent picked for each thread. The agent writes it to the
 * thread's state on the first run; Intelligence keeps that state, so a thread
 * opened later still has its icon. Icons never change once picked, so each
 * thread's state is read at most until an icon turns up, then cached.
 *
 * CopilotKit has no client call that reads another thread's state, so this
 * asks the runtime's thread-state endpoint directly, with the provider's
 * runtime URL and headers.
 */
export function useThreadIcons(
  threads: readonly ThreadLike[],
  live?: { threadId: string; icon?: string },
) {
  const { copilotkit } = useCopilotKit();
  const [icons, setIcons] = useState<IconMap>({});
  const inFlight = useRef(new Set<string>());
  const lastChecked = useRef(new Map<string, string>());

  useEffect(() => setIcons(readCache()), []);

  useEffect(() => {
    if (!live?.icon || icons[live.threadId] === live.icon) return;
    setIcons((current) => ({ ...current, [live.threadId]: live.icon! }));
  }, [live?.threadId, live?.icon, icons]);

  useEffect(() => {
    if (Object.keys(icons).length)
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(icons));
  }, [icons]);

  useEffect(() => {
    const runtimeUrl = copilotkit.runtimeUrl;
    if (!runtimeUrl) return;
    for (const thread of threads) {
      const stamp = thread.lastRunAt ?? thread.updatedAt;
      if (icons[thread.id] || inFlight.current.has(thread.id)) continue;
      // A thread with no icon may still get one on its next run.
      if (lastChecked.current.get(thread.id) === stamp) continue;
      inFlight.current.add(thread.id);
      lastChecked.current.set(thread.id, stamp);
      fetch(`${runtimeUrl}/threads/${encodeURIComponent(thread.id)}/state`, {
        headers: copilotkit.headers,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { state?: DeskAgentState | null } | null) => {
          const icon = body?.state?.icon;
          setIcons((current) => ({
            ...current,
            [thread.id]: typeof icon === "string" ? icon : null,
          }));
        })
        .catch(() => undefined)
        .finally(() => inFlight.current.delete(thread.id));
    }
  }, [threads, icons, copilotkit]);

  return icons;
}
