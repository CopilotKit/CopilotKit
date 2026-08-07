/**
 * ONE-TIME SETUP — run `npm run setup`, then start the server.
 *
 * Managed agents are persistent, versioned resources: create them once, store
 * the IDs, and reference them on every session. This script provisions a
 * cloud environment and a single financial-assistant agent on claude-fable-5.
 *
 * IDs land in agent-ids.json at the repo root (gitignored). Re-running with
 * --force re-provisions and overwrites the file.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentCreateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { EnvironmentCreateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_IDS_PATH = path.resolve(here, "../../agent-ids.json");

export interface AgentIds {
  environmentId: string;
  agentId: string;
}

const MODEL = "claude-fable-5";

const ASSISTANT_SYSTEM = `You are a careful, plain-spoken personal finance assistant. Your job is
to help people review their personal finances, brainstorm ideas, and think through best
practices for planning their future.

How you work:
- Start by understanding the user's goal and the numbers that matter. If a projection is
  missing its monthly contribution, annual return, or time horizon, ask only for the missing
  value instead of presenting a long intake form.
- Use web_search when current data would change the answer (rates, limits, recent policy
  changes) rather than answering from memory, and say when figures are as-of a date.
- Use bash and files in your workspace for compound-growth calculations. Show the numbers,
  not the code.
- CRITICAL: Whenever the user asks what recurring investments could grow to, calculate the
  projection and call show_growth_projection with the starting balance, monthly contribution,
  annual return, and horizon. If no starting balance is given, use 0. Call the visual tool
  directly as a top-level tool call, never from inside a repl script: a repl-wrapped call cannot
  reach the user. Keep the surrounding prose short and let the interactive visual carry the answer.
- You provide educational guidance, not personalized investment advice. When a decision
  depends on someone's full financial picture (taxes, jurisdiction, risk tolerance), say what
  generally applies and note what a licensed professional would need to know. Keep answers
  tight; one short disclaimer at most, and only where genuinely warranted.`;

interface ProvisioningClient {
  beta: {
    environments: {
      create(params: EnvironmentCreateParams): Promise<{ id: string }>;
      delete(environmentId: string): Promise<unknown>;
    };
    agents: {
      create(
        params: AgentCreateParams,
      ): Promise<{ id: string; version: number }>;
    };
  };
}

interface SetupLogger {
  log(message: string): void;
  error(message: string): void;
}

export async function provisionAgentResources(
  client: ProvisioningClient,
  logger: SetupLogger = console,
): Promise<AgentIds> {
  // The chat endpoint that fronts this agent is unauthenticated in the demo, so
  // keep the blast radius small: the container gets no outbound network (bash
  // and files still work for calculations), and web_fetch stays off because
  // arbitrary URL fetches are the classic prompt-injection + exfil channel.
  // web_search stays on for current rates and limits.
  logger.log("Creating environment…");
  const environment = await client.beta.environments.create({
    name: `financial-assistant-demo-${Date.now().toString(36)}`,
    config: {
      type: "cloud",
      networking: {
        type: "limited",
        allowed_hosts: [],
        allow_package_managers: false,
        allow_mcp_servers: false,
      },
    },
  });
  logger.log(`  environment ${environment.id}`);

  try {
    logger.log("Creating agent…");
    const agent = await client.beta.agents.create({
      name: "financial-assistant",
      model: MODEL,
      system: ASSISTANT_SYSTEM,
      // The financial assistant tools are not registered here: the AG-UI
      // adapter adds them to each session as tool overrides, merged with the
      // toolset below, so changing them never requires re-provisioning.
      tools: [
        {
          type: "agent_toolset_20260401",
          configs: [{ name: "web_fetch", enabled: false }],
        },
      ],
    });
    logger.log(`  financial-assistant ${agent.id} (version ${agent.version})`);

    return {
      environmentId: environment.id,
      agentId: agent.id,
    };
  } catch (error) {
    logger.log(
      `Agent creation failed; deleting environment ${environment.id}…`,
    );
    try {
      await client.beta.environments.delete(environment.id);
      logger.log(`  deleted environment ${environment.id}`);
    } catch (cleanupError) {
      const detail =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
      logger.error(
        `Cleanup also failed for environment ${environment.id}: ${detail}. Delete it manually in the Anthropic Console.`,
      );
    }
    throw error;
  }
}

function printEnvExports(ids: AgentIds) {
  console.log("Deploying somewhere without agent-ids.json? Set these instead:");
  console.log(`  ANTHROPIC_ENVIRONMENT_ID=${ids.environmentId}`);
  console.log(`  ANTHROPIC_AGENT_ID=${ids.agentId}`);
}

async function main() {
  const force = process.argv.includes("--force");
  if (fs.existsSync(AGENT_IDS_PATH) && !force) {
    console.log(
      `agent-ids.json already exists — agents are reusable, not per-run.`,
    );
    console.log(`Re-run with --force to re-provision.\n`);
    printEnvExports(
      JSON.parse(fs.readFileSync(AGENT_IDS_PATH, "utf8")) as AgentIds,
    );
    return;
  }

  // Zero-arg client: resolves ANTHROPIC_API_KEY or an `ant auth login` profile.
  const client = new Anthropic();

  const ids = await provisionAgentResources(client);
  fs.writeFileSync(AGENT_IDS_PATH, JSON.stringify(ids, null, 2) + "\n");
  console.log(`\nWrote ${AGENT_IDS_PATH}`);
  console.log("Setup complete. Start the demo with: npm run dev\n");
  printEnvExports(ids);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export function loadAgentIds(): AgentIds {
  // Env vars first — deployment platforms without a persistent disk (Vercel,
  // Netlify, containers built from a clean checkout) can't ship agent-ids.json.
  const { ANTHROPIC_ENVIRONMENT_ID, ANTHROPIC_AGENT_ID } = process.env;
  const envVars = {
    ANTHROPIC_ENVIRONMENT_ID,
    ANTHROPIC_AGENT_ID,
  };
  const missing = Object.keys(envVars).filter(
    (k) => !envVars[k as keyof typeof envVars],
  );
  if (missing.length === 1) {
    // A partial set is a deploy-config mistake, not a fallback case.
    throw new Error(
      `Agent env vars partially set: missing ${missing.join(", ")}.`,
    );
  }
  if (ANTHROPIC_ENVIRONMENT_ID && ANTHROPIC_AGENT_ID) {
    return {
      environmentId: ANTHROPIC_ENVIRONMENT_ID,
      agentId: ANTHROPIC_AGENT_ID,
    };
  }
  if (!fs.existsSync(AGENT_IDS_PATH)) {
    throw new Error(
      "No agent configured — run `npm run setup` first, or set " +
        "ANTHROPIC_ENVIRONMENT_ID and ANTHROPIC_AGENT_ID.",
    );
  }
  return JSON.parse(fs.readFileSync(AGENT_IDS_PATH, "utf8")) as AgentIds;
}
