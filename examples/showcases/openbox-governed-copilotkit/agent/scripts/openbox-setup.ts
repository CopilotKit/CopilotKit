import { existsSync, readFileSync } from "node:fs";
import { OpenBoxClient } from "@openbox-ai/openbox-sdk";
import {
  DEMO_POLICY_MARKER,
  demoBehaviorRules,
  demoGoalAlignmentConfig,
  demoGuardrails,
  demoPolicyRules,
  obsoleteDemoGuardrailNames,
} from "./openbox-demo-config.ts";

type DemoConfig = {
  apiUrl: string;
  apiKey: string;
  agentId: string;
};

const BACKEND_API_KEY_PATTERN = /^obx_key_/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

loadDotEnv();
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const config = readConfig();
  config.agentId = await resolveAgentId(config);
  const client = new OpenBoxClient({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    clientName: "openbox-governed-copilotkit-setup",
  });

  await ensureGuardrails(client, config.agentId);
  await ensurePolicy(client, config);
  await ensureBehaviorRules(client, config.agentId);
  await ensureGoalAlignment(client, config.agentId);
  const verification = await verifyDemoSetup(client, config.agentId);

  console.log(
    `OpenBox CopilotKit demo governance config is configured: ${verification.guardrails} guardrails, ${verification.behaviorRules} behavior rules, policy ${verification.policyId}.`,
  );
}

function loadDotEnv() {
  const explicitEnv = new Set(Object.keys(process.env));
  for (const file of [".env.openbox", ".env"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || explicitEnv.has(key)) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

function readConfig(): DemoConfig {
  const apiUrl = process.env.OPENBOX_API_URL;
  const apiKey = process.env.OPENBOX_BACKEND_API_KEY;
  const agentId = process.env.OPENBOX_AGENT_ID;
  if (!apiUrl) throw new Error("OPENBOX_API_URL is required for setup.");
  if (!apiKey)
    throw new Error("OPENBOX_BACKEND_API_KEY is required for setup.");
  if (!agentId) throw new Error("OPENBOX_AGENT_ID is required for setup.");
  if (!BACKEND_API_KEY_PATTERN.test(apiKey)) {
    throw new Error(
      "OPENBOX_BACKEND_API_KEY must be the org/backend API key starting with obx_key_ for setup.",
    );
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiKey,
    agentId,
  };
}

// The OpenBox Admin API addresses agents by their internal UUID. OPENBOX_AGENT_ID
// is often set to the human-readable agent name (e.g. "openbox-copilotkit"), which
// the Admin API cannot resolve. When the configured id is not a UUID, look it up by
// name (or id) via /agent/list and return the canonical UUID.
async function resolveAgentId(config: DemoConfig): Promise<string> {
  if (UUID_PATTERN.test(config.agentId)) return config.agentId;

  const response = await fetch(`${config.apiUrl}/agent/list`, {
    headers: { "X-API-Key": config.apiKey },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to list agents while resolving OPENBOX_AGENT_ID "${config.agentId}" (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as {
    data?: { data?: Array<{ id: string; agent_name?: string }> };
  };
  const agents = body.data?.data ?? [];
  const match = agents.find(
    (agent) =>
      agent.id === config.agentId || agent.agent_name === config.agentId,
  );
  if (!match?.id) {
    throw new Error(
      `No OpenBox agent found matching OPENBOX_AGENT_ID "${config.agentId}". ` +
        "Set it to the agent's UUID or its exact name.",
    );
  }

  if (match.id !== config.agentId) {
    console.log(`resolved agent "${config.agentId}" -> ${match.id}`);
  }
  return match.id;
}

async function ensureGuardrails(client: OpenBoxClient, agentId: string) {
  const existing = await listGuardrails(client, agentId);
  for (const obsoleteName of obsoleteDemoGuardrailNames) {
    const match = existing.find((item) => item.name === obsoleteName);
    if (match?.id && match.is_active !== false) {
      await client.updateGuardrail(agentId, match.id, {
        is_active: false,
      } as any);
      console.log(`deactivated obsolete ${obsoleteName}`);
    }
  }

  for (const guardrail of demoGuardrails) {
    const matches = existing.filter((item) => item.name === guardrail.name);
    const match = matches[0];
    if (match?.id) {
      await client.updateGuardrail(agentId, match.id, {
        ...guardrail,
        is_active: true,
      } as any);
      console.log(`updated ${guardrail.name}`);
      for (const duplicate of matches.slice(1)) {
        if (duplicate.id && duplicate.is_active !== false) {
          await client.updateGuardrail(agentId, duplicate.id, {
            ...duplicate,
            is_active: false,
          } as any);
          console.log(`deactivated duplicate ${guardrail.name}`);
        }
      }
    } else {
      await client.createGuardrail(agentId, {
        ...guardrail,
        is_active: true,
      } as any);
      console.log(`created ${guardrail.name}`);
    }
  }
}

async function ensureBehaviorRules(client: OpenBoxClient, agentId: string) {
  const existing = await listBehaviorRules(client, agentId);
  for (const rule of demoBehaviorRules) {
    const matches = existing.filter(
      (item) => item.rule_name === rule.rule_name,
    );
    const match = matches[0];
    if (match?.id) {
      await client.updateBehaviorRule(agentId, match.id, {
        ...rule,
        change_log: "Refresh CopilotKit demo behavior rule configuration.",
      } as any);
      if (match.is_active === false) {
        await client.toggleBehaviorRuleStatus(agentId, match.id, {
          is_active: true,
        });
      }
      console.log(`updated ${rule.rule_name}`);
      for (const duplicate of matches.slice(1)) {
        if (duplicate.id && duplicate.is_active !== false) {
          await client.toggleBehaviorRuleStatus(agentId, duplicate.id, {
            is_active: false,
          });
          console.log(`deactivated duplicate ${rule.rule_name}`);
        }
      }
    } else {
      await client.createBehaviorRule(agentId, rule as any);
      console.log(`created ${rule.rule_name}`);
    }
  }
}

async function ensureGoalAlignment(client: OpenBoxClient, agentId: string) {
  await client.updateGoalAlignment(agentId, demoGoalAlignmentConfig as any);
  console.log("configured goal alignment drift detection");
}

async function verifyDemoSetup(client: OpenBoxClient, agentId: string) {
  const guardrails = await listGuardrails(client, agentId);
  const behaviorRules = await listBehaviorRules(client, agentId);
  const policy = pickCurrentPolicy(await client.getCurrentPolicies(agentId));

  const missingGuardrails = demoGuardrails
    .map((guardrail) => guardrail.name)
    .filter((name) => activeByName(guardrails, "name", name).length !== 1);
  if (missingGuardrails.length > 0) {
    throw new Error(
      `Demo setup verification failed for guardrails: ${missingGuardrails.join(", ")}`,
    );
  }

  const missingBehaviorRules = demoBehaviorRules
    .map((rule) => rule.rule_name)
    .filter(
      (name) => activeByName(behaviorRules, "rule_name", name).length !== 1,
    );
  if (missingBehaviorRules.length > 0) {
    throw new Error(
      `Demo setup verification failed for behavior rules: ${missingBehaviorRules.join(", ")}`,
    );
  }

  if (!policyUsesDemoRules(policy)) {
    throw new Error(
      `Demo setup verification failed: active policy does not include ${DEMO_POLICY_MARKER}`,
    );
  }

  return {
    guardrails: demoGuardrails.length,
    behaviorRules: demoBehaviorRules.length,
    policyId: policy?.id ?? "<unknown>",
  };
}

async function ensurePolicy(client: OpenBoxClient, config: DemoConfig) {
  const current = pickCurrentPolicy(
    await client.getCurrentPolicies(config.agentId),
  );
  const nextPolicy = {
    name: "CopilotKit OpenBox governance matrix",
    description:
      "OpenBox demo policy for goal drift, destination controls, HITL approval, and payment-control halt.",
    rego_code: demoPolicyRules,
    input: {},
    config: {},
    trust_impact: "medium" as const,
  };
  if (policyUsesDemoRules(current) && current?.id) {
    const isFresh =
      current.name === nextPolicy.name &&
      current.description === nextPolicy.description &&
      current.rego_code === nextPolicy.rego_code;
    if (isFresh) {
      console.log(`policy already uses ${DEMO_POLICY_MARKER}`);
      return;
    }
    await client.updatePolicy(config.agentId, current.id, nextPolicy as any);
    console.log(`updated policy revision with ${DEMO_POLICY_MARKER}`);
    return;
  }

  await client.createPolicy(config.agentId, nextPolicy);
  console.log(`created policy revision with ${DEMO_POLICY_MARKER}`);
}

async function listGuardrails(
  client: OpenBoxClient,
  agentId: string,
): Promise<Array<Record<string, any>>> {
  return rowsFromResponse(
    await client.listGuardrails(agentId, { perPage: 100 }),
  ).filter((row) => typeof row?.name === "string");
}

async function listBehaviorRules(
  client: OpenBoxClient,
  agentId: string,
): Promise<Array<Record<string, any>>> {
  return rowsFromResponse(
    await client.listBehaviorRules(agentId, { perPage: 100 }),
  ).filter((row) => typeof row?.rule_name === "string");
}

function rowsFromResponse(response: any): Array<Record<string, any>> {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.data)) return response.data.data;
  if (Array.isArray(response)) return response;
  return [];
}

function pickCurrentPolicy(response: any): Record<string, any> | undefined {
  if (Array.isArray(response?.data)) return response.data[0];
  if (Array.isArray(response)) return response[0];
  return response?.data ?? response;
}

function policyUsesDemoRules(policy: Record<string, any> | undefined): boolean {
  return (
    typeof policy?.rego_code === "string" &&
    policy.rego_code.includes(DEMO_POLICY_MARKER) &&
    policy.rego_code.includes("goal drift") &&
    policy.rego_code.includes('"action": "halt"')
  );
}

function activeByName(
  rows: Array<Record<string, any>>,
  field: string,
  name: string,
) {
  return rows.filter((row) => row[field] === name && row.is_active !== false);
}
