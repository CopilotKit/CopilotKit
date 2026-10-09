import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(root, "packages/channels/native-catalogs.md");
const TEAMS_IDENTITIES = {
  Persona: "graph.microsoft.com/user",
  PersonaSet: "graph.microsoft.com/users",
  File: "graph.microsoft.com/file",
  GraphResource: "graph.microsoft.com/resource",
  CalendarEvent: "graph.microsoft.com/event",
};

function slackTable(entries) {
  return entries
    .map(({ component, type }) => `| ${component} | \`${type}\` |`)
    .join("\n");
}

async function rows(relativePath) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  return [...source.matchAll(/\["([^"]+)",\s*"([^"]+)"/g)].map(
    ([, component, type]) => ({ component, type }),
  );
}

async function rowsFor(relativePath, constant) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const start = source.indexOf(`export const ${constant} = [`);
  const end = source.indexOf("] as const", start);
  if (start < 0 || end < 0) throw new Error(`Could not parse ${constant}`);
  return [
    ...source.slice(start, end).matchAll(/\["([^"]+)",\s*"([^"]+)"/g),
  ].map(([, component, type]) => ({ component, type }));
}

async function manifests() {
  const teamsPath = "packages/channels-teams/src/native-manifest.ts";
  const teams = await rows(teamsPath);
  const stableBody = new Set(
    (
      await Promise.all(
        [
          "TEAMS_ELEMENT_MANIFEST",
          "TEAMS_INPUT_MANIFEST",
          "TEAMS_CHART_MANIFEST",
          "TEAMS_GRAPH_MANIFEST",
        ].map((name) => rowsFor(teamsPath, name)),
      )
    )
      .flat()
      .map(({ component }) => component),
  );
  const stableActions = new Set(
    (await rowsFor(teamsPath, "TEAMS_ACTION_MANIFEST")).map(
      ({ component }) => component,
    ),
  );
  const preview = new Set(
    (await rowsFor(teamsPath, "TEAMS_PREVIEW_MANIFEST")).map(
      ({ component }) => component,
    ),
  );
  return {
    slack: await rows("packages/channels-slack/src/native-manifest.ts"),
    teams: teams.map((entry) => ({
      ...entry,
      status: stableBody.has(entry.component)
        ? "stable body"
        : stableActions.has(entry.component)
          ? "stable action"
          : preview.has(entry.component)
            ? "preview"
            : "supporting node",
    })),
  };
}

function inventory({ slack, teams }) {
  const teamsTable = teams
    .map(
      ({ component, type, status }) =>
        `| ${component} | \`${type}\` | ${TEAMS_IDENTITIES[component] ? `\`${TEAMS_IDENTITIES[component]}\`` : "—"} | ${status} |`,
    )
    .join("\n");
  return `# Native Channel JSX catalog\n\nThis file is generated from the reviewed Slack and Teams manifests. Run\n\`pnpm generate:channel-native-catalogs\` after a manifest change.\n\n## Slack\n\nSource: https://docs.slack.dev/reference/block-kit/\n\n<!-- prettier-ignore -->\n| JSX component | Provider type |\n| --- | --- |\n${slackTable(slack)}\n\n## Teams\n\nSource: https://adaptivecards.microsoft.com/\n\n<!-- prettier-ignore -->\n| JSX component | Provider type | Fixed identity | Status |\n| --- | --- | --- | --- |\n${teamsTable}\n`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return await response.text();
}

async function audit({ slack, teams }) {
  const slackSources = await Promise.all([
    fetchText("https://docs.slack.dev/reference/block-kit/blocks/"),
    fetchText("https://docs.slack.dev/reference/block-kit/block-elements/"),
    fetchText(
      "https://docs.slack.dev/reference/block-kit/composition-objects/",
    ),
  ]);
  const slackText = slackSources.join("\n").toLowerCase();
  const slackAliases = {
    ChannelsSelect: "channel element",
    ConversationsSelect: "select menu element",
    DateTimePicker: "datetime picker element",
    DispatchActionConfig: "dispatch action configuration object",
    ExternalSelect: "select menu element",
    MultiChannelsSelect: "multi-select menu element",
    MultiConversationsSelect: "multi-select menu element",
    MultiExternalSelect: "multi-select menu element",
    MultiStaticSelect: "multi-select menu element",
    MultiUsersSelect: "multi-select menu element",
    MarkdownText: "text object",
    Overflow: "overflow menu element",
    PlainTextInput: "plain-text input element",
    PlainText: "text object",
    RadioButtons: "radio button group element",
    RichTextText: "text element",
    StaticSelect: "select menu element",
    UsersSelect: "user element",
  };
  for (const { component } of slack) {
    const words =
      slackAliases[component]?.toLowerCase() ??
      component.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    if (!slackText.includes(words)) {
      throw new Error(`Slack source no longer lists ${component}`);
    }
  }

  const adaptiveHtml = await fetchText("https://adaptivecards.microsoft.com/");
  const bundlePath = adaptiveHtml.match(/src="([^"]*main[^"?]*\.js)"/)?.[1];
  if (!bundlePath) throw new Error("Adaptive Cards main bundle was not found");
  const adaptiveBundle = await fetchText(
    new URL(bundlePath, "https://adaptivecards.microsoft.com/").href,
  );
  for (const { type } of teams) {
    if (!adaptiveBundle.includes(type)) {
      throw new Error(`Adaptive Cards source no longer lists ${type}`);
    }
  }
  process.stdout.write(
    `Audited ${slack.length} Slack and ${teams.length} Teams catalog entries.\n`,
  );
}

const data = await manifests();
const command = process.argv[2] ?? "check";
if (command === "generate") {
  await writeFile(inventoryPath, inventory(data));
} else if (command === "check") {
  const actual = await readFile(inventoryPath, "utf8");
  if (actual !== inventory(data)) {
    throw new Error(
      "Native catalog inventory is stale. Run pnpm generate:channel-native-catalogs.",
    );
  }
} else if (command === "audit") {
  await audit(data);
} else {
  throw new Error(`Unknown command: ${command}`);
}
