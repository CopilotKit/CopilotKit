import { satisfies, valid, validRange, prerelease } from "semver";

/** Versioned CDN notification contract. Keep the Intelligence copy and fixtures aligned. */
export type NotificationFramework = "react" | "vue" | "angular";
export type NotificationPriority = "Low" | "Normal" | "High" | "Urgent";
export interface NotificationConditions {
  framework?: NotificationFramework;
  sdkVersion?: string;
  runtimeVersion?: string;
  intelligence?: "enabled" | "disabled";
  deployment?: "managed" | "self-hosted";
  plan?: string;
  license?: "valid" | "none" | "expired" | "expiring" | "invalid";
}
export interface CohortNotification {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  audiences: NotificationConditions[];
  priority: NotificationPriority;
  priorityOverride?: number;
}
export interface NotificationFeed {
  schemaVersion: 1;
  notifications: CohortNotification[];
}
export interface NotificationContext extends Omit<
  NotificationConditions,
  "sdkVersion" | "runtimeVersion"
> {
  development: boolean;
  sdkVersion?: string;
  runtimeVersion?: string;
}
export interface NotificationState {
  schemaVersion: 1;
  eligibleIds: string[];
  readIds: string[];
  suppressedIds: string[];
  activeId: string | null;
}
export function emptyNotificationState(): NotificationState {
  return {
    schemaVersion: 1,
    eligibleIds: [],
    readIds: [],
    suppressedIds: [],
    activeId: null,
  };
}
const priorities: Record<NotificationPriority, number> = {
  Low: 10,
  Normal: 20,
  High: 30,
  Urgent: 40,
};
const conditionValues: Record<string, readonly string[]> = {
  framework: ["react", "vue", "angular"],
  intelligence: ["enabled", "disabled"],
  deployment: ["managed", "self-hosted"],
  license: ["valid", "none", "expired", "expiring", "invalid"],
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
export function isNotificationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isNotificationId) &&
    new Set(value).size === value.length
  );
}
/** Validate authored conditions; unsupported predicates cannot broaden the audience. */
export function validNotificationConditions(
  value: unknown,
): value is NotificationConditions {
  if (!record(value)) return false;
  return Object.entries(value).every(([key, expected]) => {
    if (!text(expected)) return false;
    if (key === "sdkVersion" || key === "runtimeVersion")
      return validRange(expected) !== null;
    if (key === "plan") return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(expected);
    return (
      Object.prototype.hasOwnProperty.call(conditionValues, key) &&
      (conditionValues[key]?.includes(expected) ?? false)
    );
  });
}
/** Parse the public envelope. Any invalid entry rejects the whole feed. */
export function parseNotificationFeed(value: unknown): NotificationFeed | null {
  if (
    !record(value) ||
    !onlyKeys(value, ["schemaVersion", "notifications"]) ||
    value.schemaVersion !== 1
  )
    return null;
  if (!Array.isArray(value.notifications) || value.notifications.length > 100)
    return null;
  const notifications: CohortNotification[] = [];
  for (const notice of value.notifications) {
    if (
      !record(notice) ||
      !onlyKeys(notice, [
        "id",
        "title",
        "body",
        "publishedAt",
        "audiences",
        "priority",
        "priorityOverride",
      ])
    )
      return null;
    if (
      !isNotificationId(notice.id) ||
      !text(notice.title) ||
      !text(notice.body, 100_000) ||
      !text(notice.publishedAt)
    )
      return null;
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(notice.publishedAt) ||
      !Number.isFinite(Date.parse(notice.publishedAt)) ||
      new Date(notice.publishedAt).toISOString() !== notice.publishedAt
    )
      return null;
    if (
      !Array.isArray(notice.audiences) ||
      !notice.audiences.length ||
      notice.audiences.length > 100 ||
      !notice.audiences.every(validNotificationConditions)
    )
      return null;
    if (
      !text(notice.priority) ||
      !Object.prototype.hasOwnProperty.call(priorities, notice.priority)
    )
      return null;
    if (
      notice.priorityOverride !== undefined &&
      (typeof notice.priorityOverride !== "number" ||
        !Number.isSafeInteger(notice.priorityOverride) ||
        notice.priorityOverride < 0)
    )
      return null;
    if (notifications.some((n) => n.id === notice.id)) return null;
    notifications.push({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      publishedAt: notice.publishedAt,
      audiences: notice.audiences,
      priority: notice.priority as NotificationPriority,
      ...(notice.priorityOverride === undefined
        ? {}
        : { priorityOverride: notice.priorityOverride }),
    });
  }
  return { schemaVersion: 1, notifications };
}
/** Ignore malformed or incompatible browser state. */
export function parseNotificationState(
  value: unknown,
): NotificationState | null {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !ids(value.eligibleIds) ||
    !ids(value.readIds) ||
    !ids(value.suppressedIds) ||
    (value.activeId !== null && !isNotificationId(value.activeId))
  )
    return null;
  return {
    schemaVersion: 1,
    eligibleIds: value.eligibleIds,
    readIds: value.readIds,
    suppressedIds: value.suppressedIds,
    activeId: value.activeId,
  };
}
/** Internal priority never becomes a developer-facing badge. */
export function notificationPriority(notice: CohortNotification): number {
  return notice.priorityOverride ?? priorities[notice.priority];
}
/** Stable ordering used by authoring reports and first-time selection. */
export function compareNotifications(
  a: CohortNotification,
  b: CohortNotification,
): number {
  return (
    notificationPriority(b) - notificationPriority(a) ||
    Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
/** Refresh eligibility without promoting the previously delivered backlog. */
export function reconcileNotifications(
  state: NotificationState,
  feed: NotificationFeed,
  context: NotificationContext,
): NotificationState {
  const eligible = feed.notifications.filter(
    (n) => matchNotification(n, context).matches,
  );
  const quiet = (n: CohortNotification) =>
    state.readIds.includes(n.id) || state.suppressedIds.includes(n.id);
  const active =
    eligible.find((n) => n.id === state.activeId && !quiet(n)) ??
    feed.notifications.find(
      (n) =>
        n.id === state.activeId &&
        !quiet(n) &&
        n.audiences.some((conditions) => {
          const entries = Object.entries(conditions);
          if (
            !entries.some(
              ([key]) =>
                context[key as keyof NotificationConditions] === undefined,
            )
          )
            return false;
          const known = Object.fromEntries(
            entries.filter(
              ([key]) =>
                context[key as keyof NotificationConditions] !== undefined,
            ),
          );
          return matchNotification({ ...n, audiences: [known] }, context)
            .matches;
        }),
    );
  const newcomer = eligible
    .filter((n) => !quiet(n) && !state.eligibleIds.includes(n.id))
    .sort(compareNotifications)[0];
  const winner =
    active &&
    (!newcomer ||
      notificationPriority(active) >= notificationPriority(newcomer))
      ? active
      : newcomer;
  return {
    ...state,
    eligibleIds: eligible.map((n) => n.id),
    activeId: winner?.id ?? null,
  };
}
/** Reading or closing the highlight quiets its delivered backlog, not future IDs. */
export function acknowledgeNotification(
  state: NotificationState,
  noticeId: string,
): NotificationState {
  if (!state.eligibleIds.includes(noticeId)) return state;
  const highlighted = state.activeId === noticeId;
  return {
    ...state,
    readIds: [...new Set([...state.readIds, noticeId])],
    suppressedIds: [
      ...new Set([
        ...state.suppressedIds,
        ...(highlighted ? state.eligibleIds : [noticeId]),
      ]),
    ],
    activeId: highlighted ? null : state.activeId,
  };
}
/** Explain targeting using the same rules in CI and the Inspector. */
export function matchNotification(
  notice: CohortNotification,
  context: NotificationContext,
): { matches: boolean; reasons: string[] } {
  if (!context.development)
    return { matches: false, reasons: ["Development only"] };
  if (
    !context.sdkVersion ||
    !valid(context.sdkVersion) ||
    prerelease(context.sdkVersion) !== null
  )
    return {
      matches: false,
      reasons: ["Known stable SDK required"],
    };
  const reasons: string[] = [];
  const matches = notice.audiences.some((conditions) => {
    return Object.entries(conditions).every(([field, expected]) => {
      const actual = context[field as keyof NotificationConditions];
      const matches =
        field === "sdkVersion" || field === "runtimeVersion"
          ? actual !== undefined &&
            valid(actual) !== null &&
            prerelease(actual) === null &&
            satisfies(actual, expected)
          : actual === expected;
      if (!matches)
        reasons.push(
          `${field} ${actual === undefined ? "is unknown" : `requires ${expected} (got ${actual})`}`,
        );
      return matches;
    });
  });
  return {
    matches,
    reasons: matches ? [] : reasons,
  };
}
