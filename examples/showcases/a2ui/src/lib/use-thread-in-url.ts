import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect, useRef } from "react";

/**
 * Keeps the open thread in the address bar (`?thread=<id>`), so a prepared
 * thread can be bookmarked and opened straight into a demo.
 *
 * @param known whether the thread is in the thread list yet (a brand new
 *   thread is not, and stays out of the URL until it is)
 * @param loading whether the thread list is still loading
 */
export function useThreadInUrl(known: boolean, loading: boolean) {
  const config = useCopilotChatConfiguration();
  const threadId = config?.threadId;
  const requested = useRef<string | null>(null);

  // On the first load, open the thread the address asks for.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("thread");
    if (id) {
      requested.current = id;
      config?.setActiveThreadId(id, { explicit: true });
    }
    // Only the first load reads the address bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Afterwards, the address follows the open thread.
  useEffect(() => {
    if (loading || !threadId) return;
    const url = new URL(window.location.href);
    if (known || threadId === requested.current)
      url.searchParams.set("thread", threadId);
    else url.searchParams.delete("thread");
    if (url.href !== window.location.href)
      window.history.replaceState(null, "", url);
  }, [threadId, known, loading]);
}
