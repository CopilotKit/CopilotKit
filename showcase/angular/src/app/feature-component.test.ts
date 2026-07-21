import { describe, expect, it } from "vitest";

import { resolveFeatureComponentKey } from "./app.routes";

describe("Angular showcase feature routing", () => {
  it.each([
    ["prebuilt-popup", "popup"],
    ["prebuilt-sidebar", "sidebar"],
    ["chat-slots", "chat-slots"],
    ["chat-customization-css", "chat-css"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["declarative-hashbrown", "hashbrown"],
    ["agentic-chat", "chat"],
  ])("maps %s to the %s implementation", (feature, expected) => {
    expect(resolveFeatureComponentKey(feature)).toBe(expected);
  });
});
