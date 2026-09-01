/**
 * AI-powered release notes generator.
 *
 * 1. Reads the raw changelog from release-notes.md
 * 2. Calls Claude API to generate polished release notes
 * 3. Writes release-notes.md with the AI version
 *
 * release-notes.md is committed to the release PR branch, which is both the
 * review surface and how the notes reach the publish job.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY — for AI generation (falls back to raw if missing)
 *
 * Usage: tsx scripts/release/generate-ai-release-notes.ts <version> <scope>
 */

import fs from "fs";
import path from "path";
import https from "https";
import { ROOT, loadConfig } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import { getCommitsSinceLastRelease } from "./lib/changes.js";

/**
 * Context for the model: the commits of THIS release lane, with bodies.
 *
 * This used to be a repo-wide `git log -50`, which fed an angular release the
 * last fifty monorepo commits — showcase renames, other packages' work — as
 * "context" for notes it had no business mentioning.
 */
function getScopeCommitContext(scope: ReleaseScope): string {
  return getCommitsSinceLastRelease(scope)
    .map((commit) =>
      [
        `commit ${commit.hash.slice(0, 7)}${commit.pr ? ` (PR #${commit.pr})` : ""}`,
        `subject: ${commit.subject}`,
        commit.body ? `body:\n${commit.body}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);

          // Thinking is on by default on current models, so the first content
          // block is not necessarily the text — select by type rather than
          // position.
          const text = (parsed.content ?? []).find(
            (block: { type?: string }) => block.type === "text",
          )?.text;

          if (typeof text === "string" && text.trim()) {
            resolve(text);
          } else {
            reject(new Error(`Unexpected API response: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const version = process.argv[2];
  const scope = process.argv[3] as ReleaseScope | undefined;
  const validScopes = Object.keys(loadConfig().scopes);

  if (!version || !scope || !validScopes.includes(scope)) {
    console.error(
      `Usage: generate-ai-release-notes.ts <version> <scope>\n` +
        `Valid scopes: ${validScopes.join(", ")}`,
    );
    process.exit(1);
  }

  const packages = loadConfig().scopes[scope].packages;
  // Only the monorepo scope is titled `vX.Y.Z`; every other lane is
  // `<scope>/vX.Y.Z`, and the notes must not claim otherwise.
  const releaseTitle =
    scope === "monorepo" ? `v${version}` : `${scope}/v${version}`;

  const releaseNotesPath = path.join(ROOT, "release-notes.md");
  if (!fs.existsSync(releaseNotesPath)) {
    console.error("release-notes.md not found. Run prepare-release.ts first.");
    process.exit(1);
  }

  const rawChangelog = fs.readFileSync(releaseNotesPath, "utf8");
  let finalNotes = rawChangelog;

  // Step 1: AI-enhance the release notes if API key is available
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    console.log("Generating AI-enhanced release notes...");
    const scopeCommits = getScopeCommitContext(scope);

    const prompt = `You are writing release notes for the \`${scope}\` release lane of CopilotKit, an open-source framework for building AI agent experiences.

This release publishes exactly these npm packages at version ${version}:
${packages.map((name) => `- ${name}`).join("\n")}

Here is the raw changelog, already filtered to the commits that touched those packages:

${rawChangelog}

Here are those same commits with their full bodies, for additional context:

${scopeCommits}

Write polished, user-facing release notes for a GitHub Release. Guidelines:
- Start with a brief (1-2 sentence) summary of the release
- Group changes into clear sections (Features, Fixes, Breaking Changes as applicable)
- Write in a professional but approachable tone
- Focus on what users care about — what changed and why it matters
- Include any migration notes for breaking changes
- Keep it concise — no filler, no marketing speak
- Use markdown formatting
- Write only about the packages listed above. Do not describe changes to other
  CopilotKit packages, the docs site, or the examples, even if a commit body
  mentions them.
- Where a change has a PR number, reference it as (#1234) so it links on GitHub
- Do NOT include a title/header — the GitHub Release title will be "${releaseTitle}"

Output ONLY the release notes content, nothing else.`;

    try {
      finalNotes = await callAnthropic(anthropicKey, prompt);
      fs.writeFileSync(releaseNotesPath, finalNotes);
      console.log("AI-enhanced release notes written to release-notes.md");
    } catch (err: any) {
      console.error(`AI generation failed: ${err.message}`);
      console.log("Falling back to raw changelog.");
    }
  } else {
    console.log(
      "No ANTHROPIC_API_KEY found. Using raw changelog as release notes.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
