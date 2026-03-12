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
  ]
}: MeetingTimePickerProps) {
  const displayTitle = reasonForScheduling || title;
  const slots = meetingDuration
    ? timeSlots.map((slot) => ({ ...slot, duration: `${meetingDuration} min` }))
    : timeSlots;
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [declined, setDeclined] = useState(false);

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    respond?.(`Meeting scheduled for ${slot.date} at ${slot.time}${slot.duration ? ` (${slot.duration})` : ''}.`);
  };

  const handleDecline = () => {
    setDeclined(true);
    respond?.("The user declined all proposed meeting times. Please suggest alternative times or ask for their availability.");
  };

  return (
    <div className="rounded-2xl shadow-lg max-w-md w-full border dark:border-zinc-700 mx-auto mb-6 bg-white dark:bg-zinc-800">
      <div className="backdrop-blur-md p-8 w-full rounded-2xl">
        {/* Show confirmation or prompt */}
        {selectedSlot ? (
          <div className="text-center">
            <div className="text-7xl mb-4">📅</div>
            <h2 className="text-2xl font-bold mb-2 dark:text-white">
              Meeting Scheduled
            </h2>
            <p className="text-gray-600 dark:text-zinc-400 mb-2">
              {selectedSlot.date} at {selectedSlot.time}
            </p>
            {selectedSlot.duration && (
              <p className="text-sm text-gray-500 dark:text-zinc-400">
                Duration: {selectedSlot.duration}
              </p>
            )}
          </div>
        ) : declined ? (
          <div className="text-center">
            <div className="text-7xl mb-4">🔄</div>
            <h2 className="text-2xl font-bold mb-2 dark:text-white">
              No Time Selected
            </h2>
            <p className="text-gray-600 dark:text-zinc-400">
              Let me find a better time that works for you
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="text-7xl mb-4">🗓️</div>
              <h2 className="text-2xl font-bold mb-2 dark:text-white">
                {displayTitle}
              </h2>
              <p className="text-gray-600 dark:text-zinc-400">
                Select a time that works for you
              </p>
            </div>

            {/* Time slot options */}
            {status === "executing" && (
              <div className="space-y-3">
                {slots.map((slot, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectSlot(slot)}
                    className="w-full px-6 py-4 rounded-xl font-medium
                      border-2 border-gray-200 dark:border-zinc-600 hover:border-blue-500 dark:hover:border-blue-400
                      shadow-sm hover:shadow-md transition-all cursor-pointer
                      hover:scale-102 active:scale-98
                      flex justify-between items-center
                      hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  >
                    <div className="text-left">
                      <div className="font-bold text-gray-900 dark:text-zinc-100">{slot.date}</div>
                      <div className="text-sm text-gray-600 dark:text-zinc-400">{slot.time}</div>
                    </div>
                    {slot.duration && (
                      <div className="text-sm text-gray-500 dark:text-zinc-400">{slot.duration}</div>
                    )}
                  </button>
                ))}

                <button
                  onClick={handleDecline}
                  className="w-full px-6 py-3 rounded-xl font-medium
                    text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200
                    transition-all cursor-pointer
                    hover:bg-gray-100 dark:hover:bg-zinc-700"
                >
                  None of these work
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
