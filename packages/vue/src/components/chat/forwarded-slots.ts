import type { Slots } from "vue";

/**
 * Returns the names of the slots that a wrapper passes on to the component it
 * wraps: every slot in `slots` except the ones in `ownSlots`, which the
 * wrapper renders itself.
 *
 * CopilotChat passes every slot except `chat-view` to CopilotChatView.
 * CopilotSidebar, CopilotPopup, and their view components use this rule at
 * each layer, so a slot that works on CopilotChat also works on them.
 */
export function forwardedSlotNames(
  slots: Slots,
  ownSlots: readonly string[] = [],
): string[] {
  return Object.keys(slots).filter((name) => !ownSlots.includes(name));
}
