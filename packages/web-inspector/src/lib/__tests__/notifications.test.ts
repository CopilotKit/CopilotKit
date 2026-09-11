import { expect, test } from "vitest";
import {
  matchNotification,
  parseNotificationFeed,
  emptyNotificationState,
  reconcileNotifications,
  acknowledgeNotification,
} from "../notifications.js";
import type {
  NotificationFeed,
  NotificationContext,
  NotificationConditions,
  CohortNotification,
} from "../notifications.js";
const feed: NotificationFeed = {
  schemaVersion: 1,
  notifications: [
    {
      id: "3e264aec-e9e4-5b4d-bec8-5d194a6d7c8e",
      title: "Upgrade",
      body: "Install the fix.",
      publishedAt: "2026-09-08T12:00:00.000Z",
      audiences: [{ framework: "react", sdkVersion: ">=1.70.1 <1.71.0" }],
      priority: "High",
    },
  ],
};
const context: NotificationContext = {
  development: true,
  framework: "react",
  sdkVersion: "1.70.2",
};
function scoped(audiences: NotificationConditions[]): NotificationFeed {
  return {
    ...feed,
    notifications: feed.notifications.map((n) => ({ ...n, audiences })),
  };
}
test.each([
  "1.70.2",
  "^1.70.0",
  "~1.70.1",
  "1.70.x",
  "1.70.0 - 1.70.3",
  "<1.0.0 || >=1.70.0",
])("accepts npm range %s", (range) => {
  const f = scoped([{ sdkVersion: range }]);
  expect(matchNotification(f.notifications[0]!, context).matches).toBe(true);
});
test.each([
  { ...context, development: false },
  { ...context, framework: "vue" as const },
  { ...context, sdkVersion: "1.70.0" },
  { ...context, sdkVersion: "1.71.0" },
  { ...context, sdkVersion: "1.70.2-beta.1" },
  { ...context, sdkVersion: undefined },
])("excludes unsupported installations: %j", (c) =>
  expect(matchNotification(feed.notifications[0]!, c).matches).toBe(false),
);
test("ORs audiences and ANDs conditions without public cohort metadata", () => {
  const f = scoped([
    { framework: "vue" },
    { framework: "react", intelligence: "enabled" },
  ]);
  expect(matchNotification(f.notifications[0]!, context).matches).toBe(false);
  expect(
    matchNotification(f.notifications[0]!, {
      ...context,
      intelligence: "enabled",
    }).matches,
  ).toBe(true);
  expect(
    matchNotification(f.notifications[0]!, { ...context, framework: "vue" })
      .matches,
  ).toBe(true);
  expect(parseNotificationFeed(f)).toEqual(f);
});
test("all audiences still require a known stable SDK", () => {
  const f = scoped([{}]);
  for (const sdkVersion of [undefined, "1.70.2-beta.1"])
    expect(
      matchNotification(f.notifications[0]!, { ...context, sdkVersion })
        .matches,
    ).toBe(false);
});
test.each([
  { intelligence: "disabled" as const },
  {
    plan: "pro",
    deployment: "managed" as const,
    license: "valid" as const,
    runtimeVersion: "^1.70.0",
  },
])("required metadata must be confirmed: %j", (conditions) => {
  const f = scoped([conditions]);
  expect(matchNotification(f.notifications[0]!, context).matches).toBe(false);
  expect(
    matchNotification(f.notifications[0]!, {
      ...context,
      ...conditions,
      runtimeVersion: "1.70.1",
    }).matches,
  ).toBe(true);
});
test("rejects invalid envelopes, IDs and audiences", () => {
  expect(parseNotificationFeed(feed)).toEqual(feed);
  for (const bad of [
    { ...feed, schemaVersion: 2 },
    { ...feed, cohorts: [] },
    { ...feed, notifications: [...feed.notifications, ...feed.notifications] },
    scoped([]),
    scoped([{ sdkVersion: "latest" }]),
    scoped([{ surprise: true } as unknown as NotificationConditions]),
    { ...feed, notifications: [{ ...feed.notifications[0], id: "slug-id" }] },
  ])
    expect(parseNotificationFeed(bad)).toBeNull();
});
function notice(
  id: string,
  priority: CohortNotification["priority"] = "Normal",
): CohortNotification {
  return { ...feed.notifications[0]!, id, priority };
}

test("reading the highlighted notice suppresses backlog but a new Low notice can appear", () => {
  const catalog = {
    ...feed,
    notifications: [notice("high", "High"), notice("old-low", "Low")],
  };
  const selected = reconcileNotifications(
    emptyNotificationState(),
    catalog,
    context,
  );

  expect(selected.activeId).toBe("high");
  const read = acknowledgeNotification(selected, "high");
  expect(read.readIds).toEqual(["high"]);
  expect(read.suppressedIds).toEqual(["high", "old-low"]);
  expect(reconcileNotifications(read, catalog, context).activeId).toBeNull();
  expect(
    reconcileNotifications(
      read,
      {
        ...catalog,
        notifications: [...catalog.notifications, notice("new-low", "Low")],
      },
      context,
    ).activeId,
  ).toBe("new-low");
});

test("equal arrivals keep the current bubble; a higher priority replaces it", () => {
  const catalog = { ...feed, notifications: [notice("current")] };
  const selected = reconcileNotifications(
    emptyNotificationState(),
    catalog,
    context,
  );

  expect(
    reconcileNotifications(
      selected,
      {
        ...catalog,
        notifications: [...catalog.notifications, notice("equal")],
      },
      context,
    ).activeId,
  ).toBe("current");
  expect(
    reconcileNotifications(
      selected,
      {
        ...catalog,
        notifications: [...catalog.notifications, notice("urgent", "Urgent")],
      },
      context,
    ).activeId,
  ).toBe("urgent");
});

test("same ID edits remain silent and suppressed IDs do not rearm after eligibility toggles", () => {
  const selected = reconcileNotifications(
    emptyNotificationState(),
    feed,
    context,
  );
  const read = acknowledgeNotification(
    selected,
    "3e264aec-e9e4-5b4d-bec8-5d194a6d7c8e",
  );
  const away = reconcileNotifications(read, feed, {
    ...context,
    sdkVersion: "1.0.0",
  });
  const edited = {
    ...feed,
    notifications: [
      {
        ...feed.notifications[0]!,
        title: "Edited",
        priority: "Urgent" as const,
      },
    ],
  };

  expect(reconcileNotifications(away, edited, context).activeId).toBeNull();
});

test("newly applicable notices surface and withdrawal does not promote backlog", () => {
  const catalog = {
    ...feed,
    notifications: [notice("high", "High"), notice("low", "Low")],
  };
  const away = reconcileNotifications(emptyNotificationState(), catalog, {
    ...context,
    sdkVersion: "1.0.0",
  });
  const selected = reconcileNotifications(away, catalog, context);

  expect(selected.activeId).toBe("high");
  expect(
    reconcileNotifications(
      selected,
      { ...catalog, notifications: [notice("low", "Low")] },
      context,
    ).activeId,
  ).toBeNull();
});

test("reading another notice leaves the highlight and unrelated unread notices alone", () => {
  const selected = reconcileNotifications(
    emptyNotificationState(),
    { ...feed, notifications: [notice("high", "High"), notice("low", "Low")] },
    context,
  );
  const read = acknowledgeNotification(selected, "low");

  expect(read.activeId).toBe("high");
  expect(read.suppressedIds).toEqual(["low"]);
});

test("preserves a stored highlight while required runtime metadata is loading, without making it eligible", () => {
  const catalog: NotificationFeed = {
    ...feed,
    notifications: feed.notifications.map((n) => ({
      ...n,
      audiences: [{ intelligence: "enabled" }],
    })),
  };
  const selected = reconcileNotifications(emptyNotificationState(), catalog, {
    ...context,
    intelligence: "enabled",
  });
  const loading = reconcileNotifications(selected, catalog, context);
  expect(loading.activeId).toBe("3e264aec-e9e4-5b4d-bec8-5d194a6d7c8e");
  expect(loading.eligibleIds).toEqual([]);
  const resolved = reconcileNotifications(loading, catalog, {
    ...context,
    intelligence: "disabled",
  });
  expect(resolved.activeId).toBeNull();
});
