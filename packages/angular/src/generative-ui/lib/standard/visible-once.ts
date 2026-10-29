import {
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  untracked,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import type { GenerativeUIEventProp } from "./context";

/** The `onVisible` handler, kept as a public name of the event prop. */
export type GenerativeUIVisibleHandler = GenerativeUIEventProp;

/**
 * Sends the `onVisible` event of a container once, the first time its host
 * element scrolls into view. Call it in the constructor of the component.
 * The counterpart of React's `useVisibleOnce`.
 */
export function connectVisibleOnce(
  onVisible: () => GenerativeUIEventProp | undefined,
): void {
  const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  let hasFired = false;
  effect((onCleanup) => {
    const handler = onVisible();
    if (
      !handler ||
      hasFired ||
      !isBrowser ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (hasFired) return;
      if (entries.some((entry) => entry.isIntersecting)) {
        hasFired = true;
        void untracked(() => handler({}));
        observer.disconnect();
      }
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
}
