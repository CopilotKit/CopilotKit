interface MessageTimestampProps {
  timestamp?: number;
}

/**
 * Formats an epoch-millisecond timestamp as a local time label.
 *
 * Missing or invalid values render nothing; the `dateTime` attribute uses ISO
 * format for machine-readable output.
 */
export function MessageTimestamp({ timestamp }: MessageTimestampProps) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <time
      className="copilotKitMessageTimestamp"
      data-testid="copilot-message-timestamp"
      dateTime={date.toISOString()}
      suppressHydrationWarning
    >
      {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </time>
  );
}
