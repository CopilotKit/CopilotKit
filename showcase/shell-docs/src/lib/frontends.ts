// The frontends a reader can pick: the app frameworks, the Slack and Teams
// channels, and the messaging channels in early access. One list, read by
// every picker, the home page, the docs assistant, and the link builders.
//
// It imports nothing, since every docs page loads it and the URL helpers
// (live-scope.ts) read it while the framework list (proto/data.ts) reads them.
//
// `earlyAccess` does two things, and everything else derives from them:
//   1. Wherever a frontend's row or card is drawn, it carries the "Early
//      access" badge (EARLY_ACCESS_LABEL).
//   2. The frontend's only page is its landing page, `/<id>`, with a demo
//      booker (`landingPage`). It has no docs pages, so every per-stack link
//      on it falls back to that page, and it is never the reader's remembered
//      frontend (`hasDocs`), so the docs never follow a stack with no docs.

const ENTRIES = [
  {
    id: "react",
    name: "React",
    summary: "Provider, hooks, and chat components.",
    kind: "app",
    group: "Web",
  },
  {
    id: "vue",
    name: "Vue",
    summary: "Vue 3 provider, composables, and chat primitives.",
    kind: "app",
    group: "Web",
  },
  {
    id: "angular",
    name: "Angular",
    summary: "Components, directives, and services.",
    kind: "app",
    group: "Web",
  },
  {
    id: "react-native",
    name: "React Native",
    summary: "Bindings for React Native and Expo apps.",
    kind: "app",
    group: "Mobile",
  },
  {
    id: "slack",
    name: "Slack",
    summary: "Run your agent as a Slack bot.",
    kind: "channel",
    group: "Channels",
  },
  {
    id: "teams",
    name: "Teams",
    summary: "Run your agent as a Microsoft Teams bot.",
    kind: "channel",
    group: "Channels",
  },
  {
    id: "imessage",
    name: "iMessage",
    summary: "Run your agent in iMessage conversations.",
    kind: "channel",
    group: "Channels",
    earlyAccess: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    summary: "Run your agent on WhatsApp.",
    kind: "channel",
    group: "Channels",
    earlyAccess: true,
  },
  {
    id: "sms",
    name: "SMS",
    summary: "Run your agent over SMS.",
    kind: "channel",
    group: "Channels",
    earlyAccess: true,
  },
  {
    id: "rcs",
    name: "RCS",
    summary: "Run your agent in RCS business messages.",
    kind: "channel",
    group: "Channels",
    earlyAccess: true,
  },
] as const;

export type FrontendId = (typeof ENTRIES)[number]["id"];

/** The frontends in early access, from their flag. */
export type EarlyAccessFrontendId = Extract<
  (typeof ENTRIES)[number],
  { earlyAccess: true }
>["id"];

export interface Frontend {
  id: FrontendId;
  name: string;
  /** One line for the home page's cards, <= 70 characters. */
  summary: string;
  /** Channels are the chat-platform SDKs (`@copilotkit/channels-*`). */
  kind: "app" | "channel";
  /** The quickstart menu's group. */
  group: "Web" | "Mobile" | "Channels";
  /**
   * In early access: badged "Early access", and its only page is its landing
   * page (`/<id>`). See the top of this file.
   */
  earlyAccess?: boolean;
}

/** Every frontend, in the pickers' and the home page's order. */
export const FRONTENDS: readonly Frontend[] = ENTRIES;

export const FRONTEND_GROUPS: readonly Frontend["group"][] = [
  "Web",
  "Mobile",
  "Channels",
];

/** The badge beside an early-access frontend's name. */
export const EARLY_ACCESS_LABEL = "Early access";

export function frontendById(id: string | null | undefined) {
  return FRONTENDS.find((f) => f.id === id);
}

/** Whether `id` is a frontend in early access. */
export function isEarlyAccessFrontend(
  id: string | null | undefined,
): id is EarlyAccessFrontendId {
  return frontendById(id)?.earlyAccess === true;
}

/**
 * The landing page of a frontend in early access (`/whatsapp`), its only
 * page, or null for a frontend with docs. Every URL builder sends an
 * early-access frontend's links here, whatever page or framework they name.
 */
export function landingPage(id: string | null | undefined) {
  return isEarlyAccessFrontend(id) ? `/${id}` : null;
}

/**
 * Whether `id` is a frontend with docs, which every frontend but those in
 * early access is. Only such a frontend can be the reader's remembered one
 * (src/proto/frontend.tsx).
 */
export function hasDocs(id: string | null | undefined): id is FrontendId {
  return !!frontendById(id) && landingPage(id) === null;
}

/**
 * The frontends with docs: what the reader's docs stack can be. The docs
 * assistant offers only these when it switches the reader's stack.
 */
export const DOCS_FRONTENDS: readonly Frontend[] = FRONTENDS.filter((f) =>
  hasDocs(f.id),
);

/**
 * The frontend part of an analytics event about a frontend
 * (`docs.frontend_selected`, `docs.homepage_quickstart_selected`): its id,
 * and `early_access: true` when it is in early access.
 */
export function frontendEventProperties(id: FrontendId) {
  return isEarlyAccessFrontend(id)
    ? { frontend: id, early_access: true as const }
    : { frontend: id };
}
