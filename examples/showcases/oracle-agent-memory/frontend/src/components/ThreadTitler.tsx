"use client";

import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { DEFAULT_THREAD_TITLE } from "@/lib/threads";

const AGENT_ID = "oracle_concierge";
const MAX_LEN = 60;

type MinimalMessage = { role?: string; content?: unknown };

/** Derive a thread title from the first user message in a transcript. */
function deriveTitle(messages: MinimalMessage[]): string | null {
  const firstUser = messages.find((m) => m?.role === "user");
  if (!firstUser) return null;

  const raw = firstUser.content;
  const text =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((p) =>
              typeof p === "string"
                ? p
                : ((p as { text?: string })?.text ?? ""),
            )
            .join(" ")
        : "";

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > MAX_LEN
    ? `${clean.slice(0, MAX_LEN).trimEnd()}…`
    : clean;
}

/**
 * Names a thread after its first user message. Mounted (render-null) inside the
 * CopilotKit provider so it can read the active thread's transcript via useAgent.
 * Only sets a title while the thread still has the default name, so it never
 * clobbers an already-named thread; it also backfills a title when an older,
 * still-default thread with messages is reopened. Titles live in localStorage
 * (the thread store), so they persist even though server-side messages don't.
 */
export function ThreadTitler({
  activeThreadId,
  activeTitle,
  onTitle,
}: {
  activeThreadId: string;
  activeTitle: string;
  onTitle: (id: string, title: string) => void;
}) {
  const { agent } = useAgent({ agentId: AGENT_ID });
  const messages = agent?.messages as MinimalMessage[] | undefined;

  useEffect(() => {
    if (!activeThreadId || activeTitle !== DEFAULT_THREAD_TITLE) return;
    const title = deriveTitle(messages ?? []);
    if (title) onTitle(activeThreadId, title);
  }, [messages, activeThreadId, activeTitle, onTitle]);

  return null;
}
