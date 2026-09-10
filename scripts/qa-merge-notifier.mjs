import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const FAC_IDENTIFIER_PATTERN = /\bFAC-\d+\b/i;
const SLACK_PERMALINK_PATTERN =
  /https:\/\/[A-Za-z0-9.-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+/;

export function extractLinearIdentifier(pr) {
  const candidates = [pr?.head?.ref, pr?.title, pr?.body];

  for (const candidate of candidates) {
    const match = candidate?.match?.(FAC_IDENTIFIER_PATTERN);
    if (match) {
      return match[0].toUpperCase();
    }
  }

  return null;
}

export function extractSlackPermalink(issue) {
  const attachmentUrls =
    issue?.attachments?.nodes?.map((attachment) => attachment?.url) ?? [];
  const candidates = [...attachmentUrls, issue?.description];

  for (const candidate of candidates) {
    const match = candidate?.match?.(SLACK_PERMALINK_PATTERN);
    if (match) {
      return match[0];
    }
  }

  return null;
}

export function parseSlackPermalink(permalink) {
  const match = permalink.match(
    /\/archives\/(?<channel>[A-Z0-9]+)\/p(?<rawTs>\d+)/,
  );
  if (
    !match?.groups?.channel ||
    !match.groups.rawTs ||
    match.groups.rawTs.length <= 10
  ) {
    return null;
  }

  const { channel, rawTs } = match.groups;
  return {
    channel,
    threadTs: `${rawTs.slice(0, 10)}.${rawTs.slice(10)}`,
  };
}

export function buildQaThreadMessage(issue) {
  return `This has been fixed and merged. It will go out with the next release. Reference: ${issue.identifier}.`;
}

export function buildTeamOssMessage(issue, pr) {
  return `Merged from QA: ${issue.identifier} - ${issue.title}. PR: ${pr.html_url}. This will go out with the next release.`;
}

async function fetchLinearIssue(identifier, { fetchFn, linearApiKey }) {
  const response = await fetchFn("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: linearApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        query QaMergeNotifierIssue($id: String!) {
          issue(id: $id) {
            identifier
            title
            url
            description
            attachments {
              nodes {
                title
                url
              }
            }
          }
        }
      `,
      variables: { id: identifier },
    }),
  });

  if (!response.ok) {
    throw new Error(`Linear API returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(
      `Linear API error: ${payload.errors.map((error) => error.message).join("; ")}`,
    );
  }

  return payload.data?.issue ?? null;
}

async function postSlackMessage({
  fetchFn,
  slackBotToken,
  channel,
  text,
  threadTs,
}) {
  const response = await fetchFn("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackBotToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack API returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Slack API error: ${payload.error ?? "unknown_error"}`);
  }

  return payload;
}

export async function notifyMergedQaPr({
  event,
  env = process.env,
  fetchFn = globalThis.fetch,
  log = console,
} = {}) {
  const pr = event?.pull_request;

  if (!pr?.merged) {
    log.info("PR was closed without merging; skipping QA merge notification.");
    return { status: "skipped", reason: "not_merged" };
  }

  const identifier = extractLinearIdentifier(pr);
  if (!identifier) {
    log.info(
      "Merged PR does not reference a FAC issue; skipping QA merge notification.",
    );
    return { status: "skipped", reason: "no_fac_issue" };
  }

  if (!env.LINEAR_API_KEY) {
    log.warn("LINEAR_API_KEY is not set; cannot look up the QA Linear issue.");
    return { status: "skipped", reason: "missing_linear_api_key", identifier };
  }

  if (!env.SLACK_BOT_TOKEN) {
    log.warn(
      "SLACK_BOT_TOKEN is not set; cannot post Slack merge notifications.",
    );
    return { status: "skipped", reason: "missing_slack_bot_token", identifier };
  }

  let issue;
  try {
    issue = await fetchLinearIssue(identifier, {
      fetchFn,
      linearApiKey: env.LINEAR_API_KEY,
    });
  } catch (error) {
    log.warn(`Could not look up ${identifier} in Linear: ${error.message}`);
    return { status: "skipped", reason: "linear_lookup_failed", identifier };
  }

  if (!issue) {
    log.info(
      `Linear issue ${identifier} was not found; skipping QA merge notification.`,
    );
    return { status: "skipped", reason: "linear_issue_not_found", identifier };
  }

  const results = {
    status: "notified",
    identifier,
    qaThreadPosted: false,
    teamOssPosted: false,
  };

  const permalink = extractSlackPermalink(issue);
  const slackThread = permalink ? parseSlackPermalink(permalink) : null;

  if (slackThread) {
    try {
      await postSlackMessage({
        fetchFn,
        slackBotToken: env.SLACK_BOT_TOKEN,
        channel: slackThread.channel,
        threadTs: slackThread.threadTs,
        text: buildQaThreadMessage(issue),
      });
      results.qaThreadPosted = true;
    } catch (error) {
      log.warn(
        `Could not post QA thread notification for ${identifier}: ${error.message}`,
      );
    }
  } else {
    log.warn(
      `No usable Slack permalink found on ${identifier}; skipping QA thread reply.`,
    );
  }

  if (env.TEAM_OSS_CHANNEL_ID) {
    try {
      await postSlackMessage({
        fetchFn,
        slackBotToken: env.SLACK_BOT_TOKEN,
        channel: env.TEAM_OSS_CHANNEL_ID,
        text: buildTeamOssMessage(issue, pr),
      });
      results.teamOssPosted = true;
    } catch (error) {
      log.warn(
        `Could not post #team-oss notification for ${identifier}: ${error.message}`,
      );
    }
  } else {
    log.warn(
      "TEAM_OSS_CHANNEL_ID is not set; skipping #team-oss merge notification.",
    );
  }

  return results;
}

export async function main({
  env = process.env,
  fetchFn = globalThis.fetch,
  log = console,
} = {}) {
  if (!env.GITHUB_EVENT_PATH) {
    log.warn("GITHUB_EVENT_PATH is not set; skipping QA merge notification.");
    return { status: "skipped", reason: "missing_event_path" };
  }

  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  return notifyMergedQaPr({ event, env, fetchFn, log });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
