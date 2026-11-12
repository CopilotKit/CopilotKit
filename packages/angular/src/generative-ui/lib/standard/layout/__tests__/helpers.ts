import { createGenerativeUI } from "../../../catalog";
import { testComponents } from "../../../__tests__/render";
import type { SurfaceRender } from "../../../__tests__/render";
import { layoutComponents } from "../index";

export const ui = createGenerativeUI({
  id: "test/layout@1",
  components: { ...layoutComponents, Label: testComponents.Label },
});

export const spacing = (steps: number) =>
  `calc(var(--spacing, 0.25rem) * ${steps})`;

/** The label element with this text. */
export function labelOf(view: SurfaceRender, text: string) {
  const labels = view.container.querySelectorAll("[data-testid=label]");
  const label = [...labels].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!label) throw new Error(`"${text}" was not rendered.`);
  return label as HTMLElement;
}

/** The container around the Label with this text. */
export function parentOf(view: SurfaceRender, text: string) {
  const parent = labelOf(view, text).parentElement;
  if (!parent) throw new Error(`"${text}" has no parent element.`);
  return parent;
}
