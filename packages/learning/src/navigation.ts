import { createRedactor } from "./redact";
import type { Redactor } from "./redact";
import type { Emit } from "./types";

type NavigationType = "push" | "replace" | "traverse" | "reload";
type HistoryMethod = "pushState" | "replaceState";

/** The part of the Navigation API this module uses (not in TypeScript's DOM lib yet). */
interface NavigationTarget {
  addEventListener(
    type: "currententrychange",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "currententrychange",
    listener: (event: Event) => void,
  ): void;
}

function isNavigationTarget(value: unknown): value is NavigationTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    "addEventListener" in value &&
    "removeEventListener" in value
  );
}

function getNavigation() {
  const navigation: unknown = Reflect.get(window, "navigation");
  return isNavigationTarget(navigation) ? navigation : null;
}

function toNavigationType(value: unknown): NavigationType {
  switch (value) {
    case "replace":
    case "traverse":
    case "reload":
      return value;
    default:
      return "push";
  }
}

/**
 * Emits `navigation` when the full URL changes in a single-page app.
 * Uses the Navigation API when it exists. Otherwise patches `pushState` and
 * `replaceState` on the prototype and on the instance, because some routers
 * (Next.js) wrap the instance method.
 */
export function installNavigationCapture(params: {
  emit: Emit;
  routes?: string[];
  redact?: Redactor;
}) {
  const { emit, redact = createRedactor() } = params;
  let current = location.href;

  const check = (navigationType: NavigationType) => {
    try {
      const next = location.href;
      if (next === current) return;
      emit("navigation", {
        from: redact.url(current),
        to: redact.url(next),
        navigationType,
      });
      current = next;
    } catch {
      // Capture must never break navigation.
    }
  };

  const navigation = getNavigation();
  if (navigation !== null) {
    const onEntryChange = (event: Event) =>
      check(toNavigationType(Reflect.get(event, "navigationType")));
    navigation.addEventListener("currententrychange", onEntryChange);
    return () =>
      navigation.removeEventListener("currententrychange", onEntryChange);
  }

  return installHistoryFallback(check);
}

function installHistoryFallback(
  check: (navigationType: NavigationType) => void,
) {
  let active = true;
  const restores: (() => void)[] = [];

  const patch = (target: History, method: HistoryMethod) => {
    const original = target[method];
    const wrapper: History[HistoryMethod] = function (this: History, ...args) {
      const result = original.apply(this, args);
      if (active) check(method === "pushState" ? "push" : "replace");
      return result;
    };
    target[method] = wrapper;
    restores.push(() => {
      // Restore only if no one wrapped it after us; otherwise our wrapper stays as a pass-through.
      if (target[method] === wrapper) target[method] = original;
    });
  };

  const methods: HistoryMethod[] = ["pushState", "replaceState"];
  for (const method of methods) {
    patch(History.prototype, method);
    if (Object.prototype.hasOwnProperty.call(history, method))
      patch(history, method);
  }

  const onPopState = () => check("traverse");
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onPopState);

  return () => {
    active = false;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onPopState);
    for (const restore of restores) restore();
  };
}
