import { describe, expect, it, vi } from "vitest";
import {
  buildActionMessageText,
  sendA2UIActionAsMessage,
} from "../action-message";

const base = {
  name: "choose_plan",
  sourceComponentId: "btn",
  surfaceId: "s",
  timestamp: "t",
};

describe("buildActionMessageText", () => {
  it("uses context.message when present and appends other context values", () => {
    expect(
      buildActionMessageText({
        ...base,
        context: { message: "Pick the Team plan", seats: 12, annual: true },
      }),
    ).toBe("Pick the Team plan\n\nseats: 12\nannual: true");
  });
  it("falls back to context.label", () => {
    expect(
      buildActionMessageText({ ...base, context: { label: "Request quote" } }),
    ).toBe("Request quote");
  });
  it("humanizes the action name when no text is given", () => {
    expect(buildActionMessageText({ ...base })).toBe("Choose plan");
  });
  it("humanizes camelCase action names", () => {
    expect(buildActionMessageText({ ...base, name: "requestQuote" })).toBe(
      "Request quote",
    );
  });
  it("renders object values as JSON", () => {
    expect(
      buildActionMessageText({
        ...base,
        context: { message: "Go", form: { name: "A" } },
      }),
    ).toBe('Go\n\nform: {"name":"A"}');
  });
  it("skips null and undefined context values", () => {
    expect(
      buildActionMessageText({
        ...base,
        context: { message: "Go", a: null, b: undefined, c: 0 },
      }),
    ).toBe("Go\n\nc: 0");
  });
});

describe("sendA2UIActionAsMessage", () => {
  it("adds a visible user message and runs the agent", async () => {
    const agent = { addMessage: vi.fn() };
    const copilotkit = { runAgent: vi.fn().mockResolvedValue(undefined) };
    await sendA2UIActionAsMessage({
      action: { ...base, context: { message: "Go" } },
      agent,
      copilotkit,
    });
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Go" }),
    );
    expect(typeof agent.addMessage.mock.calls[0]?.[0]?.id).toBe("string");
    expect(copilotkit.runAgent).toHaveBeenCalledWith({ agent });
  });
});
