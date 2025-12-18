/**
 * Notification system for the CopilotKit Inspector
 *
 * This module handles:
 * - Fetching notifications from RSS feed
 * - Tracking which notifications have been seen
 * - Managing notification state in localStorage
 */

const LAST_SEEN_KEY = "cpk:inspector:notifications:lastSeen";

export interface Notification {
  id: string;
  title: string;
  description?: string;
  url?: string;
  timestamp: number;
  severity?: "info" | "warning" | "error";
}

/**
 * Fetch notifications from RSS feed
 * @param rssUrl - URL of the RSS feed to fetch
 * @returns Array of notifications
 *
 * TODO: Implement actual RSS feed parsing
 * For now, returns dummy data
 */
export async function fetchNotifications(rssUrl?: string): Promise<Notification[]> {
  // Stub: Return dummy notifications for now
  // In production, this would:
  // 1. Fetch the RSS feed from rssUrl
  // 2. Parse the RSS XML
  // 3. Transform RSS items into Notification objects
  // 4. Sort by timestamp (newest first)

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          id: "notif-1",
          title: "CopilotKit v1.10.6 Released",
          description: "New features include improved inspector UI, better error handling, and performance improvements.",
          url: "https://github.com/CopilotKit/CopilotKit/releases/tag/v1.10.6",
          timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
          severity: "info",
        },
        {
          id: "notif-2",
          title: "Action: Update Required",
          description: "A critical security update is available. Please update to the latest version.",
          url: "https://github.com/CopilotKit/CopilotKit/security",
          timestamp: Date.now() - 1000 * 60 * 60 * 48, // 2 days ago
          severity: "warning",
        },
        {
          id: "notif-3",
          title: "New Documentation Available",
          description: "Check out our updated guides for building AI agents with CopilotKit.",
          url: "https://docs.copilotkit.ai/guides/agents",
          timestamp: Date.now() - 1000 * 60 * 60 * 72, // 3 days ago
          severity: "info",
        },
      ]);
    }, 100);
  });
}

/**
 * Get the timestamp of the last seen notification
 * @returns Timestamp in milliseconds, or 0 if never seen
 */
export function getLastSeenTimestamp(): number {
  try {
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    return lastSeen ? parseInt(lastSeen, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Update the last seen timestamp to now
 */
export function markNotificationsAsSeen(): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, Date.now().toString());
  } catch {
    // ignore
  }
}

/**
 * Count how many notifications are newer than the last seen timestamp
 * @param notifications - Array of notifications
 * @returns Count of unread notifications
 */
export function countUnreadNotifications(notifications: Notification[]): number {
  const lastSeen = getLastSeenTimestamp();
  return notifications.filter((n) => n.timestamp > lastSeen).length;
}

/**
 * Check if a specific notification is unread
 * @param notification - The notification to check
 * @returns True if unread, false otherwise
 */
export function isNotificationUnread(notification: Notification): boolean {
  const lastSeen = getLastSeenTimestamp();
  return notification.timestamp > lastSeen;
}
