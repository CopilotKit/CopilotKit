import { afterEach, describe, expect, it, vi } from "vitest";

const selectChatModels = vi.fn();
vi.mock("vscode", () => ({
  lm: { selectChatModels: (...args: unknown[]) => selectChatModels(...args) },
}));

import { listModels, pickModel } from "../model-picker";

afterEach(() => {
  selectChatModels.mockReset();
});

const fakeModel = (
  overrides: Partial<{
    id: string;
    family: string;
    name: string;
    vendor: string;
  }> = {},
) => ({
  id: "m1",
  family: "gpt",
  name: "GPT",
  vendor: "github",
  ...overrides,
});

describe("pickModel", () => {
  it("returns null when no models are available", async () => {
    selectChatModels.mockResolvedValue([]);
    expect(await pickModel()).toBeNull();
  });

  it("returns the first model when no preferredId is provided", async () => {
    const a = fakeModel({ id: "a" });
    const b = fakeModel({ id: "b" });
    selectChatModels.mockResolvedValue([a, b]);
    expect(await pickModel()).toBe(a);
  });

  it("ignores empty preferredId", async () => {
    const a = fakeModel({ id: "a" });
    selectChatModels.mockResolvedValue([a]);
    expect(await pickModel({ preferredId: "" })).toBe(a);
  });

  it("matches preferredId against id first", async () => {
    const a = fakeModel({ id: "a", family: "shared" });
    const b = fakeModel({ id: "b", family: "shared" });
    selectChatModels.mockResolvedValue([a, b]);
    expect(await pickModel({ preferredId: "b" })).toBe(b);
  });

  it("falls back to family match when no id matches", async () => {
    const a = fakeModel({ id: "a", family: "gpt" });
    const b = fakeModel({ id: "b", family: "claude" });
    selectChatModels.mockResolvedValue([a, b]);
    expect(await pickModel({ preferredId: "claude" })).toBe(b);
  });

  it("returns first model when neither id nor family matches", async () => {
    const a = fakeModel({ id: "a", family: "gpt" });
    selectChatModels.mockResolvedValue([a]);
    expect(await pickModel({ preferredId: "nope" })).toBe(a);
  });
});

describe("listModels", () => {
  it("returns the models from selectChatModels({})", async () => {
    const ms = [fakeModel({ id: "a" }), fakeModel({ id: "b" })];
    selectChatModels.mockResolvedValue(ms);
    expect(await listModels()).toEqual(ms);
    expect(selectChatModels).toHaveBeenCalledWith({});
  });
});
