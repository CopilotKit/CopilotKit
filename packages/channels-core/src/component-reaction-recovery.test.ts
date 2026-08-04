import { expect, test } from "vitest";
import { Message } from "@copilotkit/channels-ui";
import type { MessageReactionHandler } from "@copilotkit/channels-ui";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";

const reactionHandler: MessageReactionHandler = () => undefined;

test("registered component reactions recover with their source platform", async () => {
  const store = new InMemoryActionStore();
  const renderPlatforms: string[] = [];
  const register = (registry: ActionRegistry) => {
    registry.registerComponent("deployment", (_props, context) => {
      renderPlatforms.push(context.platform);
      return Message({ children: "done", onReaction: reactionHandler });
    });
  };
  const first = new ActionRegistry({ store });
  register(first);

  const bound = await first.bindRegisteredRenderable(
    "deployment",
    {},
    "conversation-1",
    undefined,
    { platform: "teams", signal: new AbortController().signal },
  );
  expect(bound.onReaction).toBe(reactionHandler);
  await first.persistMessageReaction("message-1", {
    component: "deployment",
    props: {},
    conversationKey: "conversation-1",
    platform: "teams",
  });

  const restarted = new ActionRegistry({ store });
  register(restarted);
  expect(await restarted.resolveMessageReaction("message-1")).toBe(
    reactionHandler,
  );
  expect(renderPlatforms).toEqual(["teams", "teams"]);
});
