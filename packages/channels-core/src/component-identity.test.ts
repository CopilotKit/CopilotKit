// End-to-end cover for OSS-711: a durable action must survive a deploy whose
// bundler mangles the component's function name differently. The identity that
// createChannel seeds into the action registry — and that mintId folds into
// every action id — has to come from the pinned `displayName`, not `fn.name`.
import { describe, it, expect, vi } from "vitest";
import {
  Actions,
  Button,
  Message,
  defineChannelComponent,
} from "@copilotkit/channels-ui";
import type { ChannelNode, ComponentFn } from "@copilotkit/channels-ui";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { MemoryStore } from "./state/memory-store.js";
import type { ChannelComponent } from "./create-channel.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * The same source component as two successive minified builds emit it: the
 * mangler picked `a` the first time and `b` the second. Only `displayName`
 * survives both.
 */
function buildApprovalCard(opts: {
  pin: boolean;
  mangledTo: string;
  approvals: string[];
}): ComponentFn {
  const body = (props: Record<string, unknown>): ChannelNode =>
    Message({
      children: Actions({
        children: Button({
          value: "approve",
          onClick: () => {
            opts.approvals.push(String(props.summary));
          },
          children: "Approve",
        }),
      }),
    });
  Object.defineProperty(body, "name", { value: opts.mangledTo });
  return opts.pin ? defineChannelComponent("ApprovalCard", body) : body;
}

/** Boot a channel that posts the card on every turn, sharing `backend`. */
function deploy(card: ComponentFn, backend: MemoryStore) {
  const adapter = new FakeAdapter();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    store: { adapter: backend },
    components: [card],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.post({ type: card, props: { summary: "ship it" } });
  });
  return { adapter, channel };
}

/** The action id the adapter received on the posted card's button. */
function postedActionId(adapter: FakeAdapter): string {
  const tree = adapter.posted.at(-1)!;
  const found: string[] = [];
  const visit = (nodes: ChannelNode[]) => {
    for (const node of nodes) {
      const onClick = node.props.onClick as { id?: string } | undefined;
      if (onClick?.id) found.push(onClick.id);
      if (Array.isArray(node.props.children)) {
        visit(node.props.children as ChannelNode[]);
      }
    }
  };
  visit(tree);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("durable component identity across a redeploy", () => {
  it("dispatches a click posted by the previous deploy when the name is pinned", async () => {
    const backend = new MemoryStore(); // survives the simulated redeploy
    const approvals: string[] = [];

    // Deploy 1 posts the card and persists its snapshot.
    const first = deploy(
      buildApprovalCard({ pin: true, mangledTo: "a", approvals }),
      backend,
    );
    await first.channel.ɵruntime.start();
    first.adapter.emitTurn({});
    await tick();
    const actionId = postedActionId(first.adapter);

    // Deploy 2: new process, no hot cache, function mangled to a different
    // name. The click posted by deploy 1 must still resolve.
    const second = deploy(
      buildApprovalCard({ pin: true, mangledTo: "b", approvals }),
      backend,
    );
    await second.channel.ɵruntime.start();
    second.adapter.emitInteraction({ id: actionId });
    await tick();

    expect(approvals).toEqual(["ship it"]);
  });

  it("drops that same click — with a log — when the name is not pinned", async () => {
    // Negative control: the pre-existing bug. Deploy 2 knows the component only
    // as `b`, so the snapshot's `a` resolves to nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const backend = new MemoryStore();
      const approvals: string[] = [];

      const first = deploy(
        buildApprovalCard({ pin: false, mangledTo: "a", approvals }),
        backend,
      );
      await first.channel.ɵruntime.start();
      first.adapter.emitTurn({});
      await tick();
      const actionId = postedActionId(first.adapter);

      const second = deploy(
        buildApprovalCard({ pin: false, mangledTo: "b", approvals }),
        backend,
      );
      await second.channel.ɵruntime.start();
      second.adapter.emitInteraction({ id: actionId });
      await tick();

      expect(approvals).toEqual([]);
      // The click still does nothing, but no longer without a trace.
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes(
            `ignoring click on expired or unresolvable action "${actionId}"`,
          ),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("seeds a pinned component under its displayName, not its mangled fn.name", async () => {
    const backend = new MemoryStore();
    const approvals: string[] = [];
    const { adapter, channel } = deploy(
      buildApprovalCard({ pin: true, mangledTo: "a", approvals }),
      backend,
    );
    await channel.ɵruntime.start();
    adapter.emitTurn({});
    await tick();

    const snapshot = await backend.kv.get<{ component?: string }>(
      `action:${postedActionId(adapter)}`,
    );
    expect(snapshot?.component).toBe("ApprovalCard");
  });

  it("keeps seeding an unpinned component under fn.name (backward compatible)", async () => {
    const backend = new MemoryStore();
    const approvals: string[] = [];

    const first = deploy(
      buildApprovalCard({ pin: false, mangledTo: "ApprovalCard", approvals }),
      backend,
    );
    await first.channel.ɵruntime.start();
    first.adapter.emitTurn({});
    await tick();
    const actionId = postedActionId(first.adapter);

    const snapshot = await backend.kv.get<{ component?: string }>(
      `action:${actionId}`,
    );
    expect(snapshot?.component).toBe("ApprovalCard");

    // …and it still dispatches cold, exactly as before this change.
    const second = deploy(
      buildApprovalCard({ pin: false, mangledTo: "ApprovalCard", approvals }),
      backend,
    );
    await second.channel.ɵruntime.start();
    second.adapter.emitInteraction({ id: actionId });
    await tick();
    expect(approvals).toEqual(["ship it"]);
  });

  it("skips a component with no resolvable identity, warning once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const anonymous = (
        () => () =>
          Message({ children: "hi" })
      )();
      expect(anonymous.name).toBe("");
      // Seeding happens on start, so the channel has to be started to warn.
      await createChannel({
        identifyUser: "platform",
        adapters: [new FakeAdapter()],
        components: [anonymous as ChannelComponent],
      }).ɵruntime.start();

      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("skipping anonymous component"),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
