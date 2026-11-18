import React from "react";

/**
 * True while the pin-to-bottom behaviour is actively following the bottom of
 * the thread — i.e. `use-stick-to-bottom` will animate the scroll position to
 * the bottom the next time the content grows.
 *
 * Only CopilotChatView's pin-to-bottom branch provides this. The other scroll
 * modes leave it `false`, which is correct: nothing else writes the scroll
 * position on its own, so no one is competing with the virtualizer.
 *
 * Why this exists: the virtualizer and `use-stick-to-bottom` both write
 * `scrollTop` on the same element. The virtualizer writes it to compensate
 * when a row above the viewport turns out taller than its estimate, so that
 * what the reader is looking at does not shift. That compensation is essential
 * while the reader is scrolled up — and pointless while pinned to the bottom,
 * because the pin is about to move the scroll position anyway. Worse than
 * pointless: the compensation changes the virtual container's height, the pin
 * reads that as content growth and animates, the animation brings unmeasured
 * rows into view, they measure, and the two keep shoving each other.
 *
 * Consumed by CopilotChatMessageView to stand the virtualizer down while the
 * pin owns the scroll position.
 */
export const ScrollPinnedContext = React.createContext<boolean>(false);
