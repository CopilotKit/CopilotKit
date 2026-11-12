"use client";

import { useEffect, useState } from "react";

/**
 * Titles for unnamed threads, taken from each thread's first user message.
 *
 * Without Intelligence the runtime never names a thread (its
 * `generateThreadNames` is Intelligence-only), so every row would read "New
 * chat". A skin that opts in (`threadList.titleFromFirstMessage`) gets the
 * first thing the user asked instead. Each thread's events are fetched once
 * and the title is cached in localStorage by thread id.
 */

const CACHE_KEY = "nw-thread-titles";
const MAX_CHARS = 44;

function readCache(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeCache(entries: Record<string, string>): void {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...readCache(), ...entries }),
    );
  } catch {
    // Storage blocked: titles are re-derived next time.
  }
}

/** A short one-line title: collapsed whitespace, cut at a word boundary. */
export function titleFromText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_CHARS) return flat;
  const cut = flat.slice(0, MAX_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

/** The first user message's text in a thread's AG-UI event log, if any. */
export function firstUserMessage(events: unknown[]): string | null {
  for (const event of events) {
    const e = event as {
      type?: string;
      input?: { messages?: MessageLike[] };
    };
    if (e.type !== "RUN_STARTED") continue;
    for (const m of e.input?.messages ?? []) {
      if (m.role !== "user") continue;
      if (typeof m.content === "string" && m.content.trim()) return m.content;
      if (Array.isArray(m.content)) {
        const text = (m.content as { type?: string; text?: string }[])
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join(" ")
          .trim();
        if (text) return text;
      }
    }
  }
  return null;
}

export function useThreadTitles(
  threads: { id: string; name?: string | null }[],
  agentId: string,
  enabled: boolean,
  runtimeUrl = "/api/copilotkit",
): Record<string, string> {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const untitled = enabled
    ? threads.filter((t) => !t.name?.trim()).map((t) => t.id)
    : [];
  const key = untitled.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split(",");
    void (async () => {
      const cache = readCache();
      const found: Record<string, string> = {};
      const fresh: Record<string, string> = {};
      for (const id of ids) {
        if (cache[id]) {
          found[id] = cache[id];
          continue;
        }
        try {
          const res = await fetch(
            `${runtimeUrl}/threads/${encodeURIComponent(id)}/events?agentId=${encodeURIComponent(agentId)}`,
          );
          if (!res.ok) continue;
          const body = (await res.json()) as { events?: unknown[] };
          const text = firstUserMessage(body.events ?? []);
          // Only a real title is cached; a thread with no user message yet is
          // asked again on the next render that still lists it untitled.
          if (text) found[id] = fresh[id] = titleFromText(text);
        } catch {
          // Leave the row on its "New chat" label.
        }
        if (cancelled) return;
      }
      if (Object.keys(fresh).length) writeCache(fresh);
      if (!cancelled && Object.keys(found).length)
        setTitles((prev) => ({ ...prev, ...found }));
    })();
    return () => {
      cancelled = true;
    };
  }, [key, agentId, runtimeUrl]);

  return titles;
}
