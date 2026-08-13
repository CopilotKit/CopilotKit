import { expect, test, vi } from "vitest";
import { SlackAdapter } from "./adapter.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

function setup() {
  const chat = {
    postMessage: vi.fn(async () => ({ ts: "200.5", channel: "C1" })),
    update: vi.fn(async () => ({})),
  };
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  Object.defineProperty(adapter, "client", { value: { chat } });
  return { adapter, chat };
}

test("Slack adapter exposes strict component create and replace paths", () => {
  const { adapter } = setup();

  expect(adapter).toHaveProperty("postComponent", expect.any(Function));
  expect(adapter).toHaveProperty("updateComponent", expect.any(Function));
  expect(adapter.getComponentDeliveryPolicy("slack")).toMatchObject({
    minIntervalMs: 800,
    maxAttempts: 3,
  });
});

test("Slack strict component create rejects overflow before calling the provider", async () => {
  const { adapter, chat } = setup();
  const ir: ChannelNode[] = Array.from({ length: 51 }, (_, index) => ({
    type: "section",
    props: { children: `Section ${index}` },
  }));

  await expect(
    adapter.postComponent({ channel: "C1", threadTs: "100.0" }, ir),
  ).rejects.toThrow(
    "Slack Channel component rendered 51 blocks; the message limit is 50.",
  );

  expect(chat.postMessage).not.toHaveBeenCalled();
});

test("Slack component delivery posts once then updates the same message", async () => {
  const { adapter, chat } = setup();
  const target = { channel: "C1", threadTs: "100.0" };
  const first = [{ type: "section", props: { children: "Loading" } }];
  const second = [{ type: "section", props: { children: "Ready" } }];

  const ref = await adapter.postComponent(target, first);
  await adapter.updateComponent(ref, second);

  expect(chat.postMessage).toHaveBeenCalledOnce();
  expect(chat.update).toHaveBeenCalledOnce();
  expect(chat.update).toHaveBeenCalledWith(
    expect.objectContaining({ channel: "C1", ts: "200.5" }),
  );
});
