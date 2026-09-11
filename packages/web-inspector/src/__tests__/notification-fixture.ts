import { parseNotificationFeed } from "../lib/notifications.js";
/** Convert historical test copy into the current wire contract. */
export function notificationFixture(value: {
  timestamp?: string;
  previewText?: string;
  announcement?: string;
}) {
  return {
    schemaVersion: 1,
    notifications: [
      {
        id: notificationTestId(value.timestamp ?? ""),
        title: value.previewText || "CopilotKit update",
        body: value.announcement,
        publishedAt: value.timestamp,
        audiences: [{}],
        priority: "Normal",
      },
    ],
  };
}
/** Per-test loader boundary. The real page-level cache has a separate test suite. */
export async function fetchNotificationFixture() {
  const response = await fetch(
    "https://cdn.copilotkit.ai/notifications/v1.json",
  );
  if (!response.ok) return null;
  const value = await response.json();
  return parseNotificationFeed(
    value.schemaVersion ? value : notificationFixture(value),
  );
}

export function notificationTestId(timestamp: string): string {
  return `00000000-0000-4000-8000-${Date.parse(timestamp).toString(16).padStart(12, "0")}`;
}
