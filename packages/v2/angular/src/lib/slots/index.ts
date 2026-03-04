export {
  type SlotValue,
  type SlotConfig,
  type SlotContext,
  type SlotRegistryEntry,
  type RenderSlotOptions,
  SLOT_CONFIG,
  type WithSlots,
} from "./slot.types";
export {
  renderSlot,
  isComponentType,
  isSlotValue,
  normalizeSlotValue,
  createSlotConfig,
  provideSlots,
  getSlotConfig,
  createSlotRenderer,
} from "./slot.utils";
export { CopilotSlot } from "./copilot-slot";
