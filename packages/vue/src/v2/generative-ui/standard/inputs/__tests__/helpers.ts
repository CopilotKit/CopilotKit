import { defineComponent } from "vue";
import { z } from "zod";
import type { A2UIComponentNode, A2UIOperation } from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import {
  SURFACE_ID,
  renderSurface,
} from "../../../__tests__/helpers/render-surface";
import { inputComponents } from "../index";

// Test-only stand-ins for the layout and text components of other groups:
// a Column and a Row that lay out their children, and leaves that show a
// data model value.

const Column = defineComponent({
  template: `<div data-testid="column"><slot name="children" /></div>`,
});
const Row = defineComponent({
  template: `<div data-testid="row"><slot name="children" /></div>`,
});
const Label = defineComponent({
  props: { text: [String, Number] },
  template: `<span data-testid="label">{{ text }}</span>`,
});
const Text = defineComponent({
  props: { text: [String, Number] },
  template: `<span>{{ text }}</span>`,
});

const leafProps = z.object({
  text: z.union([z.string(), z.number()]).optional(),
});

export const ui = createGenerativeUI({
  id: "test/inputs@1",
  components: {
    ...inputComponents,
    Column: { component: Column, slots: { children: "multiple" } },
    Row: { component: Row, slots: { children: "multiple" } },
    Label: { component: Label, props: leafProps },
    Text: { component: Text, props: leafProps },
  },
});

/** Renders the input components, the stand-ins and `components` on a surface. */
export function renderInputs(
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) {
  return renderSurface(ui, components, data);
}

export type InputsView = ReturnType<typeof renderInputs>;

/** An agent write to the data model of the test surface. */
export function agentWrite(path: string, value: unknown): A2UIOperation {
  return {
    version: "1.0",
    updateDataModel: { surfaceId: SURFACE_ID, path, value },
  };
}

/** The element as a `type` element. Fails the test when it is another kind. */
export function narrow<Kind extends HTMLElement>(
  element: HTMLElement,
  type: new () => Kind,
) {
  if (!(element instanceof type)) {
    throw new Error(`Expected a ${type.name}, got <${element.tagName}>.`);
  }
  return element;
}

/** The names of the events that the agent got, in order. */
export function sentEventNames(view: InputsView) {
  return view.forwardEvent.mock.calls.map(([event]) => event.name);
}

export const PLAN_OPTIONS = [
  { value: "team", label: "Team" },
  { value: "enterprise", label: "Enterprise" },
];
