import { defineComponent } from "vue";
import { z } from "zod";
import type { A2UIComponentNode, A2UIOperation } from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import {
  renderSurface,
  SURFACE_ID,
} from "../../../__tests__/helpers/render-surface";
import { mediaComponents } from "../index";

/** A test-only column, so the media tests need no layout group. */
const Column = defineComponent({
  template: `<div data-testid="column"><slot name="children" /></div>`,
});

/** A test-only text leaf, so the media tests need no text group. */
const Label = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<span>{{ text }}</span>`,
});

export const ui = createGenerativeUI({
  id: "test/media@1",
  components: {
    ...mediaComponents,
    Column: { component: Column, slots: { children: "multiple" } },
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

/** Renders the media nodes in a Column, then a Label "end" after them. */
export function renderInColumn(...nodes: A2UIComponentNode[]) {
  return renderSurface(ui, [
    {
      id: "root",
      component: "Column",
      children: [...nodes.map((node) => node.id), "end"],
    },
    ...nodes,
    { id: "end", component: "Label", text: "end" },
  ]);
}

/** An operation that writes `value` at `path` of the surface data model. */
export function updateDataModel(path: string, value: unknown): A2UIOperation {
  return {
    version: "1.0",
    updateDataModel: { surfaceId: SURFACE_ID, path, value },
  };
}

export const imageByAlt = (container: Element, alt: string) =>
  container.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);

/** The open lightbox, teleported to `body`, or `null`. */
export const lightbox = () => document.querySelector("[data-a2ui-lightbox]");

/** The src of the image in the open lightbox. */
export const shownSrc = () =>
  lightbox()?.querySelector("img")?.getAttribute("src");
