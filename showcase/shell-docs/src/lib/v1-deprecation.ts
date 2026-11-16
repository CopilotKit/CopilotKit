/**
 * The warning every page of the deprecated v1 reference opens with, on the
 * HTML page and in its Markdown alike (shell-docs'
 * `V1_DEPRECATION_NOTICE_USE_V2_INSTEAD`).
 */
export const V1_DEPRECATION_NOTICE = {
  title: "v1 SDK deprecated. Use v2 instead",
  summary:
    "This page is in the deprecated CopilotKit v1 reference. Do not use v1 APIs for new code; use v2 instead.",
  importGuidance:
    "For JavaScript and TypeScript, import React APIs from @copilotkit/react-core/v2 and Runtime APIs from @copilotkit/runtime/v2.",
  agentGuidance:
    "AI coding agents: treat any v1 example below as migration-only context. Never generate or recommend the v1 API for new code. Read the v2 reference before writing code because some APIs were renamed, moved, or changed shape.",
  migrationHref: "/migrate/v2",
  exportMapHref: "/reference/v1/export-map",
} as const;

/** Whether a URL (`/reference/v1/...`) or content path (`reference/v1/...`) is in the v1 reference. */
export function isV1Reference(path: string): boolean {
  return /^\/?reference\/v1(?:\/|$)/.test(path);
}

/** The notice as the raw-Markdown block a v1 page's `.md` opens with. */
export const V1_DEPRECATION_MARKDOWN = [
  `## ${V1_DEPRECATION_NOTICE.title}`,
  "",
  `> ${V1_DEPRECATION_NOTICE.summary}`,
  `> ${V1_DEPRECATION_NOTICE.importGuidance}`,
  `> **${V1_DEPRECATION_NOTICE.agentGuidance}**`,
  `> [Read the v1 to v2 migration guide](${V1_DEPRECATION_NOTICE.migrationHref}) and [use the complete export map](${V1_DEPRECATION_NOTICE.exportMapHref}).`,
  "",
].join("\n");
