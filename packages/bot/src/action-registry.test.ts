import { describe, it, expect } from "vitest";
import { ActionRegistry, ActionExpiredError } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import type { BotNode, InteractionContext } from "@copilotkit/bot-ui";

function Confirm(props: { action: string }): BotNode {
  return {
    type: "actions",
    props: {
      children: [
        {
          type: "button",
          props: {
            onClick: ({ action }: InteractionContext) =>
              `ok:${props.action}:${action.id}`,
            children: "Yes",
          },
        },
      ],
    },
  };
}

const ctx = {} as InteractionContext;

describe("ActionRegistry", () => {
  it("binds onClick handlers and dispatches via hot cache", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Confirm", Confirm as never);
    const ir = await reg.bindTree("Confirm", { action: "write" }, "conv1");
    const button = (ir[0]!.props.children as BotNode[])[0]!;
    const id = (button.props.onClick as { id: string }).id;
    expect(typeof id).toBe("string");
    const out = await reg.dispatch(id, ctx);
    expect(out).toContain("ok:write:");
  });

  it("cold path re-renders from snapshot when hot cache is cleared", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Confirm", Confirm as never);
    const ir = await reg.bindTree("Confirm", { action: "write" }, "conv1");
    const id = (
      (ir[0]!.props.children as BotNode[])[0]!.props.onClick as { id: string }
    ).id;
    reg.clearHotCache();
    const out = await reg.dispatch(id, ctx);
    expect(out).toContain("ok:write:");
  });

  it("throws ActionExpiredError on full miss", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    await expect(reg.dispatch("ck:missing", ctx)).rejects.toBeInstanceOf(
      ActionExpiredError,
    );
  });
});
