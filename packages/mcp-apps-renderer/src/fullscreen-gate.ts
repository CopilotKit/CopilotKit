// When a widget may take the page with `ui/request-display-mode: fullscreen`.
//
// Fullscreen renders in a modal dialog that makes the rest of the page inert,
// so it needs a user action on the widget itself. Transient activation
// (`navigator.userActivation.isActive`) belongs to the whole top-level window:
// a key press in the chat composer activates it just as a click in the widget
// does. On its own it would let a widget that asks in a loop take the page as
// soon as the user types. The gate therefore also asks where the gesture was:
//
// - the widget's iframe must hold the focus (a click or a key press in the
//   widget gives it the focus; one in the composer or in another widget does
//   not);
// - no gesture may have reached the host page recently. Events inside the
//   widget's iframe never reach the host document, so a recent host-side
//   `pointerdown` or `keydown` means the activation may come from the host.
//
// The state is page-wide, not per session: a host gesture or an exit from
// fullscreen counts for every widget on the page.

/**
 * How long a host-side gesture may still be what keeps the page activated.
 * Chromium and Firefox keep transient activation for 5 seconds.
 */
export const HOST_GESTURE_WINDOW_MS = 5_000;

/** How often the host looks for the activation to have expired after an exit. */
const ACTIVATION_RESET_POLL_MS = 200;

let lastHostGestureAt = Number.NEGATIVE_INFINITY;
const trackedDocuments = new WeakSet<Document>();

// Set when the host took a widget out of fullscreen (close button, Escape).
// Transient activation outlives that gesture for a duration the browser
// chooses, so fullscreen stays refused until the activation has been observed
// inactive; an activation seen after that comes from a newer gesture. Without
// the activation API nothing can be observed, so the block then stays.
let refusedUntilActivationReset = false;
let activationResetWatch: ReturnType<typeof setInterval> | undefined;

/** The User Activation API, where the browser exposes it. */
function userActivationApi(): { isActive: boolean } | undefined {
  return (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
}

function noteHostGesture(): void {
  lastHostGestureAt = performance.now();
}

/**
 * Record the gestures that reach `doc`, in the capture phase so a handler that
 * stops propagation cannot hide them. Idempotent per document.
 */
export function trackHostGestures(doc: Document): void {
  if (trackedDocuments.has(doc)) return;
  trackedDocuments.add(doc);
  doc.addEventListener("pointerdown", noteHostGesture, true);
  doc.addEventListener("keydown", noteHostGesture, true);
}

/** Lift the post-exit block once the activation is seen inactive. */
function noteActivationState(): void {
  const activation = userActivationApi();
  if (!activation || activation.isActive) return;
  refusedUntilActivationReset = false;
  if (activationResetWatch !== undefined) {
    clearInterval(activationResetWatch);
    activationResetWatch = undefined;
  }
}

/**
 * The host took a widget out of fullscreen: no widget on the page may take it
 * back on the strength of the gesture that closed it.
 */
export function refuseFullscreenUntilActivationReset(): void {
  refusedUntilActivationReset = true;
  if (activationResetWatch !== undefined || !userActivationApi()) return;
  activationResetWatch = setInterval(
    noteActivationState,
    ACTIVATION_RESET_POLL_MS,
  );
}

/**
 * Whether the widget in `iframe` may enter fullscreen now: it holds the focus,
 * no gesture reached the host page within {@link HOST_GESTURE_WINDOW_MS}, the
 * page is activated (where the browser can tell), and no host exit is still
 * blocking.
 */
export function widgetMayEnterFullscreen(iframe: HTMLIFrameElement): boolean {
  noteActivationState();
  if (refusedUntilActivationReset) return false;
  if (iframe.ownerDocument.activeElement !== iframe) return false;
  if (performance.now() - lastHostGestureAt < HOST_GESTURE_WINDOW_MS) {
    return false;
  }
  const activation = userActivationApi();
  return activation ? activation.isActive : true;
}

/** Forget the page-wide state. For tests only. */
export function ɵresetFullscreenGate(): void {
  lastHostGestureAt = Number.NEGATIVE_INFINITY;
  refusedUntilActivationReset = false;
  if (activationResetWatch !== undefined) {
    clearInterval(activationResetWatch);
    activationResetWatch = undefined;
  }
}
