import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseNotificationFeed, matchNotification } from "../notifications.js";
import type { NotificationContext } from "../notifications.js";
const fixture: {
  feed: unknown;
  cases: { name: string; context: NotificationContext; matching: string[] }[];
} = JSON.parse(
  readFileSync("src/lib/__tests__/notification-conformance.json", "utf8"),
);
test.each(fixture.cases)("producer/consumer conformance: $name", (entry) => {
  const feed = parseNotificationFeed(fixture.feed);
  if (!feed) throw new Error("Invalid conformance feed");
  expect(
    feed.notifications
      .filter((n) => matchNotification(n, entry.context).matches)
      .map((n) => n.id),
  ).toEqual(entry.matching);
});
