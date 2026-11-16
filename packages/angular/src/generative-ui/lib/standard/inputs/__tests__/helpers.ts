import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import { renderSurface, testComponents } from "../../../__tests__/render";
import { press, query } from "../../../__tests__/dom";
import { inputComponents } from "../index";

export const ui = createGenerativeUI({
  id: "test/inputs@1",
  components: { ...inputComponents, ...testComponents },
});

export function renderInputs(
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) {
  return renderSurface(ui, components, data);
}

export type View = ReturnType<typeof renderInputs>;

export function byAriaLabel<T extends HTMLElement>(
  root: ParentNode,
  label: string,
) {
  return query<T>(root, `[aria-label="${label}"]`);
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

export function keyDown(view: View, element: HTMLElement, key: string) {
  view.act(() => press(element, key));
}

/** The names of the events that the agent got, in order. */
export function sentEventNames(view: View) {
  return view.forwardEvent.mock.calls.map(([event]) => event.name);
}

export const PLAN_OPTIONS = [
  { value: "team", label: "Team" },
  { value: "enterprise", label: "Enterprise" },
];
