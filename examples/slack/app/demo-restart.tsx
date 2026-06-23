/**
 * Durable-action restart demo — proves an interactive action survives a bot
 * restart. Minimal (Slack only, NO agent backend): on @mention it posts an
 * approval card whose **Create button's onClick does the work directly**
 * (self-contained — no agent run, no awaitChoice). Because the action snapshot
 * is persisted in the configured `store` and the component is registered at
 * startup via `components`, the click re-fires after a process restart.
 *
 * Redis is OPTIONAL:
 *   • No `REDIS_URL`  -> in-memory store (default). Runs out of the box, but a
 *     click that lands after a restart degrades to "action expired".
 *   • With `REDIS_URL` -> Redis-backed store. Kill + restart the bot between
 *     posting and clicking, and the action still fires (durable).
 *
 * Linear is OPTIONAL: with `LINEAR_API_KEY` the Create button files a real
 * Linear issue; without it, it just resolves the card (so the demo runs with
 * only Slack tokens).
 *
 * Run:
 *   pnpm demo:restart                          # in-memory, no Redis needed
 *   docker compose up -d && REDIS_URL=redis://localhost:6379 pnpm demo:restart
 */
import "dotenv/config";
import { createBot } from "@copilotkit/bot";
import type { StoreConfig } from "@copilotkit/bot";
import { slack } from "@copilotkit/bot-slack";
import { createRedisStore } from "@copilotkit/bot-store-redis";
import {
  Message,
  Header,
  Section,
  Context,
  Actions,
  Button,
} from "@copilotkit/bot-ui";
import type { InteractionContext } from "@copilotkit/bot-ui";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const REDIS_URL = process.env.REDIS_URL;

// --- Optional Linear write (direct GraphQL; no agent / MCP) ------------------
async function linearGraphQL<T>(query: string, variables: object): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY as string,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || json.errors) {
    throw new Error(
      `Linear API error: ${JSON.stringify(json.errors ?? res.status)}`,
    );
  }
  return json.data as T;
}

async function createLinearIssue(
  title: string,
): Promise<{ identifier: string; url: string }> {
  const teamKey = required("LINEAR_TEAM_KEY");
  const teams = await linearGraphQL<{ teams: { nodes: { id: string }[] } }>(
    `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`,
    { key: teamKey },
  );
  const teamId = teams.teams.nodes[0]?.id;
  if (!teamId) throw new Error(`No Linear team with key ${teamKey}`);
  const created = await linearGraphQL<{
    issueCreate: {
      success: boolean;
      issue: { identifier: string; url: string };
    };
  }>(
    `mutation($teamId: String!, $title: String!) {
       issueCreate(input: { teamId: $teamId, title: $title }) {
         success issue { identifier url }
       }
     }`,
    { teamId, title },
  );
  if (!created.issueCreate.success)
    throw new Error("Linear issueCreate failed");
  return created.issueCreate.issue;
}

// --- The durable HITL card (self-contained onClick does the write) -----------
interface ConfirmCreateIssueProps {
  title: string;
}

export function ConfirmCreateIssue({ title }: ConfirmCreateIssueProps) {
  return (
    <Message accent="#E2B340">
      <Header>{`📝 Create Linear issue?`}</Header>
      <Section>{`**${title}**`}</Section>
      <Context>
        {REDIS_URL
          ? "🔒  Nothing is written until you click **Create**. Kill + restart the bot first to prove durability."
          : "🔒  Nothing is written until you click **Create**. (Set REDIS_URL for restart-durable actions.)"}
      </Context>
      <Actions>
        <Button
          value={{ confirmed: true }}
          style="primary"
          onClick={async ({ thread, message }: InteractionContext) => {
            try {
              if (LINEAR_API_KEY) {
                const issue = await createLinearIssue(title);
                await thread.update(
                  message.ref,
                  <Message accent="#27AE60">
                    <Header>{`✅ Created ${issue.identifier}`}</Header>
                    <Section>{`**${title}**`}</Section>
                    <Context>{`✅  ${issue.url}`}</Context>
                  </Message>,
                );
              } else {
                await thread.update(
                  message.ref,
                  <Message accent="#27AE60">
                    <Header>{`✅ Approved`}</Header>
                    <Section>{`**${title}**`}</Section>
                    <Context>
                      {
                        "✅  Approved (demo — set LINEAR_API_KEY to file a real issue)."
                      }
                    </Context>
                  </Message>,
                );
              }
            } catch (err) {
              await thread.update(
                message.ref,
                <Message accent="#EB5757">
                  <Header>{`⚠️ Create failed`}</Header>
                  <Context>{`${(err as Error).message}`}</Context>
                </Message>,
              );
            }
          }}
        >
          Create
        </Button>
        <Button
          value={{ confirmed: false }}
          style="danger"
          onClick={async ({ thread, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#EB5757">
                <Header>{`🚫 Cancelled`}</Header>
                <Context>{"🚫  Nothing was written."}</Context>
              </Message>,
            );
          }}
        >
          Cancel
        </Button>
      </Actions>
    </Message>
  );
}

async function main() {
  // Redis is optional: configure a durable backend only when REDIS_URL is set;
  // otherwise omit `adapter` and the bot uses the in-memory default.
  const store: StoreConfig | undefined = REDIS_URL
    ? { adapter: createRedisStore({ url: REDIS_URL }) }
    : undefined;

  const bot = createBot({
    adapters: [
      slack({
        botToken: required("SLACK_BOT_TOKEN"),
        appToken: required("SLACK_APP_TOKEN"),
      }),
    ],
    store,
    // Registered at startup so a click landing AFTER a restart can re-render
    // this component from the persisted snapshot and re-fire its onClick.
    components: [ConfirmCreateIssue],
  });

  bot.onMention(async ({ thread, message }) => {
    const title = message.text.trim().slice(0, 120) || "Untitled (demo)";
    await thread.post(<ConfirmCreateIssue title={title} />);
  });

  await bot.start();
  console.log(
    `[demo] up (pid ${process.pid}) — store: ${REDIS_URL ? "redis (durable)" : "in-memory"}, ` +
      `write: ${LINEAR_API_KEY ? "linear" : "demo (no LINEAR_API_KEY)"}. @mention the bot.`,
  );

  const stop = async () => {
    await bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((err) => {
  console.error("[demo] fatal", err);
  process.exit(1);
});
