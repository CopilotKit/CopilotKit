// Shared fallback time-slot generator for the interrupt demos
// (`gen-ui-interrupt`, `interrupt-headless`). The interrupt backend
// (`src/agents/interrupt_agent.py`) supplies its own candidate slots
// inside the interrupt payload — these fallbacks only run if the
// payload arrives without them. Generating relative to `Date.now()`
// keeps the fallback from rotting, which previously had hardcoded
// dates that decayed within a week of being authored.

export interface TimeSlot {
  label: string;
  iso: string;
}

function atLocal(date: Date, hour: number, minute = 0): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function nextMonday(from: Date): Date {
  // `getDay()` is 0=Sun, 1=Mon, ..., 6=Sat. We want the next Monday
  // that's at LEAST 2 days away — otherwise "Monday" would collide
  // with "Tomorrow" on Sunday (offset would be 1) or with itself on
  // Monday (offset would be 0). Mirrors interrupt_agent.py.
  const day = from.getDay();
  let offset = (1 - day + 7) % 7;
  if (offset <= 1) offset += 7;
  const next = new Date(from);
  next.setDate(from.getDate() + offset);
  return next;
}

export function generateFallbackSlots(now: Date = new Date()): TimeSlot[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = nextMonday(now);

  const candidates: Array<[string, Date]> = [
    ["Tomorrow 10:00 AM", atLocal(tomorrow, 10)],
    ["Tomorrow 2:00 PM", atLocal(tomorrow, 14)],
    ["Monday 9:00 AM", atLocal(monday, 9)],
    ["Monday 3:30 PM", atLocal(monday, 15, 30)],
  ];

  return candidates.map(([label, date]) => ({
    label,
    iso: date.toISOString(),
  }));
}
