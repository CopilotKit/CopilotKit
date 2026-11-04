// Pure, server-safe date formatter (no "use client", no React) so it renders
// identically on the server and on hydration. Locale AND timeZone are pinned so
// the produced string does not depend on the server's or the browser's locale/
// zone — otherwise the markup differs between server render and hydration and
// React reports a mismatch. The explicit "UTC" label keeps the shown date honest
// (pinning the zone changes which zone the value represents).
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZoneName: "short",
});

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFormatter.format(d);
}
