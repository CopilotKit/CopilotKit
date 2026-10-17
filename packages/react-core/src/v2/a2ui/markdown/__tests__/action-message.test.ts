import { describe, expect, it, vi } from "vitest";
import {
  buildActionMessageText,
  createComponentLabelResolver,
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

describe("buildActionMessageText label fallback", () => {
  const resolveLabel = (id: string) =>
    id === "btn" ? "Choose Team" : undefined;
  it("uses the resolved button label when context has no message or label", () => {
    expect(buildActionMessageText({ ...base }, resolveLabel)).toBe(
      "Choose Team",
    );
  });
  it("prefers context.message and context.label over the resolved label", () => {
    expect(
      buildActionMessageText(
        { ...base, context: { message: "Msg" } },
        resolveLabel,
      ),
    ).toBe("Msg");
    expect(
      buildActionMessageText(
        { ...base, context: { label: "Lbl" } },
        resolveLabel,
      ),
    ).toBe("Lbl");
  });
  it("falls back to the humanized name when the resolver finds nothing", () => {
    expect(buildActionMessageText({ ...base }, () => undefined)).toBe(
      "Choose plan",
    );
    expect(buildActionMessageText({ ...base }, () => "   ")).toBe(
      "Choose plan",
    );
  });
});

describe("createComponentLabelResolver", () => {
  const ops = [
    { createSurface: { surfaceId: "s", catalogId: "c" } },
    {
      updateComponents: {
        surfaceId: "s",
        components: [
          { id: "a", component: "Button", label: "Own label", child: "x" },
          { id: "b", component: "Button", child: "b-text" },
          { id: "b-text", component: "Text", text: "Child text" },
          { id: "c", component: "Row", children: ["c-icon", "c-text"] },
          { id: "c-icon", component: "Icon", name: "star" },
          { id: "c-text", component: "Text", text: "Second child" },
          { id: "d", component: "Text", text: "Plain text" },
          { id: "e", component: "Button", child: "missing" },
          { id: "f", component: "Text", text: { path: "/x" } },
        ],
      },
    },
  ];
  const resolve = createComponentLabelResolver(ops);
  it("uses the component's own label first", () => {
    expect(resolve("a")).toBe("Own label");
  });
  it("uses the component's text", () => {
    expect(resolve("d")).toBe("Plain text");
  });
  it("uses the child component's text", () => {
    expect(resolve("b")).toBe("Child text");
  });
  it("uses the first child with a string text or label", () => {
    expect(resolve("c")).toBe("Second child");
  });
  it("returns undefined for unknown ids, missing children and bound text", () => {
    expect(resolve("zzz")).toBeUndefined();
    expect(resolve("e")).toBeUndefined();
    expect(resolve("f")).toBeUndefined();
  });
  it("uses the latest definition of a re-sent component", () => {
    const later = createComponentLabelResolver([
      ...ops,
      {
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "a", component: "Button", label: "New label" }],
        },
      },
    ]);
    expect(later("a")).toBe("New label");
  });
});

describe("sendA2UIActionAsMessage label resolver", () => {
  it("passes the resolver through to the message text", async () => {
    const agent = { addMessage: vi.fn() };
    const copilotkit = { runAgent: vi.fn().mockResolvedValue(undefined) };
    await sendA2UIActionAsMessage({
      action: { ...base },
      agent,
      copilotkit,
      resolveLabel: () => "Choose Team",
    });
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Choose Team" }),
    );
  });
});
