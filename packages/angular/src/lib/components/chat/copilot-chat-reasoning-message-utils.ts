export function formatReasoningDuration(seconds: number): string {
  if (seconds < 1) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;

  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (secs === 0) return `${mins} minute${mins > 1 ? "s" : ""}`;
  return `${mins}m ${secs}s`;
}
