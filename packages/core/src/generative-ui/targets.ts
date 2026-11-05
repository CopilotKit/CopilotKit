import { GENERATIVE_UI_MAX_TARGET_COMPONENTS } from "@copilotkit/shared";
import type { GenerativeUI } from "@copilotkit/shared/generative-ui";

/** Scrolls `element` into view, unless it is already fully on screen. */
export function scrollToSurface(element: HTMLElement) {
  const { top, bottom } = element.getBoundingClientRect();
  if (top >= 0 && bottom <= window.innerHeight) return;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  // jsdom has no scrollIntoView.
  element.scrollIntoView?.({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * The names of `requested` that `ui` has, without repeats, at most the
 * number that the envelope takes. `warning` tells what was dropped.
 */
export function allowedComponents(
  requested: readonly string[],
  ui: GenerativeUI,
) {
  const unique = [...new Set(requested)];
  const unknown = unique.filter((name) => !ui.components.has(name));
  const known = unique.filter((name) => ui.components.has(name));
  const names = known.slice(0, GENERATIVE_UI_MAX_TARGET_COMPONENTS);
  const problems: string[] = [];
  if (unknown.length > 0) {
    problems.push(
      `these components are not in the UI and are ignored: ${unknown.join(", ")}`,
    );
  }
  if (known.length > names.length) {
    problems.push(
      `only the first ${GENERATIVE_UI_MAX_TARGET_COMPONENTS} components are used`,
    );
  }
  return { names, warning: problems.join("; ") };
}
