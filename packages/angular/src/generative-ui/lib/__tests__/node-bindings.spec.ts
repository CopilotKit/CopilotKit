import { Component, input, model } from "@angular/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withoutRejectedNulls } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import { renderSurface, updateComponents, updateDataModel } from "./render";

type Handler = (args?: unknown) => Promise<GenerativeUIInvokeResult>;

@Component({
  selector: "test-button",
  template: `
    <button data-button [disabled]="!onClick()" (click)="click()">
      {{ label() }}
    </button>
  `,
})
class Button {
  readonly label = input<string>();
  readonly onClick = input<Handler>();
  readonly onHover = input<Handler>();
  lastResult: GenerativeUIInvokeResult | undefined;
  async click() {
    this.lastResult = await this.onClick()?.({ source: "button" });
  }
}

@Component({
  selector: "test-field",
  template: `
    <input
      data-field
      [value]="value() ?? ''"
      (input)="value.set($any($event.target).value)"
    />
  `,
})
class Field {
  readonly value = model<string>();
}

@Component({
  selector: "test-text",
  template: `
    <span data-text>{{ text() }}</span>
  `,
})
class Text {
  readonly text = input<string | null>();
}

@Component({
  selector: "test-number",
  template: `
    <span data-number>{{ value() }}</span>
  `,
})
class NumberView {
  readonly value = input<number>();
}

const ui = createGenerativeUI({
  id: "test/bindings@1",
  components: {
    // Both events match no function, so the model binds them.
    Button: {
      component: Button,
      props: z.object({ label: z.string() }),
      events: {
        onClick: {
          description: "click",
          parameters: z.object({ source: z.string().optional() }),
        },
        onHover: { description: "hover", parameters: z.object({}) },
      },
    },
    Field: {
      component: Field,
      props: z.object({ value: z.string().optional() }),
      writable: ["value"],
    },
    Text: {
      component: Text,
      props: z.object({ text: z.string().nullable().optional() }),
    },
    Number: {
      component: NumberView,
      props: z.object({ value: z.number() }),
    },
  },
});

const text = (container: HTMLElement, selector: string) =>
  container.querySelector(selector)?.textContent?.trim();

// The event bindings that the model sends (event and functionCall) and the
// matched events are in surface-view.spec.ts; only the absence is here.
describe("events", () => {
  it("leaves an unbound event without a handler", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Button", label: "Idle" },
    ]);
    const button =
      view.container.querySelector<HTMLButtonElement>("[data-button]")!;
    expect(button.disabled).toBe(true);
  });
});

describe("writable props", () => {
  it("writes a path-bound prop to the data model, and keeps it over an agent write", () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Field", value: { "@path": "/name" } }],
      { name: "agent" },
    );
    const field =
      view.container.querySelector<HTMLInputElement>("[data-field]")!;
    expect(field.value).toBe("agent");
    field.value = "typed";
    view.act(() => field.dispatchEvent(new Event("input")));
    expect(view.dataAt("/name")).toBe("typed");
    expect(field.value).toBe("typed");
    // The user owns the path now: the agent's value does not replace it.
    view.update(updateDataModel("/name", "later"));
    expect(view.dataAt("/name")).toBe("typed");
    expect(field.value).toBe("typed");
  });

  it("keeps a literal prop's value local to the node", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Field", value: "literal" },
    ]);
    const field =
      view.container.querySelector<HTMLInputElement>("[data-field]")!;
    expect(field.value).toBe("literal");
    field.value = "mine";
    view.act(() => field.dispatchEvent(new Event("input")));
    expect(field.value).toBe("mine");
    expect(view.dataAt("/value")).toBeUndefined();
  });
});

// The dynamic values of props have their own spec, as in React
// (dynamic-values.spec.ts); the writable prop of a template item is in
// surface-view.spec.ts under "template slots".

describe("props set to null", () => {
  it("reads a literal null on an optional prop as an unset prop", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Field", value: null },
    ]);
    expect(
      view.container.querySelector<HTMLInputElement>("[data-field]")?.value,
    ).toBe("");
    expect(
      view.container.querySelector("[data-generative-ui-error]"),
    ).toBeNull();
  });

  it("reads a binding to a null value as an unset prop", () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Field", value: { "@path": "/missing" } }],
      { missing: null },
    );
    expect(
      view.container.querySelector<HTMLInputElement>("[data-field]")?.value,
    ).toBe("");
  });

  it("keeps null for a prop whose schema accepts it", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Text", text: null },
    ]);
    expect(view.container.querySelector("[data-text]")).not.toBeNull();
    expect(
      view.container.querySelector("[data-generative-ui-error]"),
    ).toBeNull();
  });

  // A wrong value that is not null still fails: surface-view.spec.ts, "shows
  // a local fallback when bound data has the wrong type".

  it("drops only the top-level nulls that the schema rejected", () => {
    expect(
      withoutRejectedNulls({ a: null, b: null, c: 1 }, [
        { message: "Expected string", path: ["a"] },
      ]),
    ).toEqual({ b: null, c: 1 });
    expect(
      withoutRejectedNulls({ list: [null] }, [
        { message: "Expected string", path: ["list", 0] },
      ]),
    ).toBeUndefined();
  });
});

describe("updates", () => {
  it("replaces the component when the agent sends another type for the same id", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Text", text: "one" },
    ]);
    expect(text(view.container, "[data-text]")).toBe("one");
    view.update(
      updateComponents({ id: "root", component: "Number", value: 2 }),
    );
    expect(view.container.querySelector("[data-text]")).toBeNull();
    expect(text(view.container, "[data-number]")).toBe("2");
  });
});
