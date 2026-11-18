/** The visible message row with `messageId` inside the panel `panelId`. */
export function findFocusedMessage(
  root: ShadowRoot | null,
  panelId: string,
  messageId: string,
): HTMLElement | undefined {
  return Array.from(
    root?.querySelectorAll<HTMLElement>(
      `#${panelId}:not([hidden]) [data-message-id]`,
    ) ?? [],
  ).find((candidate) => candidate.dataset.messageId === messageId);
}

/** Replays the focus pulse animation on a message row. */
export function pulseMessage(message: HTMLElement): void {
  message.classList.remove("cpk-td__focus-pulse");
  void message.offsetWidth;
  message.classList.add("cpk-td__focus-pulse");
  message.addEventListener(
    "animationend",
    () => message.classList.remove("cpk-td__focus-pulse"),
    { once: true },
  );
}
