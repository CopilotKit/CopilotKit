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
  // Default-DENY guardrail. A malicious issue can prompt-inject the agent, so it must
  // not be able to reach the network (exfiltrate the GH token) or run arbitrary/
  // credential-bearing commands. Allow only read-only investigation + local test/build
  // Bash; file edits for /fix go through the Edit tool (permissionMode:'acceptEdits' +
  // capabilities.fileWrite), not Bash. git push / PR creation happen in the OUTER
  // orchestrator, never here.
  const policy = defineSandboxPolicy({
    commands: {
      allow: [
        "git status*",
        "git diff*",
        "git log*",
        "git show*",
        "git grep*",
        "git ls-files*",
        "git rev-parse*",
        "git blame*",
        "ls*",
        "cat*",
        "head*",
        "tail*",
        "grep*",
        "rg*",
        "find*",
        "wc*",
        "which*",
        "echo*",
        "pwd*",
        "pnpm test*",
        "pnpm typecheck*",
        "pnpm build*",
        "pnpm lint*",
        "nx *",
        "node*",
        "npx tsc*",
      ],
      // Explicit deny (deny > allow) for the crown-jewel actions, even if a broad allow ever matches.
      deny: [
        "git push*",
        "git remote*",
        "git config*",
        "gh *",
        "curl*",
        "wget*",
        "nc*",
        "ssh*",
        "scp*",
        "rm -rf *",
        "sudo *",
        "env",
        "printenv*",
      ],
    },
    // network:deny cuts token exfiltration / direct GitHub-API abuse from inside the agent.
    // NOTE (verify in live e2e): confirm this does not also block the gitSkill bootstrap
    // clone of internal-skills. If it does, move that clone to the outer workflow step
    // (which also removes the GH token from the agent's env — see the token-isolation
    // follow-up in the PR). The Anthropic API transport is the harness runtime, not an
    // agent command, so it is not governed by this capability.
    capabilities: { network: "deny", fileWrite: "allow" },
    default: "deny",
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
    policy,
    lifecycle: { reuse: "none" },
  });
  return { definition, withSandbox: withSandbox(definition) };
}
