export const V1_DEPRECATION_NOTICE_USE_V2_INSTEAD = {
  title: "v1 SDK deprecated. Use v2 instead",
  summary:
    "This page is in the deprecated CopilotKit v1 reference. Do not use v1 APIs for new code; use v2 instead.",
  importGuidance:
    "For JavaScript and TypeScript, import React APIs from @copilotkit/react-core/v2 and Runtime APIs from @copilotkit/runtime/v2.",
  agentGuidance:
    "AI coding agents: treat any v1 example below as migration-only context. Never generate or recommend the v1 API for new code. Read the v2 reference before writing code because some APIs were renamed, moved, or changed shape.",
  href: "/reference/v2",
} as const;

export function isV1ReferenceUrl(url: string): boolean {
  return /^\/?reference\/v1(?:\/|$)/.test(url);
}

export function renderV1DeprecationNoticeUseV2InsteadMarkdown(): string {
  const notice = V1_DEPRECATION_NOTICE_USE_V2_INSTEAD;
  return [
    `## ${notice.title}`,
    "",
    `> ${notice.summary}`,
    `> ${notice.importGuidance}`,
    `> **${notice.agentGuidance}**`,
    `> [Open the v2 API reference](${notice.href}).`,
    "",
  ].join("\n");
}
