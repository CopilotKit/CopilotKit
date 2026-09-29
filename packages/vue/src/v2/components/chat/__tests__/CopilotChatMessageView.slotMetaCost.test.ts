import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import type { Message } from "@ag-ui/core";
import { CopilotKitCore } from "@copilotkit/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

/**
 * `getStateByRun` deep-clones the whole run state. The `#message-before` and
 * `#message-after` slots used to resolve their meta props with six separate
 * `getMeta()` calls per row, each of which cloned the state, whether or not
 * the slot read `stateSnapshot` (#7507).
 */

const messages: Message[] = [
  { id: "user-1", role: "user", content: "Hello" },
  { id: "assistant-1", role: "assistant", content: "Hi there" },
  { id: "user-2", role: "user", content: "Again" },
];

function installRunSpies() {
  vi.spyOn(CopilotKitCore.prototype, "getRunIdForMessage").mockReturnValue(
    "run-1",
  );
  return vi
    .spyOn(CopilotKitCore.prototype, "getStateByRun")
    .mockImplementation(() => ({ plan: "cloned" }));
}

function mountMessageView(
  slots: Parameters<typeof h>[2],
  providerProps: Record<string, unknown> = {},
) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit", ...providerProps },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", agentId: "default" },
          {
            default: () => h(CopilotChatMessageView, { messages }, slots),
          },
        ),
    },
  });
}

describe("CopilotChatMessageView message slot meta cost", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not clone run state for a slot that never reads stateSnapshot", () => {
    const getStateByRun = installRunSpies();

    const wrapper = mountMessageView({
      "message-before": ({ message }: { message: Message }) =>
        h("span", { "data-testid": "before" }, message.id),
      "message-after": ({ message }: { message: Message }) =>
        h("span", { "data-testid": "after" }, message.id),
    });

    expect(wrapper.findAll("[data-testid='after']")).toHaveLength(3);
    expect(wrapper.findAll("[data-testid='before']")).toHaveLength(3);
    expect(getStateByRun).not.toHaveBeenCalled();
  });

  it("clones run state at most once per slot render when stateSnapshot is read", () => {
    const getStateByRun = installRunSpies();
    const received: unknown[] = [];

    mountMessageView({
      "message-after": (props: { stateSnapshot: unknown }) => {
        received.push(props.stateSnapshot);
        received.push(props.stateSnapshot);
        return h("span");
      },
    });

    expect(received).toHaveLength(6);
    expect(
      received.every((s) => (s as { plan: string }).plan === "cloned"),
    ).toBe(true);
    expect(getStateByRun).toHaveBeenCalledTimes(3);
  });

  it("still passes every meta prop to the slot", () => {
    installRunSpies();
    const received: Record<string, unknown>[] = [];

    mountMessageView({
      "message-after": (props: Record<string, unknown>) => {
        received.push({ ...props });
        return h("span");
      },
    });

    expect(received).toHaveLength(3);
    expect(received[1]).toMatchObject({
      message: messages[1],
      position: "after",
      runId: "run-1",
      agentId: "default",
      stateSnapshot: { plan: "cloned" },
    });
    for (const props of received) {
      expect(props).toHaveProperty("messageIndex");
      expect(props).toHaveProperty("messageIndexInRun");
      expect(props).toHaveProperty("numberOfMessagesInRun");
    }
  });

  it("clones run state once per row for a provider custom message renderer", () => {
    const getStateByRun = installRunSpies();
    const received: unknown[] = [];
    const renderer = defineComponent({
      props: ["message", "position", "stateSnapshot"],
      setup(props) {
        return () => {
          received.push(props.stateSnapshot);
          return h("span", { "data-testid": "custom" });
        };
      },
    });

    const wrapper = mountMessageView(
      {},
      { renderCustomMessages: [{ render: renderer }] },
    );

    // One `before` and one `after` renderer per row.
    expect(wrapper.findAll("[data-testid='custom']")).toHaveLength(6);
    expect(
      received.every((s) => (s as { plan: string }).plan === "cloned"),
    ).toBe(true);
    expect(getStateByRun).toHaveBeenCalledTimes(6);
  });
});
