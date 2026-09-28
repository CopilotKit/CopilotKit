interface MessageTimestampProps {
  timestamp?: number;
}

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
