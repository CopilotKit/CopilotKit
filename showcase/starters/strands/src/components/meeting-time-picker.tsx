import { useState } from "react";

export interface TimeSlot {
  date: string;
  time: string;
  duration?: string;
}

export interface MeetingTimePickerProps {
  status: "inProgress" | "executing" | "complete";
  respond?: (response: string) => void;
  reasonForScheduling?: string;
  meetingDuration?: number;
  title?: string;
  timeSlots?: TimeSlot[];
}

export function MeetingTimePicker({
  status,
  respond,
  reasonForScheduling,
  meetingDuration,
  title = "Schedule a Meeting",
  timeSlots = [
    { date: "Tomorrow", time: "2:00 PM", duration: "30 min" },
    { date: "Friday", time: "10:00 AM", duration: "30 min" },
    { date: "Next Monday", time: "3:00 PM", duration: "30 min" },
  ],
}: MeetingTimePickerProps) {
  const displayTitle = reasonForScheduling || title;
  const slots = meetingDuration
    ? timeSlots.map((slot) => ({ ...slot, duration: `${meetingDuration} min` }))
    : timeSlots;
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [declined, setDeclined] = useState(false);

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    respond?.(
      `Meeting scheduled for ${slot.date} at ${slot.time}${slot.duration ? ` (${slot.duration})` : ""}.`,
    );
  };

  const handleDecline = () => {
    setDeclined(true);
    respond?.(
      "The user declined all proposed meeting times. Please suggest alternative times or ask for their availability.",
    );
  };

  // Confirmed state
  if (selectedSlot) {
    return (
      <div className="max-w-md w-full mx-auto mb-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="p-6">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-[#189370]">
              <svg
                className="h-5 w-5 text-white"
                strokeWidth={3}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">
                Meeting Scheduled
              </h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-1">
                {selectedSlot.date} at {selectedSlot.time}
              </p>
            </div>
            {selectedSlot.duration && (
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-0.5 text-xs font-semibold text-[var(--secondary-foreground)]">
                <svg
                  className="h-3 w-3 mr-1"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {selectedSlot.duration}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Declined state
  if (declined) {
    return (
      <div className="max-w-md w-full mx-auto mb-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="p-6">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex items-center justify-center h-12 w-12 rounded-full bg-[var(--secondary)]">
              <svg
                className="h-6 w-6 text-[var(--muted-foreground)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">
                No Time Selected
              </h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-1">
                Looking for a better time that works for you
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Selection state
  return (
    <div className="max-w-md w-full mx-auto mb-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="p-6">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="flex items-center justify-center h-12 w-12 rounded-full bg-[var(--accent)] mb-3">
            <svg
              className="h-6 w-6 text-[#BEC2FF]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-[var(--foreground)]">
            {displayTitle}
          </h3>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {status === "inProgress"
              ? "Finding available times..."
              : "Pick a time that works for you"}
          </p>
        </div>

        {status === "inProgress" && (
          <div className="flex justify-center py-6">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--muted)] border-t-[var(--foreground)]" />
          </div>
        )}

        {status === "executing" && (
          <div className="space-y-3">
            {slots.map((slot, index) => (
              <button
                key={index}
                onClick={() => handleSelectSlot(slot)}
                className="group w-full px-6 py-5 rounded-[var(--radius)]
                  border border-[var(--border)]
                  hover:border-[var(--ring)] hover:bg-[var(--accent)]
                  transition-all duration-150 cursor-pointer
                  flex items-center gap-4"
              >
                <div className="flex-1 text-left">
                  <div className="font-semibold text-base text-[var(--foreground)]">
                    {slot.date}
                  </div>
                  <div className="text-sm text-[var(--muted-foreground)] mt-0.5">
                    {slot.time}
                  </div>
                </div>
                {slot.duration && (
                  <span className="shrink-0 text-sm px-3 py-1 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--secondary)] font-semibold text-[var(--secondary-foreground)]">
                    {slot.duration}
                  </span>
                )}
                <svg
                  className="h-4 w-4 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}

            <button
              className="w-full mt-1 text-xs text-[var(--muted-foreground)] py-2 hover:bg-[var(--accent)] rounded-md transition-colors"
              onClick={handleDecline}
            >
              None of these work
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
