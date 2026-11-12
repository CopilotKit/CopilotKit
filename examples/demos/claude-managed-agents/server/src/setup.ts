/**
 * ONE-TIME SETUP — run `npm run setup`, then start the server.
 *
 * Managed agents are persistent, versioned resources: create them once, store
 * the IDs, and reference them on every session. This script provisions a
 * cloud environment and a single financial-assistant agent.
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

export function parseAgentIds(value: unknown): AgentIds {
  const environmentId =
    typeof value === "object" && value !== null && "environmentId" in value
      ? value.environmentId
      : undefined;
  const agentId =
    typeof value === "object" && value !== null && "agentId" in value
      ? value.agentId
      : undefined;

  if (
    typeof environmentId !== "string" ||
    environmentId.trim().length === 0 ||
    typeof agentId !== "string" ||
    agentId.trim().length === 0
  ) {
    throw new Error(
      "Invalid agent IDs: expected non-empty environmentId and agentId strings.",
    );
  }

  return { environmentId, agentId };
}

export function readAgentIdsFile(filePath = AGENT_IDS_PATH): AgentIds {
  return parseAgentIds(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

const DEFAULT_MODEL = "claude-fable-5";

const ASSISTANT_SYSTEM = `You are a careful, plain-spoken personal finance assistant. Your job is
to help people review their personal finances, brainstorm ideas, and think through best
practices for planning their future.

How you work:
- Start by understanding the user's goal and the numbers that matter. If a projection is
  missing its monthly contribution, annual return, or time horizon, ask only for the missing
  value instead of presenting a long intake form.
- Work only with figures the user provides. Do not imply access to live rates, policies,
  accounts, or external data; ask for an assumption when a current figure would matter.
- CRITICAL: Whenever the user asks what recurring investments could grow to, call
  show_growth_projection with the starting balance, monthly contribution, annual return, and
  horizon. If no starting balance is given, use 0. Keep the surrounding prose short and let the
  interactive visual carry the answer.
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
  environmentVariables: Readonly<{ ANTHROPIC_MODEL?: string }> = process.env,
): Promise<AgentIds> {
  // The chat endpoint that fronts this agent is unauthenticated in the demo, so
  // the managed environment has no outbound network and the agent's complete
  // built-in toolset is disabled. The AG-UI adapter adds only the narrowly
  // scoped financial visualization tool to each session.
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
      model: environmentVariables.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      system: ASSISTANT_SYSTEM,
      // The financial assistant tools are not registered here: the AG-UI
      // adapter adds them to each session as tool overrides, merged with the
      // toolset below, so changing them never requires re-provisioning.
      tools: [
        {
          type: "agent_toolset_20260401",
          default_config: { enabled: false },
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
    printEnvExports(readAgentIdsFile());
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
  return readAgentIdsFile();
}
