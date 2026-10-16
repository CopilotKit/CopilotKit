import { describe, expect, it } from "vitest";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIUserEvent,
} from "@copilotkit/shared";
import {
  buildActionMessageText,
  createComponentLabelResolver,
} from "../action-message";

function userEvent(
  overrides: Partial<GenerativeUIUserEvent> = {},
): GenerativeUIUserEvent {
  return {
    name: "choose_plan",
    surfaceId: "plans",
    componentId: "btn",
    context: {},
    ...overrides,
  };
}

function updateComponents(...components: A2UIComponentNode[]): A2UIOperation {
  return {
    version: "v0.9",
    updateComponents: { surfaceId: "plans", components },
  };
}

describe("buildActionMessageText", () => {
  it("uses context.message and appends the other context fields", () => {
    const text = buildActionMessageText(
      userEvent({
        context: { message: "Pick the Team plan", seats: 12, annual: true },
      }),
    );
    expect(text).toBe("Pick the Team plan\n\nseats: 12\nannual: true");
  });

  it("falls back to context.label", () => {
    const text = buildActionMessageText(
      userEvent({ context: { label: "Request quote" } }),
    );
    expect(text).toBe("Request quote");
  });

  it("skips a blank context.message", () => {
    const text = buildActionMessageText(
      userEvent({ context: { message: "   ", label: "Request quote" } }),
    );
    expect(text).toBe("Request quote");
  });

  it("makes a snake_case event name readable when there is no text", () => {
    expect(buildActionMessageText(userEvent())).toBe("Choose plan");
  });

  it("makes a camelCase event name readable", () => {
    expect(buildActionMessageText(userEvent({ name: "requestQuote" }))).toBe(
      "Request quote",
    );
  });

  it("writes object values as JSON", () => {
    const text = buildActionMessageText(
      userEvent({ context: { message: "Go", form: { name: "A" } } }),
    );
    expect(text).toBe('Go\n\nform: {"name":"A"}');
  });

  it("skips null and undefined context values but keeps 0", () => {
    const text = buildActionMessageText(
      userEvent({ context: { message: "Go", a: null, b: undefined, c: 0 } }),
    );
    expect(text).toBe("Go\n\nc: 0");
  });
});

describe("buildActionMessageText with a label resolver", () => {
  const resolveLabel = (id: string) =>
    id === "btn" ? "Choose Team" : undefined;

  it("uses the source component label when the context has no text", () => {
    expect(buildActionMessageText(userEvent(), resolveLabel)).toBe(
      "Choose Team",
    );
  });

  it("prefers context.message and context.label over the component label", () => {
    expect(
      buildActionMessageText(
        userEvent({ context: { message: "Msg" } }),
        resolveLabel,
      ),
    ).toBe("Msg");
    expect(
      buildActionMessageText(
        userEvent({ context: { label: "Lbl" } }),
        resolveLabel,
      ),
    ).toBe("Lbl");
  });

  it("falls back to the event name when the resolver finds no label", () => {
    expect(buildActionMessageText(userEvent(), () => undefined)).toBe(
      "Choose plan",
    );
    expect(buildActionMessageText(userEvent(), () => "   ")).toBe(
      "Choose plan",
    );
  });
});

describe("createComponentLabelResolver", () => {
  const operations: A2UIOperation[] = [
    {
      version: "v0.9",
      createSurface: { surfaceId: "plans", catalogId: "shop" },
    },
    updateComponents(
      { id: "a", component: "Button", label: "Own label", child: "x" },
      { id: "b", component: "Button", child: "b-text" },
      { id: "b-text", component: "Text", text: "Child text" },
      { id: "c", component: "Row", children: ["c-icon", "c-text"] },
      { id: "c-icon", component: "Icon", name: "star" },
      { id: "c-text", component: "Text", text: "Second child" },
      { id: "d", component: "Text", text: "Plain text" },
      { id: "e", component: "Button", child: "missing" },
      { id: "f", component: "Text", text: { path: "/x" } },
    ),
  ];
  const resolve = createComponentLabelResolver(operations);

  it("uses the component's own label first", () => {
    expect(resolve("a")).toBe("Own label");
  });

  it("uses the component's own text", () => {
    expect(resolve("d")).toBe("Plain text");
  });

  it("uses the text of the single child", () => {
    expect(resolve("b")).toBe("Child text");
  });

  it("uses the first child that has a string text or label", () => {
    expect(resolve("c")).toBe("Second child");
  });

  it("returns undefined for unknown ids, missing children and bound text", () => {
    expect(resolve("zzz")).toBeUndefined();
    expect(resolve("e")).toBeUndefined();
    expect(resolve("f")).toBeUndefined();
  });

  it("uses the last definition of a component that is sent again", () => {
    const later = createComponentLabelResolver([
      ...operations,
      updateComponents({ id: "a", component: "Button", label: "New label" }),
    ]);
    expect(later("a")).toBe("New label");
  });
});
