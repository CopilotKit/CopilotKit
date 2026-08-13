import { expect, expectTypeOf, test } from "vitest";
import {
  createChannelCallbackBinding,
  isChannelCallbackBinding,
} from "./channel-callback-binding.js";
import type { ChannelCallbackBinding } from "./channel-callback-binding.js";

test("a channel callback binding exposes only its callback name and arguments", () => {
  const binding = createChannelCallbackBinding("approve", {
    orderId: "order-42",
  });

  expect(binding).toEqual({
    callbackName: "approve",
    args: { orderId: "order-42" },
  });
  expect(Object.keys(binding)).toEqual(["callbackName", "args"]);
  expect(isChannelCallbackBinding(binding)).toBe(true);
  expectTypeOf(binding).toEqualTypeOf<
    ChannelCallbackBinding<{ orderId: string }>
  >();
});

test("plain objects cannot impersonate a channel callback binding", () => {
  const plainObject = {
    callbackName: "approve",
    args: { orderId: "order-42" },
  };

  expect(isChannelCallbackBinding(plainObject)).toBe(false);
  expect(isChannelCallbackBinding(() => undefined)).toBe(false);
  expect(isChannelCallbackBinding(null)).toBe(false);
});

test("a channel callback binding rejects an empty callback name", () => {
  expect(() => createChannelCallbackBinding("  ", null)).toThrow(
    "Channel callback name must not be empty.",
  );
});
