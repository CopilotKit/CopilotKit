import React, { createContext, useContext, useMemo } from "react";
import type { Message } from "@ag-ui/core";
import type { ɵChildHistory } from "@copilotkit/core";
import { CopilotChatMessageView } from "./CopilotChatMessageView";
import { ScrollElementContext } from "./scroll-element-context";
import { ChildContentContext } from "./child-content-context";

export const ChildHistoryContext = createContext<
  ReadonlyMap<string, ɵChildHistory>
>(new Map());
export const ChildHistoryReadOnlyContext = createContext(false);

/** Insert presentation rows at the owning delegation, without modifying model input. */
export function projectChildHistories(
  messages: Message[],
  histories: readonly ɵChildHistory[],
  namespace: string[] = [],
) {
  const prefix = JSON.stringify(namespace);
  const children = histories.filter(
    (h) => JSON.stringify(h.namespace.slice(0, -1)) === prefix,
  );
  const visible = namespace.length
    ? messages
    : messages.flatMap((message): Message[] => {
        if (message.role !== "assistant") return [message];
        const copies = histories
          .filter((h) => h.rootMessageIds.includes(message.id))
          .flatMap((h) => h.messages)
          .filter((m) => m.id === message.id && m.role === "assistant");
        if (!copies.length) return [message];
        const toolCalls = message.toolCalls?.filter(
          (call) =>
            !copies.some(
              (copy) =>
                copy.role === "assistant" &&
                copy.toolCalls?.some(
                  (c) =>
                    c.id === call.id && c.function.name === call.function.name,
                ),
            ),
        );
        const content = copies.some((copy) => copy.content === message.content)
          ? undefined
          : message.content;
        // Preserve any root content the child snapshot does not actually mirror.
        return content || toolCalls?.length
          ? [{ ...message, content, toolCalls }]
          : [];
      });
  const pending = new Set(children);
  const rows: Message[] = [];
  const occupied = new Set(messages.map((m) => m.id));
  const entries = new Map<string, ɵChildHistory>();
  const insert = (history: ɵChildHistory) => {
    let id = `cpk-child:${JSON.stringify(history.namespace)}`;
    while (occupied.has(id)) id += ":child";
    occupied.add(id);
    entries.set(id, history);
    rows.push({
      id,
      role: "activity",
      activityType: "cpk-child-history",
      content: { namespace: history.namespace },
    });
    pending.delete(history);
  };
  for (const message of visible) {
    rows.push(message);
    if (message.role === "assistant") {
      for (const child of pending)
        if (
          message.toolCalls?.some((call) =>
            child.parentToolCallIds.includes(call.id),
          )
        )
          insert(child);
    }
  }
  // Some native sources do not retain the delegation call. Never discard their children.
  for (const child of pending) insert(child);
  return { messages: rows, entries };
}

const AllChildHistoriesContext = createContext<readonly ɵChildHistory[]>([]);
export const AllChildHistoriesProvider = AllChildHistoriesContext.Provider;

export function ChildHistoryView({ history }: { history: ɵChildHistory }) {
  const histories = useContext(AllChildHistoriesContext);
  const contentParts = useMemo(
    () =>
      new Map(
        history.messages.flatMap((message) =>
          message.contentParts
            ? [[message.id, message.contentParts] as const]
            : [],
        ),
      ),
    [history.messages],
  );
  const projection = useMemo(() => {
    // Pending interactions belong to useInterrupt. Replaying a saved call must
    // not mount a second answer control or borrow an unrelated executing ID.
    const completed = new Set(
      history.messages.flatMap((m) =>
        m.role === "tool" ? [m.toolCallId] : [],
      ),
    );
    const messages = history.messages.flatMap((message): Message[] => {
      if (message.role !== "assistant") return [message];
      const toolCalls = message.toolCalls?.filter((call) =>
        completed.has(call.id),
      );
      if (
        !message.content &&
        !message.contentParts?.length &&
        !toolCalls?.length
      )
        return [];
      return [{ ...message, toolCalls }];
    });
    // Anchor nested children using all original calls, including delegations
    // without a result. Rendering itself remains read-only.
    const projected = projectChildHistories(
      history.messages,
      histories,
      history.namespace,
    );
    const visible = new Map(messages.map((m) => [m.id, m]));
    return {
      ...projected,
      messages: projected.messages.flatMap((m) =>
        projected.entries.has(m.id)
          ? [m]
          : visible.has(m.id)
            ? [visible.get(m.id)!]
            : [],
      ),
    };
  }, [history, histories]);
  return (
    <section
      aria-label={history.name ?? "Child agent"}
      data-child-namespace={JSON.stringify(history.namespace)}
      className="cpk:my-3 cpk:border-l cpk:border-border cpk:pl-4"
    >
      <div className="cpk:mb-2 cpk:text-sm cpk:text-muted-foreground">
        {history.name ?? "Child agent"}
      </div>
      <ChildHistoryContext.Provider value={projection.entries}>
        <ChildContentContext.Provider value={contentParts}>
          <ChildHistoryReadOnlyContext.Provider value={true}>
            <ScrollElementContext.Provider value={null}>
              <CopilotChatMessageView
                messages={projection.messages}
                isRunning={false}
                messageFeedback={false}
              />
            </ScrollElementContext.Provider>
          </ChildHistoryReadOnlyContext.Provider>
        </ChildContentContext.Provider>
      </ChildHistoryContext.Provider>
    </section>
  );
}
