// Fallback time slots for the interrupt demos (`gen-ui-interrupt`,
// `interrupt-headless`). Some agents send candidate slots in the interrupt
// payload; when a payload has none, the page offers these. They are relative
// to `Date.now()`, so they never go stale the way hardcoded dates did.

export interface TimeSlot {
  label: string;
  iso: string;
}

function atLocal(date: Date, hour: number, minute = 0) {
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

function nextMonday(from: Date) {
  // `getDay()` is 0=Sun, 1=Mon, ..., 6=Sat. We want the next Monday
  // that's at LEAST 2 days away. Otherwise "Monday" would collide
  // with "Tomorrow" on Sunday (offset would be 1) or with itself on
  // Monday (offset would be 0). The agents' own slot logic does the same.
  const day = from.getDay();
  let offset = (1 - day + 7) % 7;
  if (offset <= 1) offset += 7;
  const next = new Date(from);
  next.setDate(from.getDate() + offset);
  return next;
}

export function generateFallbackSlots(now: Date = new Date()) {
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
