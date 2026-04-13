import { createApplication } from "@angular/platform-browser";
import { createCustomElement } from "@angular/elements";
import { ThreadListComponent } from "./thread-list/thread-list.component";
import { ThreadDetailsComponent } from "./thread-details/thread-details.component";
import { EmptyEventsComponent } from "./empty-events/empty-events.component";

export const THREAD_LIST_TAG = "cpk-thread-list" as const;
export const THREAD_DETAILS_TAG = "cpk-thread-details" as const;
export const EMPTY_EVENTS_TAG = "cpk-empty-events" as const;

/**
 * Registers CopilotKit inspector Custom Elements with the browser's
 * CustomElementRegistry. Safe to call multiple times — skips tags that are
 * already registered.
 *
 * Call this once at app startup (or lazily before first use):
 *
 * ```ts
 * import { defineInspectorElements } from "@copilotkit/web-inspector-angular";
 * defineInspectorElements();
 * ```
 *
 * After this, `<cpk-thread-list>` works as a plain HTML element in any
 * framework (React, Angular, Vue, or vanilla JS).
 */
let appPromise: ReturnType<typeof createApplication> | null = null;

export async function defineInspectorElements(): Promise<void> {
  appPromise ??= createApplication();
  const app = await appPromise;

  if (!customElements.get(THREAD_LIST_TAG)) {
    const ThreadListElement = createCustomElement(ThreadListComponent, {
      injector: app.injector,
    });
    customElements.define(THREAD_LIST_TAG, ThreadListElement);
  }

  if (!customElements.get(THREAD_DETAILS_TAG)) {
    const ThreadDetailsElement = createCustomElement(ThreadDetailsComponent, {
      injector: app.injector,
    });
    customElements.define(THREAD_DETAILS_TAG, ThreadDetailsElement);
  }

  if (!customElements.get(EMPTY_EVENTS_TAG)) {
    const EmptyEventsElement = createCustomElement(EmptyEventsComponent, {
      injector: app.injector,
    });
    customElements.define(EMPTY_EVENTS_TAG, EmptyEventsElement);
  }
}
