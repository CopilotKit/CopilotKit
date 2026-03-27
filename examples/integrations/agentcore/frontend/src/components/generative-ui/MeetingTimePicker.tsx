import { useState } from "react"

interface TimeSlot {
  date: string
  time: string
  label?: string
}

interface MeetingTimePickerProps {
  title?: string
  slots: TimeSlot[]
  onSelect?: (slot: TimeSlot) => void
}

export function MeetingTimePicker({ title = "Pick a time", slots, onSelect }: MeetingTimePickerProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const handleConfirm = () => {
    if (selected === null) return
    setConfirmed(true)
    onSelect?.(slots[selected])
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })

  if (confirmed && selected !== null) {
    return (
      <div className="my-3 p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm max-w-xs text-sm">
        <p className="text-green-600 font-medium">✓ Scheduled</p>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          {formatDate(slots[selected].date)} at {slots[selected].time}
        </p>
      </div>
    )
  }

  return (
    <div className="my-3 p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm max-w-xs">
      <p className="text-sm font-semibold mb-3">{title}</p>
      <div className="space-y-2">
        {slots.map((slot, i) => (
          <button
            key={i}
            onClick={() => { setSelected(i); setConfirmed(false) }}
            className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors
              ${selected === i
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                : "border-gray-200 dark:border-zinc-700 hover:border-indigo-300 text-gray-700 dark:text-gray-300"
              }`}
          >
            <span className="font-medium">{formatDate(slot.date)}</span>
            <span className="ml-2 text-gray-500">{slot.time}</span>
            {slot.label && <span className="ml-2 text-xs text-gray-400">{slot.label}</span>}
          </button>
        ))}
      </div>
      <button
        onClick={handleConfirm}
        disabled={selected === null}
        className="mt-3 w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
      >
        Confirm
      </button>
    </div>
  )
}
