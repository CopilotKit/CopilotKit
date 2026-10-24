// `npm run doctor`: is everything this app needs actually in place?
// Checks the same things the runtime relies on, in the same order it would fail.

import "dotenv/config";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createLicenseContextValue } from "@copilotkit/shared";
import { ApiError, bearerToken, createOmnaraClient, sdk } from "@omnara/sdk";
import { DEFAULT_API_URL, DEFAULT_PROFILE } from "../lib/omnara-config";
import { findProfile } from "./omnara";

const rows: { name: string; ok: boolean; detail: string }[] = [];
const row = (name: string, ok: boolean, detail: string) =>
  rows.push({ name, ok, detail });
const failure = (error: unknown) =>
  error instanceof ApiError
    ? `${error.status} ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
const choices = (items: { id: string; name: string }[]) =>
  items.map((item) => `${item.id} (${item.name})`).join(", ") || "none";

const env = process.env;
const baseUrl = env.OMNARA_API_URL || DEFAULT_API_URL;
const profileName = env.OMNARA_PROFILE || DEFAULT_PROFILE;

const client = createOmnaraClient({
  baseUrl,
  auth: bearerToken(env.OMNARA_API_KEY ?? ""),
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }),
});

/** Each check needs the one before it, so stop at the first failure. */
async function checkOmnara() {
  if (!env.OMNARA_API_KEY)
    return row(
      "API key",
      false,
      "set OMNARA_API_KEY in .env (create a token at https://app.omnara.com)",
    );
  const orgs = await sdk
    .listOrganizations({ client })
    .then(({ data }) => data.data)
    .catch((error: unknown) => {
      row("API key", false, `${baseUrl}: ${failure(error)}`);
    });
  if (!orgs) return;
  row("API key", true, baseUrl);

  const org = orgs.find((o) => o.id === env.OMNARA_ORG_ID);
  if (!org)
    return row(
      "organization",
      false,
      `set OMNARA_ORG_ID to one of: ${choices(orgs)}`,
    );
  row("organization", true, `${org.name} (${org.id})`);

  const { data: projects } = await sdk.listVisibleProjects({
    client,
    path: { orgID: org.id },
    query: { limit: 100 },
  });
  const project = projects.data.find((p) => p.id === env.OMNARA_PROJECT_ID);
  if (!project)
    return row(
      "project",
      false,
      `set OMNARA_PROJECT_ID to one of: ${choices(projects.data)}`,
    );
  row("project", true, `${project.name} (${project.id})`);

  const profile = await findProfile(
    client,
    { orgID: org.id, projectID: project.id },
    profileName,
  );
  if (!profile)
    return row(
      "profile",
      false,
      `${profileName} missing: run \`npm run agent:apply\``,
    );
  const model = profile.current_config.model;
  row(
    "profile",
    true,
    `${profile.name} · ${model.provider_config} / ${model.name}`,
  );
}

await checkOmnara().catch((error: unknown) =>
  row("Omnara API", false, failure(error)),
);

if (env.CPK_INTELLIGENCE_API_KEY) {
  try {
    const intelligence = new CopilotKitIntelligence({
      apiKey: env.CPK_INTELLIGENCE_API_KEY,
      ...(env.INTELLIGENCE_API_URL ? { apiUrl: env.INTELLIGENCE_API_URL } : {}),
      ...(env.INTELLIGENCE_GATEWAY_WS_URL
        ? { wsUrl: env.INTELLIGENCE_GATEWAY_WS_URL }
        : {}),
    });
    const result = await intelligence.getRuntimeEntitlements();
    if (result.status !== "ready") throw new Error(result.error.message);
    // The same check the thread drawer makes before it lists threads.
    const threads = createLicenseContextValue(undefined, result).checkFeature(
      "threads",
    );
    row(
      "Intelligence",
      threads,
      threads ? "threads enabled" : "this project has no threads entitlement",
    );
  } catch (error) {
    row(
      "Intelligence",
      false,
      `${failure(error)}; check CPK_INTELLIGENCE_API_KEY`,
    );
  }
} else {
  row(
    "Intelligence",
    false,
    "missing: run `npx copilotkit@latest project select`",
  );
}

row(
  "mock mode",
  true,
  env.AGENT_URL ? `AGENT_URL=${env.AGENT_URL} (Omnara bypassed)` : "off",
);

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows)
  console.log(
    `${r.ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m"} ${r.name.padEnd(width)}  ${r.detail}`,
  );
process.exit(rows.every((r) => r.ok) ? 0 : 1);
