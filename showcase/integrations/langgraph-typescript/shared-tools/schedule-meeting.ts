/**
 * Schedule meeting tool implementation — HITL gated.
 *
 * TypeScript equivalent of showcase/shared/python/tools/schedule_meeting.py.
 */

export interface ScheduleMeetingResult {
  status: "pending_approval";
  reason: string;
  duration_minutes: number;
  message: string;
}

export function scheduleMeetingImpl(
  reason: string,
  durationMinutes: number = 30,
): ScheduleMeetingResult {
  return {
    status: "pending_approval",
    reason,
    duration_minutes: durationMinutes,
    message: `Meeting request: ${reason} (${durationMinutes} min). Awaiting user time selection.`,
  };
}
