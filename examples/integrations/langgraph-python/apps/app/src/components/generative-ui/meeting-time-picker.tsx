import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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

  return (
    <Card className="max-w-md w-full mx-auto mb-6">
      <CardContent className="p-8">
        {selectedSlot ? (
          <div className="text-center">
            <div className="text-7xl mb-4">📅</div>
            <h2 className="text-2xl font-bold mb-2 text-[var(--foreground)]">
              Meeting Scheduled
            </h2>
            <p className="text-[var(--muted-foreground)] mb-2">
              {selectedSlot.date} at {selectedSlot.time}
            </p>
            {selectedSlot.duration && (
              <p className="text-sm text-[var(--muted-foreground)]">
                Duration: {selectedSlot.duration}
              </p>
            )}
          </div>
        ) : declined ? (
          <div className="text-center">
            <div className="text-7xl mb-4">🔄</div>
            <h2 className="text-2xl font-bold mb-2 text-[var(--foreground)]">
              No Time Selected
            </h2>
            <p className="text-[var(--muted-foreground)]">
              Let me find a better time that works for you
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="text-7xl mb-4">🗓️</div>
              <h2 className="text-2xl font-bold mb-2 text-[var(--foreground)]">
                {displayTitle}
              </h2>
              <p className="text-[var(--muted-foreground)]">
                {status === "inProgress"
                  ? "Finding available times..."
                  : "Select a time that works for you"}
              </p>
            </div>

            {status === "inProgress" && (
              <div className="flex justify-center py-8">
                <Spinner size="lg" />
              </div>
            )}

            {status === "executing" && (
              <div className="space-y-3">
                {slots.map((slot, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectSlot(slot)}
                    className="w-full px-6 py-4 rounded-[var(--radius)] font-medium
                      border border-[var(--border)] hover:border-[var(--primary)]
                      shadow-sm hover:shadow-md transition-all cursor-pointer
                      hover:scale-[1.02] active:scale-[0.98]
                      flex justify-between items-center
                      hover:bg-[var(--secondary)]"
                  >
                    <div className="text-left">
                      <div className="font-bold text-[var(--foreground)]">
                        {slot.date}
                      </div>
                      <div className="text-sm text-[var(--muted-foreground)]">
                        {slot.time}
                      </div>
                    </div>
                    {slot.duration && (
                      <div className="text-sm text-[var(--muted-foreground)]">
                        {slot.duration}
                      </div>
                    )}
                  </button>
                ))}

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={handleDecline}
                >
                  None of these work
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
