import { expect, test, vi } from "vitest";
import { TeamsAdapter } from "./adapter.js";

test("Teams adapter exposes strict component create and replace paths", () => {
  const adapter = new TeamsAdapter();

  expect(adapter).toHaveProperty("postComponent", expect.any(Function));
  expect(adapter).toHaveProperty("updateComponent", expect.any(Function));
  expect(adapter.getComponentDeliveryPolicy("teams")).toMatchObject({
    minIntervalMs: 700,
    maxAttempts: 3,
  });
});

test("strict component update rejects a missing provider message id while normal update stays tolerant", async () => {
  const adapter = new TeamsAdapter();
  const ref = { id: "" };
  const ir = [{ type: "text", props: { value: "hello" } }];

  await expect(adapter.update(ref, ir)).resolves.toBeUndefined();
  await expect(adapter.updateComponent(ref, ir)).rejects.toThrow(
    "Teams component update requires a provider message id.",
  );
});

test("Teams component delivery posts once then updates the same activity", async () => {
  const adapter = new TeamsAdapter();
  const sendActivity = vi.fn(async (_activity: unknown) => ({
    id: "activity-1",
  }));
  const updateActivity = vi.fn(async (_activity: unknown) => undefined);
  const context = { sendActivity, updateActivity } as never;
  const target = { conversationKey: "thread-1", context } as never;
  const first = [{ type: "section", props: { children: "Loading" } }];
  const second = [{ type: "section", props: { children: "Ready" } }];

  const ref = await adapter.postComponent(target, first);
  await adapter.updateComponent(ref, second);

  expect(sendActivity).toHaveBeenCalledOnce();
  expect(updateActivity).toHaveBeenCalledOnce();
  const updated = vi.mocked(updateActivity).mock.calls[0]?.[0] as
    | { id?: string }
    | undefined;
  expect(updated).toMatchObject({ id: "activity-1" });
});

test("Teams strict component create rejects overflow before calling the provider", async () => {
  const adapter = new TeamsAdapter();
  const sendActivity = vi.fn(async (_activity: unknown) => ({
    id: "activity-1",
  }));
  const target = {
    conversationKey: "thread-1",
    context: { sendActivity },
  } as never;
  const ir = Array.from({ length: 101 }, (_, index) => ({
    type: "section",
    props: { children: `Section ${index}` },
  }));

  await expect(adapter.postComponent(target, ir)).rejects.toThrow(
    "Teams Channel component rendered 101 body elements; the card limit is 100.",
  );
  expect(sendActivity).not.toHaveBeenCalled();
});
