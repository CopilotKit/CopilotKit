/**
 * The inset frame is two columns: the assistant, which is bounded, and the skin's
 * app, which takes whatever is left.
 *
 * That is the whole model. An earlier version made the thread rail a resizable
 * panel INSIDE the assistant column, which made the assistant's floor a compound
 * of rail + conversation and forced a derived breakpoint, a switching collapsed
 * floor, and an app floor to compensate. The rail is now a fixed-width element
 * inside the card (see `chat-panel.tsx`), so nothing compounds and these three
 * numbers are the only ones the layout needs.
 */

/** The assistant can be dragged this narrow. */
export const ASSISTANT_MIN_PX = 250;

/**
 * Where the assistant starts.
 *
 * The pre-inset layout used 680px, but that was a fixed width with no way to
 * adjust it. As a starting point it reads heavy beside the app, so this opens
 * thinner and leaves the rest to the drag. Kept comfortably above the 520px at
 * which the container query hides the thread rail, so the rail is present on
 * first paint.
 */
export const ASSISTANT_DEFAULT_PX = 600;

/**
 * The assistant never exceeds half the frame, so the app is always at least as
 * wide as it is. Being a share rather than a pixel count, this also removes the
 * need for an app floor: capping one side at 50% guarantees the other 50%.
 */
export const ASSISTANT_MAX = "50%";
