import { createApplication } from "@angular/platform-browser";
import { createCustomElement } from "@angular/elements";
import { ThreadListComponent } from "./thread-list/thread-list.component";
import { ThreadDetailsComponent } from "./thread-details/thread-details.component";

export const THREAD_LIST_TAG = "cpk-thread-list" as const;
export const THREAD_DETAILS_TAG = "cpk-thread-details" as const;

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
export async function defineInspectorElements(): Promise<void> {
  // createApplication bootstraps a minimal Angular environment without
  // requiring a full AppModule or a root component in the DOM.
  const app = await createApplication();

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
}
