"use client";

/**
 * The conversation: one turn per prompt, read from the agent's messages, so
 * it comes back with the chat from sessionStorage.
 */
import { useEffect, useState } from "react";
import type { Message } from "@ag-ui/client";
import { useAgent } from "@copilotkit/react-core/v2";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  generativeUISurfaceMessageId,
} from "@copilotkit/shared";
import type { RunRecord } from "@/lib/run-store";

/**
 * `surfaceKey`: the activity message of the surface this prompt created (an update changes an earlier one in place).
 * `updatedKey`: the activity message of the earlier surface it updated, read from its tool result (`{ surface, updated: true }`).
 */
export type Turn = {
  id: string;
  prompt: string;
  surfaceKey: string | null;
  text: string | null;
  updatedKey: string | null;
};

/** The first message "Ask the model to change this" puts in the chat (see ask-model.tsx). */
const HAND_EDITED = "Here is a surface I edited by hand";

function turnsOf(messages: readonly Message[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({
        id: m.id,
        prompt: typeof m.content === "string" ? m.content : "",
        surfaceKey: null,
        text: null,
        updatedKey: null,
      });
      continue;
    }
    const cur = out[out.length - 1];
    if (!cur) continue;
    if (m.role === "activity" && m.activityType === GENERATIVE_UI_ACTIVITY_TYPE)
      cur.surfaceKey = m.id;
    else if (m.role === "tool")
      cur.updatedKey = updatedSurface(m.content) ?? cur.updatedKey;
    if (
      m.role === "assistant" &&
      typeof m.content === "string" &&
      m.content.trim()
    )
      cur.text = cur.text ? `${cur.text}\n\n${m.content}` : m.content;
  }
  return out;
}

/** The surface a tool result says it updated in place, as its activity message id. */
function updatedSurface(content: unknown) {
  // Turns are re-read on every streamed operation: parse only the results that can be updates.
  const text = String(content);
  if (!text.includes('"updated":true')) return null;
  try {
    const r = JSON.parse(text) as {
      surface?: { surfaceId?: unknown };
      updated?: unknown;
    };
    return r?.updated === true && typeof r.surface?.surfaceId === "string"
      ? generativeUISurfaceMessageId(r.surface.surfaceId)
      : null;
  } catch {
    return null;
  }
}

/** The turns, re-read when the messages change and only re-rendered when a turn itself changed (not on every streamed operation). */
export function useTurns(): Turn[] {
  const { agent } = useAgent({ agentId: "default", updates: [] });
  const [turns, setTurns] = useState<Turn[]>([]);
  useEffect(() => {
    if (!agent) return;
    let last = "";
    const read = () => {
      const next = turnsOf(agent.messages);
      const sig = JSON.stringify(next);
      if (sig === last) return;
      last = sig;
      setTurns(next);
    };
    read();
    const sub = agent.subscribe({ onMessagesChanged: read });
    return () => sub.unsubscribe();
  }, [agent]);
  return turns;
}

export const isHandEdited = (t: Turn) => t.prompt.startsWith(HAND_EDITED);

/** The run a turn started, if it ran since the page opened (runs are not kept across reloads; the turns are). */
export const runOf = (turn: Turn | undefined, runs: RunRecord[]) =>
  turn ? runs.findLast((r) => r.messageId === turn.id) : undefined;

/**
 * The surface a turn shows: the one it created, else the one its run updated in place, else the one
 * its tool result says it updated (an update restored from an earlier visit, which has no run). A
 * running turn with nothing drawn yet, a text answer and a failure show none.
 */
export function surfaceOfTurn(
  turn: Turn | undefined,
  run: RunRecord | undefined,
): string | null {
  if (!turn) return null;
  return turn.surfaceKey ?? run?.surfaceKey ?? turn.updatedKey;
}
