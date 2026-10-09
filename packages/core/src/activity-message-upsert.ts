/**
 * Same-id activity messages are one card, not a history of revisions.
 *
 * `@ag-ui/client`'s `AbstractAgent.addMessage` appends every call. A frontend
 * progress surface that reuses an id (CopilotKit issue #7394) therefore stores
 * every tick. React's `deduplicateMessages` hides the older copies, and the
 * run payload strips activity messages, but `agent.messages` still grows
 * without bound and every tick notifies subscribers.
 *
 * Importing this module — which `@copilotkit/core` does from its entry —
 * replaces that method once. An activity message whose id already belongs to
 * an activity entry replaces that entry in place, and drops any earlier leaked
 * copies of the same id. User, assistant, tool, and reasoning messages stay
 * append-only, including when an id is reused.
 */
import { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";

const PATCH_FLAG = Symbol.for("copilotkit.activityMessageUpsert");

type PatchedAddMessage = AbstractAgent["addMessage"] & {
  [PATCH_FLAG]?: true;
};

const originalAddMessage = AbstractAgent.prototype
  .addMessage as PatchedAddMessage;

function isActivityMessage(
  message: Message,
): message is Message & { role: "activity" } {
  return message.role === "activity";
}

function activityIndexes(messages: readonly Message[], id: string): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < messages.length; index++) {
    const existing = messages[index];
    if (existing?.role === "activity" && existing.id === id) {
      indexes.push(index);
    }
  }
  return indexes;
}

/**
 * Mirrors `AbstractAgent.addMessage`'s subscriber fan-out so a replacement
 * still refreshes transcript subscribers (`onMessagesChanged` is what the
 * React, Vue, and Angular clients render from). The array update itself is
 * synchronous; notification stays asynchronous, as in the original method.
 */
function notifyMessageList(agent: AbstractAgent, message: Message): void {
  void (async () => {
    for (const subscriber of agent.subscribers) {
      await subscriber.onNewMessage?.({
        message,
        messages: agent.messages,
        state: agent.state,
        agent,
      });
    }
    for (const subscriber of agent.subscribers) {
      await subscriber.onMessagesChanged?.({
        messages: agent.messages,
        state: agent.state,
        agent,
      });
    }
  })();
}

function addMessageWithActivityUpsert(
  this: AbstractAgent,
  message: Message,
): void {
  if (isActivityMessage(message) && message.id) {
    const indexes = activityIndexes(this.messages, message.id);
    const first = indexes[0];
    if (first !== undefined) {
      this.messages[first] = message;
      for (let cursor = indexes.length - 1; cursor >= 1; cursor--) {
        const index = indexes[cursor];
        if (index !== undefined) {
          this.messages.splice(index, 1);
        }
      }
      notifyMessageList(this, message);
      return;
    }
  }

  originalAddMessage.call(this, message);
}

if (!originalAddMessage[PATCH_FLAG]) {
  const patched = addMessageWithActivityUpsert as PatchedAddMessage;
  patched[PATCH_FLAG] = true;
  AbstractAgent.prototype.addMessage = patched;
}
