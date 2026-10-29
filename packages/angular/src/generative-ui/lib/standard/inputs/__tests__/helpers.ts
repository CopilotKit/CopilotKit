import { Component, input } from "@angular/core";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import type { GenerativeUIChildren } from "../../../children";
import { CopilotGenerativeUIChildren } from "../../../children.directive";
import { renderSurface } from "../../../__tests__/render";
import { inputComponents } from "../index";

/** A test-only container, so the inputs tests need no other group. */
@Component({
  selector: "div[testColumn]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: { style: "display: flex; flex-direction: column" },
})
class Column {
  readonly children = input<GenerativeUIChildren>();
}

/** A test-only text leaf, so a test can show a data model value. */
@Component({
  selector: "span[testLabel]",
  template: `
    {{ text() }}
  `,
  host: { "data-testid": "label" },
})
class Label {
  readonly text = input<string | number>();
}

export const ui = createGenerativeUI({
  id: "test/inputs@1",
  components: {
    ...inputComponents,
    Column: { component: Column, slots: { children: "multiple" } },
    Label: {
      component: Label,
      props: z.object({ text: z.union([z.string(), z.number()]).optional() }),
    },
  },
});

export function renderInputs(
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) {
  return renderSurface(ui, components, data);
}

export type View = ReturnType<typeof renderInputs>;

export function query<T extends Element>(view: View, selector: string) {
  const element = view.container.querySelector<T>(selector);
  if (!element) throw new Error(`No element matches "${selector}".`);
  return element;
}

/** The control that `label` labels, through its `for`. */
export function byLabel<T extends HTMLElement>(view: View, label: string) {
  const labels = [...view.container.querySelectorAll("label")];
  const match = labels.find((el) => el.textContent?.trim() === label);
  if (!match) throw new Error(`No label "${label}".`);
  const id = match.getAttribute("for");
  const control = id
    ? view.container.querySelector<T>(`[id="${id}"]`)
    : match.querySelector<T>("input, select, textarea");
  if (!control) throw new Error(`Label "${label}" labels nothing.`);
  return control;
}

export function byAriaLabel<T extends HTMLElement>(view: View, label: string) {
  return query<T>(view, `[aria-label="${label}"]`);
}

export function setValue(
  view: View,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  eventName = element instanceof HTMLSelectElement ? "change" : "input",
) {
  element.value = value;
  view.act(() =>
    element.dispatchEvent(new Event(eventName, { bubbles: true })),
  );
}

export function click(view: View, element: HTMLElement) {
  view.act(() => element.click());
}

export function keyDown(view: View, element: HTMLElement, key: string) {
  view.act(() =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
  );
}

/** The names of the events that the agent got, in order. */
export function sentEventNames(view: View) {
  return view.forwardEvent.mock.calls.map(([event]) => event.name);
}

export const PLAN_OPTIONS = [
  { value: "team", label: "Team" },
  { value: "enterprise", label: "Enterprise" },
];

/** The element of the standard catalog whose own text is `text`. */
export function byText(view: View, text: string): HTMLElement {
  const match = [...view.container.querySelectorAll<HTMLElement>("*")].find(
    (el) =>
      [...el.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent?.trim() === text,
      ),
  );
  if (!match) throw new Error(`No element with the text "${text}".`);
  return match;
}

export const buttonNamed = (container: ParentNode, name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent?.trim() === name ||
      button.getAttribute("aria-label") === name,
  );
