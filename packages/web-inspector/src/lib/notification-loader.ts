import { parseNotificationFeed } from "./notifications.js";
import type { NotificationContext, NotificationFeed } from "./notifications.js";

export const NOTIFICATION_FEED_URL =
  "https://cdn.copilotkit.ai/notifications/v1.json";
const requests = new Map<string, Promise<NotificationFeed | null>>();
/** New SDKs read only cohorts; announcements.json remains the older SDK channel.
 * Share one request per framework/version per page. Missing context gets the full
 * feed so future servers cannot exclude notices the client may still match.
 */
export function loadNotificationFeed(
  context: Pick<NotificationContext, "framework" | "sdkVersion">,
): Promise<NotificationFeed | null> {
  if (typeof window === "undefined" || typeof fetch === "undefined")
    return Promise.resolve(null);
  const url = new URL(NOTIFICATION_FEED_URL);
  if (context.framework && context.sdkVersion) {
    url.searchParams.set("framework", context.framework);
    url.searchParams.set("sdkVersion", context.sdkVersion);
  }
  const key = url.toString();
  const existing = requests.get(key);
  if (existing) return existing;
  const request = fetch(key, {
    cache: "no-cache",
    credentials: "omit",
  })
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Feed request failed (${response.status})`);
      const feed = parseNotificationFeed(await response.json());
      if (!feed) throw new Error("Feed failed validation");
      return feed;
    })
    .catch((error: unknown) => {
      // Keep the host running, but make an empty What's New debuggable.
      console.warn(
        "[CopilotKit Inspector] Failed to load notifications",
        error,
      );
      return null;
    });
  requests.set(key, request);
  return request;
}
