import type { CopilotKitCore } from "@copilotkit/core";
import type { InspectorOpenOptions, WebInspectorElement } from "./index";
import type { NotificationContext } from "./lib/notifications";

/**
 * The parts of `@copilotkit/web-inspector` that mounting needs. Adapters pass a
 * loader that returns the module, so the Inspector bundle stays a lazy chunk.
 *
 * @internal Framework adapters use this type. Applications must not depend on it.
 */
export interface ɵWebInspectorModule {
  WEB_INSPECTOR_TAG: string;
  defineWebInspector(): void;
  configureWebInspectorElement(
    inspector: WebInspectorElement,
    core: CopilotKitCore | null,
    notificationContext?: NotificationContext,
  ): WebInspectorElement;
}

/** @internal Options for {@link ɵmountInspector}. */
export interface ɵMountInspectorOptions {
  /** Loads the Inspector module, for example `() => import("@copilotkit/web-inspector")`. */
  load: () => Promise<ɵWebInspectorModule>;
  /** Development flag, framework name and SDK version for Inspector notifications. */
  notificationContext: NotificationContext;
}

/** @internal The handle {@link ɵmountInspector} returns. */
export interface ɵInspectorMount {
  /**
   * Opens the Inspector at a message. A request made before the element loads
   * is kept, and the latest one opens as soon as the element is ready.
   */
  open(request: InspectorOpenOptions): void;
  /** Points the Inspector at another core. */
  setCore(core: CopilotKitCore | null): void;
  /**
   * Calls `listener` when the Inspector shows or hides, and with `false` when
   * the mount is disposed while visible. Returns an unsubscribe function.
   */
  onVisibility(listener: (visible: boolean) => void): () => void;
  /** The mounted element, or `null` before it loads and after disposal. */
  readonly element: WebInspectorElement | null;
  /** Calls `listener` once the element is mounted. Returns an unsubscribe function. */
  onElement(listener: (element: WebInspectorElement) => void): () => void;
  /** Stops a pending load and removes the element this mount created. */
  dispose(): void;
}

const VISIBILITY_EVENT = "cpk-inspector-visibility-change";

/**
 * Elements created by a mount. An Inspector element an application placed in
 * the page itself is adopted instead of duplicated; one owned by another
 * mount (for example a second provider) is not, so disposing one provider
 * never reconfigures or removes the other's Inspector.
 */
const mountedElements = new WeakSet<Element>();

function readVisibility(event: Event) {
  return event instanceof CustomEvent && event.detail?.visible === true;
}

/**
 * Loads the Inspector web component and mounts it in `host`, configured with
 * `core` before it connects to the document.
 *
 * Framework adapters own only the host element and their lifecycle: create
 * the mount when the host mounts, forward core changes and open requests, and
 * call `dispose()` when it unmounts. Visibility rules are the caller's job
 * (see `shouldEnableInspector` in `@copilotkit/shared`).
 *
 * @example
 * const mount = ɵmountInspector(hostElement, core, {
 *   load: () => import("@copilotkit/web-inspector"),
 *   notificationContext: { development: true, framework: "react", sdkVersion },
 * });
 * mount.open({ messageId });
 * mount.dispose();
 *
 * @internal Framework adapters use this function. Applications must not depend on it.
 */
export function ɵmountInspector(
  host: Element,
  core: CopilotKitCore | null,
  options: ɵMountInspectorOptions,
) {
  let currentCore = core;
  let element: WebInspectorElement | null = null;
  let ownsElement = false;
  let disposed = false;
  let visible = false;
  let pendingRequest: InspectorOpenOptions | null = null;
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const elementListeners = new Set<(element: WebInspectorElement) => void>();

  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    for (const listener of [...visibilityListeners]) listener(next);
  };

  const handleVisibilityChange = (event: Event) => {
    setVisible(readVisibility(event));
  };

  const attach = (mod: ɵWebInspectorModule) => {
    mod.defineWebInspector();
    const document = host.ownerDocument;
    const existing = document.querySelector<WebInspectorElement>(
      mod.WEB_INSPECTOR_TAG,
    );
    const adopted =
      existing !== null && !mountedElements.has(existing) ? existing : null;
    const inspector =
      adopted ??
      (document.createElement(mod.WEB_INSPECTOR_TAG) as WebInspectorElement);

    mod.configureWebInspectorElement(
      inspector,
      currentCore,
      options.notificationContext,
    );
    inspector.addEventListener(VISIBILITY_EVENT, handleVisibilityChange);
    if (!adopted) {
      mountedElements.add(inspector);
      ownsElement = true;
      host.appendChild(inspector);
    }
    element = inspector;

    for (const listener of [...elementListeners]) listener(inspector);
    const request = pendingRequest;
    pendingRequest = null;
    if (request) inspector.openInspector("message_toolbar", request);
  };

  options
    .load()
    .then((mod) => {
      if (!disposed) attach(mod);
    })
    .catch((error: unknown) => {
      console.error("Failed to load CopilotKit inspector:", error);
    });

  return {
    open(request) {
      if (disposed) return;
      if (element) {
        element.openInspector("message_toolbar", request);
        return;
      }
      pendingRequest = { ...request };
    },
    setCore(nextCore) {
      currentCore = nextCore;
      if (element) element.core = nextCore;
    },
    onVisibility(listener) {
      visibilityListeners.add(listener);
      return () => {
        visibilityListeners.delete(listener);
      };
    },
    get element() {
      return element;
    },
    onElement(listener) {
      elementListeners.add(listener);
      return () => {
        elementListeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingRequest = null;
      if (element) {
        element.removeEventListener(VISIBILITY_EVENT, handleVisibilityChange);
        if (ownsElement) {
          mountedElements.delete(element);
          element.remove();
        }
      }
      element = null;
      setVisible(false);
      visibilityListeners.clear();
      elementListeners.clear();
    },
  } satisfies ɵInspectorMount;
}
