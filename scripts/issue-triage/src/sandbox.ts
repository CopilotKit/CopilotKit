import {
  defineSandbox,
  defineWorkspace,
  withSandbox,
  gitSkill,
  createSecrets,
  defineSandboxPolicy,
} from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";

export function buildSandbox(o: { sourcePath: string; ghToken: string }) {
  const secrets = createSecrets({ GH: o.ghToken });
  const readOnlyPolicy = defineSandboxPolicy({
    commands: { deny: ["git push*", "gh pr*", "rm -rf *", "sudo *"] },
    capabilities: { network: "allow", fileWrite: "allow" }, // triage relies on permissionMode:'plan' for read-only; policy blocks push/PR either way
    default: "allow",
  });
  const definition = defineSandbox({
    id: "issue-triage",
    // Pin the sandbox root to the checked-out repo so the agent works on it in place.
    // local-process ignores workspace.source.path; only `dir` sets the working tree,
    // otherwise create() spins up an empty random temp dir (agent sees no repo).
    provider: localProcessSandbox({ dir: o.sourcePath }),
    workspace: defineWorkspace({
      source: { type: "local", path: o.sourcePath },
      skills: [
        gitSkill({
          repo: "CopilotKit/internal-skills",
          secret: secrets.GH,
          into: "/tmp/triage-skills/internal-skills",
        }),
      ],
      secrets,
    }),
    policy: readOnlyPolicy,
    lifecycle: { reuse: "none" },
  });
  return { definition, withSandbox: withSandbox(definition) };
}
