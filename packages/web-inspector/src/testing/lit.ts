import { render } from "lit";
import type { TemplateResult } from "lit";

export function mount(template: TemplateResult): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(template, container);
  return container;
}

export function requireElement<T extends Node>(
  element: T | null | undefined,
  description: string,
): T {
  if (!element) throw new Error(description);
  return element;
}
