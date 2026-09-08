export interface InterruptSlot {
  iso: string;
  label: string;
}

export interface ShowcaseInterruptPayload {
  topic: string;
  attendee?: string;
  slots: readonly InterruptSlot[];
}

const FALLBACK_SLOTS: readonly InterruptSlot[] = [
  { iso: "09:00", label: "9:00 AM" },
  { iso: "11:30", label: "11:30 AM" },
  { iso: "14:00", label: "2:00 PM" },
];

/** Normalize legacy JSON values and standard AG-UI interrupt metadata. */
export function parseInterruptPayload(
  value: unknown,
): ShowcaseInterruptPayload {
  const parsed = parseValue(value);
  const nested = isRecord(parsed["value"]) ? parsed["value"] : parsed;
  const slots = Array.isArray(nested["slots"])
    ? nested["slots"].flatMap(parseSlot)
    : [];
  return {
    topic:
      stringValue(nested["topic"]) ??
      stringValue(parsed["message"]) ??
      "Meeting",
    ...(stringValue(nested["attendee"])
      ? { attendee: stringValue(nested["attendee"]) }
      : {}),
    slots: slots.length > 0 ? slots : FALLBACK_SLOTS,
  };
}

function parseValue(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseSlot(value: unknown): InterruptSlot[] {
  if (!isRecord(value)) return [];
  const iso = stringValue(value["iso"]) ?? stringValue(value["value"]);
  const label = stringValue(value["label"]);
  return iso && label ? [{ iso, label }] : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
