import { describe, expect, it } from "vitest";

import {
  buildQaThreadMessage,
  buildTeamOssMessage,
  extractLinearIdentifier,
  extractSlackPermalink,
  notifyMergedQaPr,
  parseSlackPermalink,
} from "../qa-merge-notifier.mjs";

describe("qa merge notifier", () => {
  it("extracts a FAC issue identifier from the merged PR branch before title/body", () => {
    const issue = extractLinearIdentifier({
      head: { ref: "docs/FAC-77-state-streaming-schema" },
      title: "docs: unrelated FAC-12 mention",
      body: "Closes FAC-13",
    });

    expect(issue).toBe("FAC-77");
  });

  it("extracts the original Slack permalink from Linear attachments or description", () => {
    const fromAttachment = extractSlackPermalink({
      description: "",
      attachments: {
        nodes: [
          {
            title: "PR",
            url: "https://github.com/CopilotKit/CopilotKit/pull/5556",
          },
          {
            title: "Original Slack post (#collab-qa)",
            url: "https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009",
          },
        ],
      },
    });

    const fromDescription = extractSlackPermalink({
      description:
        "Original QA Slack report: [https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009](<https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009>)",
      attachments: { nodes: [] },
    });

    expect(fromAttachment).toBe(
      "https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009",
    );
    expect(fromDescription).toBe(
      "https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009",
    );
  });

  it("turns a Slack permalink into a channel and thread timestamp", () => {
    expect(
      parseSlackPermalink(
        "https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009",
      ),
    ).toEqual({
      channel: "C08GG122URL",
      threadTs: "1781797100.757009",
    });
  });

  it("renders QA and internal Slack messages with different link detail", () => {
    const issue = {
      identifier: "FAC-77",
      title: "Deep Agents TS state streaming example has step schema mismatch",
      url: "https://linear.app/copilotkit/issue/FAC-77/example",
    };
    const pr = {
      number: 5556,
      html_url: "https://github.com/CopilotKit/CopilotKit/pull/5556",
      title: "docs(showcase): fix Deep Agents state streaming schema",
    };

    expect(buildQaThreadMessage(issue)).toBe(
      "This has been fixed and merged. It will go out with the next release. Reference: FAC-77.",
    );
    expect(buildTeamOssMessage(issue, pr)).toBe(
      "Merged from QA: FAC-77 - Deep Agents TS state streaming example has step schema mismatch. PR: https://github.com/CopilotKit/CopilotKit/pull/5556. This will go out with the next release.",
    );
  });

  it("posts to the original QA thread and team OSS channel for merged FAC PRs", async () => {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });

      if (url === "https://api.linear.app/graphql") {
        return Response.json({
          data: {
            issue: {
              identifier: "FAC-77",
              title:
                "Deep Agents TS state streaming example has step schema mismatch",
              url: "https://linear.app/copilotkit/issue/FAC-77/example",
              description: "",
              attachments: {
                nodes: [
                  {
                    title: "Original Slack post (#collab-qa)",
                    url: "https://copilotkit.slack.com/archives/C08GG122URL/p1781797100757009",
                  },
                ],
              },
            },
          },
        });
      }

      return Response.json({ ok: true });
    };

    const result = await notifyMergedQaPr({
      fetchFn,
      log: { info() {}, warn() {} },
      env: {
        LINEAR_API_KEY: "linear-token",
        SLACK_BOT_TOKEN: "slack-token",
        TEAM_OSS_CHANNEL_ID: "C_TEAM_OSS",
      },
      event: {
        pull_request: {
          merged: true,
          head: { ref: "docs/FAC-77-state-streaming-schema" },
          title: "docs(showcase): fix Deep Agents state streaming schema",
          body: "",
          html_url: "https://github.com/CopilotKit/CopilotKit/pull/5556",
          number: 5556,
        },
      },
    });

    expect(result).toEqual({
      status: "notified",
      identifier: "FAC-77",
      qaThreadPosted: true,
      teamOssPosted: true,
    });
    expect(calls).toHaveLength(3);
    expect(calls[1].body).toMatchObject({
      channel: "C08GG122URL",
      thread_ts: "1781797100.757009",
      text: "This has been fixed and merged. It will go out with the next release. Reference: FAC-77.",
    });
    expect(calls[2].body).toMatchObject({
      channel: "C_TEAM_OSS",
      text: "Merged from QA: FAC-77 - Deep Agents TS state streaming example has step schema mismatch. PR: https://github.com/CopilotKit/CopilotKit/pull/5556. This will go out with the next release.",
    });
  });
});
