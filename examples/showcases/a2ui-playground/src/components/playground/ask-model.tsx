"use client";

/**
 * "Ask the model to change this": hands a hand-edited surface to the agent.
 *
 * The surface goes into the chat the way the agent's own surfaces do: a user
 * turn, an assistant `generate_a2ui` call, the `generative-ui-surface`
 * activity (so it renders in the chat) and the tool result. The agent reads
 * surfaces back from tool results (`readSurfaceResult` in
 * `src/agent/agent.ts`), so the router sees this one as the last surface and
 * an update request changes it in place. The request itself is then sent like
 * any chat prompt.
 */
import { useId, useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import type { AbstractAgent, Message } from "@ag-ui/client";
import { useAgent } from "@copilotkit/react-core/v2";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  generativeUISurfaceMessageId,
  type GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { useMode } from "@/components/app/providers";
import { useSend } from "@/components/app/use-send";
import { runStore, type A2UIOp } from "@/lib/run-store";
import { sendable } from "./sendable";

/** The agent's composer tool (`GENERATE_A2UI_TOOL_NAME` in `src/agent/composer.ts`, server-only). */
const GENERATE_TOOL = "generate_a2ui";

/** Puts `ops` in the chat as a new surface the agent can update. Returns its activity message id (the run store's surface key). */
function seedSurface(agent: AbstractAgent, ops: A2UIOp[]): string {
  // A fresh id: the same starter can be handed over twice, and each one is its own message.
  const { ops: sent, surfaceId } = sendable(
    ops,
    `edited-${crypto.randomUUID().slice(0, 6)}`,
  );
  const create = sent[0].createSurface as {
    catalogId: string;
    components: unknown[];
    dataModel?: Record<string, unknown>;
  };
  const callId = crypto.randomUUID();
  const content: GenerativeUISurfaceContent = {
    surfaceId,
    target: GENERATIVE_UI_CHAT_TARGET,
    catalogId: create.catalogId,
    operations: sent as unknown as GenerativeUISurfaceContent["operations"],
    status: "ready",
    rejected: [],
  };
  const messages: Message[] = [
    // A user turn first: Gemini only accepts a tool call right after a user turn or a tool result.
    {
      id: crypto.randomUUID(),
      role: "user",
      content: "Here is a surface I edited by hand in the JSON editor.",
    },
    {
      id: crypto.randomUUID(),
      role: "assistant",
      toolCalls: [
        {
          id: callId,
          type: "function",
          function: {
            name: GENERATE_TOOL,
            arguments: JSON.stringify({
              brief: "Show the surface the user edited by hand.",
            }),
          },
        },
      ],
    },
    {
      id: generativeUISurfaceMessageId(surfaceId),
      role: "activity",
      activityType: GENERATIVE_UI_ACTIVITY_TYPE,
      content: content as unknown as Record<string, unknown>,
    },
    {
      id: crypto.randomUUID(),
      role: "tool",
      toolCallId: callId,
      content: JSON.stringify({
        surface: {
          surfaceId,
          components: create.components,
          data: create.dataModel,
        },
      }),
    },
  ];
  agent.addMessages(messages);
  return generativeUISurfaceMessageId(surfaceId);
}

/** Resolves once `ready()` holds, or after `ms`. */
function until(ready: () => boolean, ms = 2000) {
  const start = performance.now();
  return new Promise<void>((resolve) => {
    const tick = () =>
      ready() || performance.now() - start > ms
        ? resolve()
        : requestAnimationFrame(tick);
    tick();
  });
}

/**
 * The editor's footer: a request box that sends the edited surface to the
 * chat, then the request. `ops` is null while the JSON has problems.
 */
export function AskModel({
  ops,
  onSent,
}: {
  ops: A2UIOp[] | null;
  onSent: () => void;
}) {
  const { agent } = useAgent({ agentId: "default" });
  const { send, running } = useSend();
  const { mode } = useMode();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const blocked = !ops
    ? "Fix the problems first, then ask the model."
    : mode === "fixed"
      ? "Templates mode only fills templates. Switch to Auto or Composed to ask for a change."
      : running || busy
        ? "Wait for the current run to finish."
        : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const request = text.trim();
    if (!request || blocked || !agent || !ops) return;
    setBusy(true);
    const key = seedSurface(agent, ops);
    // Let the chat mirror the surface before the run starts, so the run's timings start from the request.
    await until(() => !!runStore.get().surfaces[key]);
    void send(request);
    window.dispatchEvent(new CustomEvent("a2ui:show-chat"));
    onSent();
  };

  return (
    <form
      onSubmit={submit}
      className="flex-none border-t border-[var(--pg-line)] bg-[var(--pg-surface)] px-4 py-2.5"
      data-json-ask
    >
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Ask the model to change this"
          aria-describedby={noteId}
          placeholder="Ask the model to change this, e.g. make the title say Hello"
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--pg-line)] bg-[var(--pg-bg)] px-2.5 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-[var(--pg-faint)] hover:border-[var(--pg-line-strong)] focus-visible:border-[var(--pg-line-strong)]"
          data-json-ask-input
        />
        <button
          type="submit"
          disabled={!!blocked || !text.trim()}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
          data-json-ask-send
        >
          <ArrowUp className="size-3.5" />
          Ask
        </button>
      </div>
      <p id={noteId} className="mt-1.5 text-[11.5px] text-[var(--pg-faint)]">
        {blocked ??
          "Puts this surface in the chat as the latest one, then sends your request. The model updates it in place."}
      </p>
    </form>
  );
}
