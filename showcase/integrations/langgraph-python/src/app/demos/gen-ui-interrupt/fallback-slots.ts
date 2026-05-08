import type { TimeSlot } from "./_components/time-picker-card";

// Fallback slots used only if the agent's interrupt payload doesn't include
// any. The agent normally provides candidate slots inline with the interrupt.
export const FALLBACK_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-05-07T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-05-07T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-05-11T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-05-11T15:30:00-07:00" },
];
