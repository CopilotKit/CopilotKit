/**
 * Shared timestamp formatter: converts an ISO 8601 UTC string into the
 * user's local timezone via `toLocaleString()`. Falls back to the raw
 * input if parsing fails so tooltips never render "Invalid Date".
 */
export function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}
