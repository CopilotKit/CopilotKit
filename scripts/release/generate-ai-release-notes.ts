/**
 * AI-powered release notes generator + Notion draft creator.
 *
 * 1. Reads the raw changelog from release-notes.md
 * 2. Calls Claude API to generate polished release notes
 * 3. Creates a Notion page with the draft (for human editing)
 * 4. Writes release-notes.md with the AI version
 * 5. Outputs the Notion page URL + ID for the workflow
 *
 * Env vars:
 *   ANTHROPIC_API_KEY           — for AI generation (falls back to raw if missing)
 *   NOTION_API_KEY              — for creating the Notion draft (skipped if missing)
 *   NOTION_RELEASE_NOTES_PAGE   — parent page ID in Notion
 *
 * Usage: tsx scripts/release/generate-ai-release-notes.ts <version>
 */

import fs from "fs";
import path from "path";
import https from "https";
import { spawnSync } from "child_process";
import { ROOT } from "./lib/config.js";
import { createReleaseDraft } from "./lib/notion.js";

function getRecentCommits(count = 50): string {
  const result = spawnSync(
    "git",
    ["log", "--oneline", `-${count}`, "--no-merges"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return result.stdout.trim();
}

function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
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
          if (parsed.content?.[0]) {
            resolve(parsed.content[0].text);
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
  if (!version) {
    console.error("Usage: generate-ai-release-notes.ts <version>");
    process.exit(1);
  }

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
    const recentCommits = getRecentCommits();

    const prompt = `You are writing release notes for CopilotKit v${version}, an open-source AI agent framework for React applications.

Here is the raw changelog extracted from git history:

${rawChangelog}

Here are the recent git commits for additional context:

${recentCommits}

Write polished, user-facing release notes for a GitHub Release. Guidelines:
- Start with a brief (1-2 sentence) summary of the release
- Group changes into clear sections (Features, Fixes, Breaking Changes as applicable)
- Write in a professional but approachable tone
- Focus on what users care about — what changed and why it matters
- Include any migration notes for breaking changes
- Keep it concise — no filler, no marketing speak
- Use markdown formatting
- Do NOT include a title/header — the GitHub Release title will be "v${version}"

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

  // Step 2: Create a Notion draft page for human editing
  const notionKey = process.env.NOTION_API_KEY;
  const notionParent = process.env.NOTION_RELEASE_NOTES_PAGE;

  if (notionKey && notionParent) {
    console.log("Creating Notion release notes draft...");
    try {
      const { pageId, url } = await createReleaseDraft(version, finalNotes);
      console.log(`Notion draft created: ${url}`);

      // Write the Notion reference so the publish workflow can find it
      const notionRef = { pageId, url, version };
      const refPath = path.join(ROOT, "release-notes-notion.json");
      fs.writeFileSync(refPath, JSON.stringify(notionRef, null, 2) + "\n");

      // Output for CI
      const outputPath = process.env.GITHUB_OUTPUT;
      if (outputPath) {
        fs.appendFileSync(outputPath, `notion_url=${url}\n`);
        fs.appendFileSync(outputPath, `notion_page_id=${pageId}\n`);
      }
    } catch (err: any) {
      console.error(`Notion draft creation failed: ${err.message}`);
      console.log("Continuing without Notion draft.");
    }
  } else {
    console.log(
      "No NOTION_API_KEY/NOTION_RELEASE_NOTES_PAGE found. Skipping Notion draft.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
