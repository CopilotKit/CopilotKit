import {
  defaultFormatMessageTimestamp,
  isDisplayableMessageTimestamp,
  readMessageTimestamp,
} from "../../lib/message-timestamp";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

type TimestampMessage = {
  metadata?: Record<string, any> | null;
  timestamp?: unknown;
};

/**
 * Visible message time. Renders nothing unless this chat opted in and the
 * message has a timestamp. The label is locale-formatted, so hydration can
 * differ from the server; `dateTime` stays the ISO instant.
 */
export function MessageTimestamp({ message }: { message: TimestampMessage }) {
  const config = useCopilotChatConfiguration();
  if (!config?.showTimestamps) return null;

  const timestamp = readMessageTimestamp(message);
  if (timestamp === undefined || !isDisplayableMessageTimestamp(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  const format = config.formatTimestamp ?? defaultFormatMessageTimestamp;
  let label: string;
  try {
    label = format(date);
  } catch {
    return null;
  }
  if (!label) return null;

  let dateTime: string;
  try {
    dateTime = date.toISOString();
  } catch {
    return null;
  }

  return (
    <time
      dateTime={dateTime}
      data-testid="copilot-message-timestamp"
      suppressHydrationWarning
      className="cpk:mt-1 cpk:px-1 cpk:text-xs cpk:leading-4 cpk:text-muted-foreground"
    >
      {label}
    </time>
  );
}
