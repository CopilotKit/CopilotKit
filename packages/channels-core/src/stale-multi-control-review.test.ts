import { expect, test, vi } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import {
  ActionAlreadyClaimedError,
  ActionRegistry,
} from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";

// A bind whose first resume-gate write stalls past `retentionMs`, while a
// newer bind of the same continuation opens, publishes, and is resumed, must
// not roll a later control of the stale bind over to a fresh, unclaimed gate:
// every control of one bind shares the gate its first control resolved.
type Layout = "flat" | "nested" | "multi-event";

const LABELS = ["Approve", "Reject", "Defer"];

function controls(layout: Layout, count: number): ChannelNode[] {
  const buttons: ChannelNode[] = LABELS.slice(0, count).map((label) => ({
    type: "button",
    props: { children: label, onClick: () => {} },
  }));
  if (layout === "flat") return buttons;
  if (layout === "nested") {
    // The last control sits in a descendant reached through `walkValue`.
    const last = buttons.pop()!;
    return [
      ...buttons,
      { type: "section", props: { children: [last] } } as ChannelNode,
    ];
  }
  // One node carrying two event props binds two actions from one node.
  return [
    {
      type: "select",
      props: { children: "Pick", onSelect: () => {}, onSubmit: () => {} },
    },
  ];
}

function actionIds(nodes: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const props = (value as ChannelNode).props;
    if (!props) return;
    for (const ep of ["onClick", "onSelect", "onSubmit"]) {
      const bound = props[ep] as { id?: string } | undefined;
      if (bound?.id) out.push(bound.id);
    }
    visit(props.children);
  };
  visit(nodes);
  return out;
}

test.each<[Layout, number]>([
  ["flat", 1],
  ["flat", 2],
  ["flat", 3],
  ["nested", 2],
  ["nested", 3],
  ["multi-event", 1],
])(
  "a stale %s bind with %i controls cannot reopen a resumed leg",
  async (layout, controlCount) => {
    vi.useFakeTimers();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    let older: Promise<ChannelNode[]> | undefined;
    try {
      const store = new InMemoryActionStore();
      const put = store.put.bind(store);
      let gateWrites = 0;
      vi.spyOn(store, "put").mockImplementation(async (key, snapshot, ttl) => {
        if (key.startsWith("resume:") && !key.startsWith("resume:spent:")) {
          if (++gateWrites === 1) {
            started();
            await pending;
          }
        }
        await put(key, snapshot, ttl);
      });
      const registry = new ActionRegistry({ store, retentionMs: 100 });
      function Picker(): ChannelNode {
        return {
          type: "actions",
          props: { children: controls(layout, controlCount) },
        };
      }
      registry.registerComponent("Picker", Picker as never);
      const continuation = {
        channelName: "approvals",
        conversationKey: "c1",
        threadId: "t1",
        runChainId: "run1",
        initiator: {
          user: null,
          actor: { id: "alice", kind: "human" as const },
        },
      };
      older = registry.bindTree("Picker", {}, "c1", continuation);
      await reached;
      vi.advanceTimersByTime(100);
      const current = await registry.bindTree("Picker", {}, "c1", continuation);
      await registry.claimContinuation(actionIds(current)[0]!, continuation);
      vi.advanceTimersByTime(100);
      release();
      const stale = await older;
      const staleIds = actionIds(stale);
      expect(staleIds.length).toBeGreaterThanOrEqual(controlCount);
      expect.soft(gateWrites).toBe(2);
      const replica = new ActionRegistry({ store, retentionMs: 100 });
      for (const id of staleIds) {
        await expect(
          replica.claimContinuation(id, continuation),
        ).rejects.toBeInstanceOf(ActionAlreadyClaimedError);
      }
    } finally {
      release();
      await older?.catch(() => {});
      vi.useRealTimers();
    }
  },
);
