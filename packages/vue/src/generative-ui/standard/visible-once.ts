import { toValue, watchEffect } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { GenerativeUIEventProp } from "./context";

/**
 * Sends the `onVisible` event of a component once, the first time its
 * element scrolls into view. No observer is made while the event is not
 * bound, and none without `IntersectionObserver` (on the server, or in an
 * old browser): then the event is not sent. The observer stops when the
 * component unmounts.
 *
 * @param target - The template ref of the element to watch.
 * @param onVisible - The bound event, as a ref or a getter, for example
 *   `() => props.onVisible`.
 *
 * @example
 * ```ts
 * // In the template: <div ref="root">
 * const root = ref<HTMLElement | null>(null);
 * useVisibleOnce(root, () => props.onVisible);
 * ```
 */
export function useVisibleOnce(
  target: Readonly<Ref<Element | null>>,
  onVisible: MaybeRefOrGetter<GenerativeUIEventProp | undefined>,
) {
  let hasFired = false;
  // `post`: after the render, so the template ref is set. A `post` effect
  // does not run during server rendering.
  watchEffect(
    (onCleanup) => {
      const element = target.value;
      const handler = toValue(onVisible);
      const cannotObserve =
        !handler ||
        !element ||
        hasFired ||
        typeof IntersectionObserver === "undefined";
      if (cannotObserve) return;
      const observer = new IntersectionObserver((entries) => {
        if (hasFired) return;
        if (entries.some((entry) => entry.isIntersecting)) {
          hasFired = true;
          void handler({});
          observer.disconnect();
        }
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    },
    { flush: "post" },
  );
}
