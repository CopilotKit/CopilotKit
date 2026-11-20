import { defineComponent } from "vue";
import { z } from "zod";
import { createGenerativeUI } from "../../../catalog";
import type { renderSurface } from "../../../__tests__/helpers/render-surface";
import { layoutComponents } from "../index";

/** A test-only text leaf, so the layout tests need no other group. */
const Label = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<span>{{ text }}</span>`,
});

export const ui = createGenerativeUI({
  id: "test/layout@1",
  components: {
    ...layoutComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

export const spacing = (steps: number) =>
  `calc(var(--spacing, 0.25rem) * ${steps})`;

/** The container around the Label with this text. */
export async function parentOf(
  view: ReturnType<typeof renderSurface>,
  text: string,
) {
  const label = await view.findByText(text);
  const parent = label.parentElement;
  if (!parent) throw new Error(`"${text}" has no parent element.`);
  return parent;
}
