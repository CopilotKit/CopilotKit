import type { PostHog } from "posthog-js";

const KNOWN_INSTALL_TYPES = [
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "uv",
  "poetry",
  "cargo",
  "go",
  "docker",
  "curl",
  "brew",
  "helm",
  "kubectl",
  "make",
  "bash",
  "sh",
] as const;

export type InstallType = (typeof KNOWN_INSTALL_TYPES)[number] | "code";

function inferInstallType(command: string): InstallType {
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (!firstToken) return "code";
  return (KNOWN_INSTALL_TYPES as readonly string[]).includes(firstToken)
    ? (firstToken as InstallType)
    : "code";
}

export type TrackCommandCopyArgs = {
  command: string;
  location?: string;
};

export function trackCommandCopy(
  posthog: PostHog | undefined,
  { command, location }: TrackCommandCopyArgs,
) {
  if (!posthog) return;
  const trimmed = command.trim();
  if (!trimmed) return;
  posthog.capture("cli_command_copied", {
    install_type: inferInstallType(trimmed),
    ...(location ? { location } : {}),
  });
}
