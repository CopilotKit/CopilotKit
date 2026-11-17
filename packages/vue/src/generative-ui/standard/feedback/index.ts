import {
  feedbackDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIFlashcardFlip from "./FlashcardFlip.vue";
import CopilotGenerativeUIModal from "./Modal.vue";
import CopilotGenerativeUIPopover from "./Popover.vue";
import CopilotGenerativeUIPopoverContent from "./PopoverContent.vue";
import CopilotGenerativeUIPopoverTrigger from "./PopoverTrigger.vue";
import CopilotGenerativeUIPulseIndicator from "./PulseIndicator.vue";

export {
  CopilotGenerativeUIFlashcardFlip,
  CopilotGenerativeUIModal,
  CopilotGenerativeUIPopover,
  CopilotGenerativeUIPopoverContent,
  CopilotGenerativeUIPopoverTrigger,
  CopilotGenerativeUIPulseIndicator,
};
export { FEEDBACK_STYLE_ID } from "./styles";

/**
 * The standard feedback components: a pulse dot, a flashcard, a popover and
 * a modal. Spread them into the components of a generative UI:
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({
 *   id: "my-app/ui@1",
 *   components: { ...feedbackComponents },
 * });
 * ```
 *
 * Popover, PopoverTrigger and PopoverContent have a "multiple" `children`
 * slot. Modal has a "single" `trigger` slot and a "single" `content` slot.
 * Popover and Modal `open` is writable, so the component gets it as a
 * `v-model:open`.
 */
export const feedbackComponents = withComponents(feedbackDeclarations, {
  PulseIndicator: CopilotGenerativeUIPulseIndicator,
  FlashcardFlip: CopilotGenerativeUIFlashcardFlip,
  Popover: CopilotGenerativeUIPopover,
  PopoverTrigger: CopilotGenerativeUIPopoverTrigger,
  PopoverContent: CopilotGenerativeUIPopoverContent,
  Modal: CopilotGenerativeUIModal,
});
