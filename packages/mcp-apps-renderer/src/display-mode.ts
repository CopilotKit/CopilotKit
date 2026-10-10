// Display modes of the MCP Apps host (`ui/request-display-mode`).
//
// Bridge-free on purpose: the framework adapters import this surface through
// the `/activity` entry to render the mode a widget was granted, while the
// session (root entry) negotiates it with the widget. Keeping the two apart
// means a `<CopilotKit>` app that never renders an MCP App still does not load
// the ext-apps bundle.

/**
 * A display mode this host renders. The ext-apps spec also lets a widget ask
 * for `pip`; no CopilotKit frontend renders a picture-in-picture surface, so
 * that request keeps the current mode and the host API never carries it.
 */
export type McpAppsDisplayMode = "inline" | "fullscreen";

/** Display modes every CopilotKit frontend renders. */
export const HOST_SUPPORTED_DISPLAY_MODES: readonly McpAppsDisplayMode[] = [
  "inline",
  "fullscreen",
];

/** Whether a mode a widget asked for is one this host can render at all. */
export function isHostDisplayMode(mode: unknown): mode is McpAppsDisplayMode {
  return HOST_SUPPORTED_DISPLAY_MODES.includes(mode as McpAppsDisplayMode);
}

/**
 * The surface a widget gets in a mode (host context `containerDimensions`).
 * `fullscreen` advertises the viewport; `inline` advertises the holder's width
 * and the height the widget last reported, each only when known.
 */
export interface McpAppContainerDimensions {
  width: number;
  height: number;
}

/**
 * The modes this host offers a widget: the host-rendered modes, narrowed by
 * an explicit `hostContext.availableDisplayModes` from the session options.
 * `inline` is never removed, since every widget starts there.
 */
export function resolveHostDisplayModes(
  configured: unknown,
): McpAppsDisplayMode[] {
  const supported = [...HOST_SUPPORTED_DISPLAY_MODES];
  if (!Array.isArray(configured)) return supported;
  const narrowed = supported.filter((mode) => configured.includes(mode));
  return narrowed.includes("inline") ? narrowed : ["inline", ...narrowed];
}

/**
 * The viewport, which is the surface `fullscreen` advertises when the adapter
 * reports none; nothing for `inline` (the session measures that one itself).
 */
export function defaultContainerDimensions(
  mode: McpAppsDisplayMode,
): McpAppContainerDimensions | undefined {
  if (mode !== "fullscreen" || typeof window === "undefined") return undefined;
  return {
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
  };
}

/**
 * Open the widget's `<dialog>` surface for a mode. `inline` opens it in normal
 * flow (`show()`); `fullscreen` opens it in the browser top layer
 * (`showModal()`), which fills the viewport whatever containing block an
 * ancestor establishes (CopilotKit's chat container uses `container-type`,
 * which would trap a `position: fixed` overlay inside the chat panel). The
 * iframe stays inside the dialog across transitions, so switching modes never
 * reloads the widget.
 *
 * Opening a dialog runs the browser's dialog focusing steps, which move focus
 * into it. That is wanted for `fullscreen` (the adapter then lands focus on
 * its exit button) but not for `inline`: a widget arriving in the chat while
 * the user types must not take the focus away from the composer, so the
 * element focused before an inline `show()` gets it back.
 *
 * The applied mode is recorded on `data-mcp-app-display-mode`, which is also
 * what tells a later call whether the dialog must be closed and reopened. Where
 * the top layer is unavailable (jsdom), the dialog is merely marked `open`.
 */
export function ɵshowDialogForMode(
  dialog: HTMLDialogElement,
  mode: McpAppsDisplayMode,
): void {
  const modal = mode === "fullscreen";
  if (
    typeof dialog.showModal !== "function" ||
    typeof dialog.show !== "function"
  ) {
    if (!dialog.open) dialog.setAttribute("open", "");
    dialog.setAttribute("data-mcp-app-display-mode", mode);
    return;
  }
  const wasModal =
    dialog.getAttribute("data-mcp-app-display-mode") === "fullscreen";
  if (dialog.open && wasModal !== modal) dialog.close();
  if (!dialog.open) {
    if (modal) {
      dialog.showModal();
    } else {
      const focusedBefore = dialog.ownerDocument.activeElement;
      dialog.show();
      restoreFocus(dialog, focusedBefore);
    }
  }
  dialog.setAttribute("data-mcp-app-display-mode", mode);
}

/** Give the focus back to what had it before an inline `show()` moved it. */
function restoreFocus(
  dialog: HTMLDialogElement,
  focusedBefore: Element | null,
) {
  const doc = dialog.ownerDocument;
  const focusedNow = doc.activeElement;
  if (focusedNow === focusedBefore || !dialog.contains(focusedNow)) return;
  if (
    focusedBefore instanceof HTMLElement &&
    focusedBefore.isConnected &&
    focusedBefore !== doc.body
  ) {
    focusedBefore.focus({ preventScroll: true });
  } else if (focusedNow instanceof HTMLElement) {
    // Nothing had the focus: do not leave it inside the widget either.
    focusedNow.blur();
  }
}

// One lock for the whole page: with two widgets in fullscreen at once, the
// first one to exit must not unlock the page while the second is still open.
let scrollLockHolders = 0;
let bodyOverflowBeforeLock = "";

/**
 * Lock the page scroll behind a fullscreen widget. Returns the release
 * function; releasing twice is a no-op. The page scrolls again once the last
 * holder has released.
 */
export function ɵlockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (scrollLockHolders === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockHolders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockHolders -= 1;
    if (scrollLockHolders === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock;
    }
  };
}
