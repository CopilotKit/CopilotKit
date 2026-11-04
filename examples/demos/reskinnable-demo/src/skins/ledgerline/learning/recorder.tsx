"use client";

import { useEffect, useRef } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { useSkinSegments } from "@/shell/skin-path";
import { useChatInbox } from "@/shell/chat/chat-inbox-context";

/**
 * The in-app product-trajectory recorder. A demo-local recorder shaped like
 * the draft trajectory contract (CopilotKit draft PR #7556): it emits AG-UI
 * CUSTOM events and posts them in small batches to
 * `/api/learning/v1/events`, where the server assigns eventIds and groups them
 * into trajectories.
 *
 * What it captures, and only from the app card (`[data-ledgerline-app]`),
 * never from the chat:
 *  - `page` and `navigation`, with ROUTE TEMPLATES (`/reports/[id]`), never ids;
 *  - `click` on buttons, links and `[data-action]` elements, labelled by
 *    `data-action` (else aria-label, else visible text);
 *  - `network` for the app's own `/api/ledgerline/v1` writes (`trackedFetch`);
 *  - `screen.context` when a page shows something the user reads (the Policy
 *    panel calls `emitScreenContext`);
 *  - `thread.linked` once a chat Thread has messages;
 *  - semantic `expense.*` events the pages emit after a write lands.
 */

export interface RecorderEvent {
  type: "CUSTOM";
  name: string;
  timestamp: number;
  value: Record<string, unknown>;
}

const ENDPOINT = "/api/learning/v1/events";
const FLUSH_MS = 400;

let queue: RecorderEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let currentRoute = "/reports";
let linkedThreadId: string | null = null;

async function flush(): Promise<void> {
  timer = null;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch (error) {
    console.warn(
      "[ledgerline/recorder] could not post events; retrying with the next batch",
      error,
    );
    queue = [...batch, ...queue].slice(-200);
  }
}

export function emit(name: string, value: Record<string, unknown>): void {
  queue.push({ type: "CUSTOM", name, timestamp: Date.now(), value });
  timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

/** Flush now (before a navigation that unloads the page). */
export function flushNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  return flush();
}

export function routeTemplate(segments: string[]): string {
  const [head = "", id] = segments;
  const section = head === "" ? "overview" : head;
  // Joined, not templated: these are route TEMPLATES for the trajectory, not links.
  return ["", section, ...(id ? ["[id]"] : [])].join("/");
}

/** Page titles by route template, keyed without the leading slash. */
const TITLES: Record<string, string> = {
  overview: "Overview",
  reconciliation: "Card close",
  reports: "Expense reports",
  "reports/[id]": "Expense report",
  approvals: "Approvals",
  reimbursements: "Reimbursements",
  "cost-centers": "Cost centers",
  people: "People",
  policies: "Policies",
};

/**
 * `fetch` for the app's own API, recorded as a `network` event with the
 * route TEMPLATE and a one-line summary. Used by the pages, never by the
 * agent's tools (their calls belong to the agent trace).
 */
export async function trackedFetch(
  url: string,
  init: RequestInit & {
    template: string;
    summary: string;
    /** A small summary of the request body (ids, not payloads). */
    request?: Record<string, unknown>;
    /** Response fields to keep in the event, e.g. ["id", "resolved"]. */
    responseFields?: string[];
  },
): Promise<Response> {
  const { template, summary, request, responseFields, ...rest } = init;
  const started = performance.now();
  let status = 0;
  let response: Record<string, unknown> | undefined;
  try {
    const res = await fetch(url, rest);
    status = res.status;
    if (responseFields?.length) {
      const json = (await res
        .clone()
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      response = Object.fromEntries(
        [...responseFields, "error"]
          .filter((k) => json[k] !== undefined)
          .map((k) => [k, json[k]]),
      );
    }
    return res;
  } finally {
    emit("network", {
      method: (rest.method ?? "GET").toUpperCase(),
      route: template,
      status,
      durationMs: Math.round(performance.now() - started),
      summary,
      ...(request ? { request } : {}),
      ...(response ? { response } : {}),
    });
  }
}

/** A choice made in a control (a select), recorded like a click with its own label. */
export function emitChoice(
  action: string,
  extra: Record<string, unknown> = {},
): void {
  emit("click", {
    action,
    role: "combobox",
    tag: "select",
    route: currentRoute,
    threadId: linkedThreadId,
    ...extra,
  });
}

export function emitScreenContext(
  label: string,
  fields: Record<string, unknown>,
): void {
  emit("screen.context", { label, fields, route: currentRoute });
}

function labelOf(el: Element): string {
  const explicit =
    el.getAttribute("data-action") ?? el.getAttribute("aria-label");
  if (explicit) return explicit.trim();
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

const CLICKABLE =
  "button, a, [role='button'], [role='tab'], [role='option'], [data-action]";

/** Mount once, inside the CopilotKit provider and the skin's providers. */
export function TrajectoryRecorder() {
  const segments = useSkinSegments("ledgerline");
  const route = routeTemplate(segments);
  const previous = useRef<string | null>(null);
  const { agent } = useAgent();
  const { selectedThreadId } = useChatInbox();

  useEffect(() => {
    if (previous.current === route) return;
    if (previous.current !== null)
      emit("navigation", { from: previous.current, to: route });
    emit("page", { route, title: TITLES[route.slice(1)] ?? route });
    previous.current = route;
    currentRoute = route;
  }, [route]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest(CLICKABLE);
      if (
        !el ||
        !el.closest("[data-ledgerline-app]") ||
        el.closest("[data-no-record]")
      )
        return;
      const action = labelOf(el);
      if (!action) return;
      emit("click", {
        action,
        role:
          el.getAttribute("role") ?? (el.tagName === "A" ? "link" : "button"),
        tag: el.tagName.toLowerCase(),
        route: currentRoute,
        threadId: linkedThreadId,
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // A Thread exists once the chat has messages; link it once per thread id.
  useEffect(() => {
    const check = () => {
      const id = selectedThreadId;
      if (!id || id === linkedThreadId) return;
      if ((agent?.messages?.length ?? 0) === 0) return;
      linkedThreadId = id;
      emit("thread.linked", { threadId: id, surface: "in_app" });
    };
    check();
    const t = setInterval(check, 1000);
    return () => clearInterval(t);
  }, [agent, selectedThreadId]);

  return null;
}
