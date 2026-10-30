"use client";

import { useEffect, useRef } from "react";
import { CopilotKitCoreErrorCode, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/client";
import { runStore, type RunRecord } from "@/lib/run-store";

type Pipeline = { stage: string; t: number; [k: string]: unknown };

/** The chat of this tab, kept for the session so leaving the playground and coming back keeps it. */
const CHAT_KEY = "a2ui-playground-chat";

/** Failures the browser sees itself (the request never reached the agent, or broke on the way), in visitor words. */
const RUN_FAILURES: Partial<Record<string, string>> = {
  [CopilotKitCoreErrorCode.AGENT_RUN_FAILED]: "Couldn't reach the playground server. Check your connection and try again.",
  [CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT]: "Couldn't reach the playground server. Check your connection and try again.",
  [CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT]: "The model stopped answering. Try again.",
  [CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED]: "The agent is still busy with the last request. Try again in a moment.",
};

/** A run the server's limits refused (429 rate limit, 413 chat too long; `src/lib/limits.ts`): its JSON says why, in visitor words. */
function refusal(error: unknown) {
  const { status, payload } = (error ?? {}) as { status?: number; payload?: { error?: unknown } };
  if (status !== 429 && status !== 413) return undefined;
  if (typeof payload?.error === "string") return payload.error;
  return status === 429 ? "You're sending a lot of requests. Try again in a minute." : "This chat is too long to send. Open the playground in a new tab to start over.";
}

/** The prompt of the latest user message, or what a surface click reads as, and that message's id. */
function lastPrompt(messages: ReadonlyArray<Message> | undefined) {
  const last = messages?.[messages.length - 1];
  return last?.role === "user" && typeof last.content === "string" ? { prompt: last.content, messageId: last.id } : { prompt: "Surface action", messageId: undefined };
}

function startRunFromWindow({ prompt, messageId }: { prompt: string; messageId?: string }) {
  const w = window as { __a2uiMode?: string; __a2uiModel?: string; __a2uiFormat?: string };
  return runStore.startRun(prompt, String(w.__a2uiMode ?? "auto"), { model: w.__a2uiModel, format: w.__a2uiFormat, messageId });
}

/**
 * Subscribes to the agent's AG-UI event stream and turns it into the
 * playground timeline. Server-side marks arrive as CUSTOM `a2ui.pipeline`
 * events; client-side paint is recorded by the surface mirror. It also keeps
 * the chat in sessionStorage, so the chat and the inspector come back together.
 */
export function AgentTap() {
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  // Runs whose RUN_STARTED has arrived (or that never will). A run sent by `useSend` is recorded before it
  // starts, and can be stopped before its RUN_STARTED arrives: that late RUN_STARTED is still its own.
  const started = useRef(new Set<string>()).current;

  // The chat for this session: restored once the real agent is up, saved as it changes.
  useEffect(() => {
    if (!agent || !isReady) return;
    if (!agent.messages.length) {
      let saved: Message[] | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? "null");
      } catch {}
      if (Array.isArray(saved) && saved.length) agent.setMessages(saved);
      // Nothing to bring back: the inspector starts over with the chat.
      else runStore.reset();
    }
    let timer = 0;
    const save = () => {
      try {
        sessionStorage.setItem(CHAT_KEY, JSON.stringify(agent.messages));
      } catch {}
    };
    const later = () => {
      clearTimeout(timer);
      timer = window.setTimeout(save, 300);
    };
    const sub = agent.subscribe({ onMessagesChanged: later, onRunFinalized: later });
    return () => {
      clearTimeout(timer);
      save();
      sub.unsubscribe();
      // Leaving mid-run stops the run, so the chat and the inspector come back with the same stopped run.
      const cur = runStore.current();
      if (cur?.status === "running") runStore.endRun(cur.id, "stopped");
      if (agent.isRunning) copilotkit.stopAgent({ agent });
    };
  }, [agent, isReady, copilotkit]);

  // A run that fails before or outside the agent's own stream (network, server error).
  useEffect(() => {
    const sub = copilotkit.subscribe({
      onError: ({ code, error, context }) => {
        const message = refusal(error) ?? RUN_FAILURES[code];
        if (!message || (context?.agentId && context.agentId !== "default")) return;
        const cur = runStore.current();
        if (cur?.status === "running") return runStore.endRun(cur.id, "error", message);
        // Already ended (stopped, or a second report of the same failure).
        if (cur && cur.status !== "done") return;
        const id = startRunFromWindow(lastPrompt(copilotkit.getAgent("default")?.messages));
        started.add(id);
        runStore.endRun(id, "error", message);
      },
    });
    return () => sub.unsubscribe();
  }, [copilotkit, started]);

  useEffect(() => {
    if (!agent) return;
    const sub = agent.subscribe({
      onEvent: ({ event }) => {
        if ((event as { type?: string }).type === "RUN_STARTED") {
          const cur = runStore.current();
          if (cur && (cur.status === "running" || !started.has(cur.id))) {
            started.add(cur.id);
            // Stop pressed while the request was still being set up does nothing in the client: stop it now that it runs.
            if (cur.status === "stopped") setTimeout(() => copilotkit.stopAgent({ agent }), 0);
          }
          // A click on a surface starts its run with the user message Gen UI 2.0 writes for the action.
          else started.add(startRunFromWindow(lastPrompt(agent.messages)));
        }
        const run = runStore.current();
        if (!run || run.status !== "running") return;
        const e = event as unknown as Record<string, any>;
        if (e.type === "CUSTOM" && e.name === "a2ui.pipeline") {
          const v = e.value as Pipeline;
          switch (v.stage) {
            case "run:start":
              runStore.patchRun(run.id, { model: String(v.model), format: String(v.format), router: String(v.router), composer: String(v.composer) });
              break;
            case "route:start":
              runStore.addEvent({ kind: "route", label: "Choosing how to answer", detail: String(v.model), tone: "muted" });
              break;
            case "route:decided": {
              const kind = v.kind as "fixed" | "dynamic" | "data";
              const label = kind === "fixed" ? "Template picked" : kind === "dynamic" ? "Building a new UI" : "Live data needed";
              const how = kind === "fixed" ? "the model fills in data only" : kind === "dynamic" ? "the model lays out the components" : "fetched first";
              runStore.addEvent({ kind: "tool", label, detail: `${how}, tool ${v.tool}`, tone: kind });
              if (kind !== "data") runStore.patchRun(run.id, { path: kind, tool: String(v.tool) });
              break;
            }
            case "data:start":
              runStore.addEvent({ kind: "data", label: "Fetching data", detail: String(v.tool ?? (v.tools as string[] | undefined)?.join(", ") ?? ""), tone: "data" });
              break;
            case "data:done":
              runStore.addEvent({ kind: "data", label: "Data ready", detail: String(v.source ?? (v.sources as string[] | undefined)?.join(", ") ?? ""), tone: "data" });
              break;
            case "compose:start":
              runStore.addEvent({ kind: "compose", label: v.format === "express" ? "Writing A2UI Express" : "Writing A2UI JSON", detail: String(v.model), tone: "dynamic" });
              break;
            case "macro":
              runStore.patchRun(run.id, (r) => ({ macros: [...r.macros, { id: String(v.id), macro: String(v.macro), components: Number(v.components) }] }));
              runStore.addEvent({ kind: "macro", label: `Macro ${v.macro} expanded`, detail: `#${v.id} into ${v.components} standard components`, tone: "data" });
              break;
            case "format:stats":
              runStore.patchRun(run.id, { payload: v as unknown as RunRecord["payload"] });
              break;
            case "skeleton":
              runStore.addEvent({ kind: "skeleton", label: "Template skeleton", detail: `${v.template}: ${v.components} slots known before data`, tone: "fixed" });
              break;
            case "compose:header":
              runStore.patchRun(run.id, { openId: String(v.id), openChars: 0 });
              runStore.addEvent({ kind: "frame", label: `[ ] ${v.component}`, detail: `#${v.id} frame`, tone: "muted" });
              break;
            case "compose:progress":
              runStore.patchRun(run.id, { tps: Number(v.tps) || null, tokens: Number(v.tokens) || null, openChars: Number(v.chars) || 0, openId: v.id ? String(v.id) : null });
              break;
            case "compose:first-token":
              runStore.addEvent({ kind: "compose", label: "First token", tone: "muted" });
              break;
            case "compose:component":
              runStore.addEvent({
                kind: "op",
                label: `+ ${v.component}`,
                detail: `#${v.id}${Array.isArray(v.repaired) && v.repaired.length ? `, repaired ${(v.repaired as string[]).join(", ")}` : ""}${Array.isArray(v.failed) && v.failed.length ? `, invalid ${(v.failed as string[]).join("; ")}` : ""}`,
                tone: Array.isArray(v.failed) && v.failed.length ? "error" : "muted",
                ...(typeof v.line === "string" ? { line: v.line } : {}),
              });
              if (typeof v.line === "string") runStore.addLine({ kind: "line", text: v.line, id: String(v.id), component: String(v.component), format: v.format === "json" ? "json" : "express" });
              break;
            case "compose:line":
              // A statement that is not a component (an Express `$/path = value` data line).
              if (typeof v.line === "string") runStore.addLine({ kind: "line", text: v.line, format: v.format === "json" ? "json" : "express" });
              break;
            case "paint":
              runStore.patchRun(run.id, { serverPaintMs: v.t });
              runStore.addEvent({
                kind: "ops",
                label: v.updated ? "Update emitted" : v.blueprint ? "First frame emitted" : "A2UI ops emitted",
                detail: v.blueprint ? "component id read before its props" : `${v.components} components${v.progressive ? ", streaming" : ""}`,
                tone: "paint",
              });
              break;
            case "geo": {
              const dropped = (v.dropped as string[]) ?? [];
              const unverified = (v.unverified as string[]) ?? [];
              runStore.addEvent({
                kind: "geo",
                label: `Geocoded ${v.component} pins`,
                detail: `${v.geocoded} placed by OpenStreetMap${dropped.length ? `, dropped ${dropped.join(", ")} (whole city, not a stop)` : ""}${unverified.length ? `, not found: ${unverified.join(", ")}` : ""}`,
                tone: "data",
              });
              break;
            }
            case "validate": {
              runStore.addEvent({ kind: "validate", label: v.ok ? "Validated" : "Validation issues", detail: v.ok ? `${v.components} components` : (v.errors as string[]).join("; "), tone: v.ok ? "muted" : "error" });
              // Express that did not compile is written again, then as JSON: the live view marks where each attempt starts.
              const errors = Array.isArray(v.errors) ? (v.errors as string[]) : [];
              if (v.retry) {
                const toJson = errors.some((e) => /as JSON instead/.test(e));
                runStore.addLine({ kind: "divider", text: toJson ? "Still did not compile. Writing the surface as JSON instead." : "Did not compile. The model writes it again." });
              }
              break;
            }
            case "error":
              runStore.addEvent({ kind: "error", label: "Error", detail: String(v.detail ?? v.message), tone: "error" });
              // The run can't produce its UI: it ends as failed, with the message the chat shows.
              if (v.failed) runStore.patchRun(run.id, { error: String(v.message) });
              break;
          }
        }
        if (e.type === "RUN_FINISHED") runStore.endRun(run.id, "done");
        if (e.type === "RUN_ERROR") runStore.endRun(run.id, "error", "The model stopped answering. Try again.");
      },
    });
    return () => sub.unsubscribe();
  }, [agent, copilotkit, started]);
  return null;
}
