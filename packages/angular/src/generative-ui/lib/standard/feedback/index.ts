import {
  feedbackDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import {
  CopilotGenerativeUIFlashcardFlip,
  CopilotGenerativeUIPulseIndicator,
} from "./indicators";
import { CopilotGenerativeUIModal } from "./modal";
import {
  CopilotGenerativeUIPopover,
  CopilotGenerativeUIPopoverContent,
  CopilotGenerativeUIPopoverTrigger,
} from "./popover";

export {
  CopilotGenerativeUIFlashcardFlip,
  CopilotGenerativeUIPulseIndicator,
} from "./indicators";
export { CopilotGenerativeUIModal } from "./modal";
export {
  CopilotGenerativeUIPopover,
  CopilotGenerativeUIPopoverContent,
  CopilotGenerativeUIPopoverTrigger,
} from "./popover";
export { FEEDBACK_STYLE_ID } from "./styles";

/**
 * The standard feedback components: a pulse dot, a flashcard, a popover and
 * a modal. Popover, PopoverTrigger and PopoverContent have a "multiple"
 * `children` slot. Popover and Modal `open` is writable, so the engine binds
 * it two-way.
 */
export const feedbackComponents = withComponents(feedbackDeclarations, {
  PulseIndicator: CopilotGenerativeUIPulseIndicator,
  FlashcardFlip: CopilotGenerativeUIFlashcardFlip,
  Popover: CopilotGenerativeUIPopover,
  PopoverTrigger: CopilotGenerativeUIPopoverTrigger,
  PopoverContent: CopilotGenerativeUIPopoverContent,
  Modal: CopilotGenerativeUIModal,
});
