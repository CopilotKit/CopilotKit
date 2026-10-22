// `npm run agent:apply`: create or update the Omnara profile from
// omnara/agent.yaml. `npm run agent:plan` reports what apply would do.
//
// Omnara agent configs never change once created, so an update uploads a new
// config and points the profile at it. Existing threads keep their config.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { ApiError, bearerToken, createOmnaraClient, sdk } from "@omnara/sdk";
import { omnaraConfig } from "../lib/omnara-config";
import { findProfile } from "./omnara";

const dryRun = process.argv.includes("--dry-run");
const file = "omnara/agent.yaml";

try {
  const config = omnaraConfig(process.env);
  const source = readFileSync(file, "utf8");
  const client = createOmnaraClient({
    baseUrl: config.baseUrl,
    auth: bearerToken(config.apiKey),
  });
  const project = { orgID: config.orgId, projectID: config.projectId };
  const profile = await findProfile(client, project, config.profile);

  if (profile?.current_config.source === source) {
    console.log(`Profile ${profile.name} already uses ${file}.`);
  } else if (dryRun) {
    console.log(
      profile
        ? `Apply would point profile ${profile.name} (${profile.id}) at a new config from ${file}.`
        : `Apply would create profile ${config.profile} from ${file}.`,
    );
  } else {
    const { data: created } = await sdk.createAgentConfig({
      client,
      path: project,
      body: { source, source_format: "yaml" },
    });
    if (profile) {
      await sdk.updateAgentProfile({
        client,
        path: { ...project, agentProfileID: profile.id },
        body: {
          config: created.id,
          expected_current_config_id: profile.current_config_id,
        },
      });
      console.log(
        `Updated profile ${profile.name} (${profile.id}). New threads use config ${created.id}.`,
      );
    } else {
      const { data: added } = await sdk.createAgentProfile({
        client,
        path: project,
        body: { name: config.profile, config: created.id },
      });
      console.log(
        `Created profile ${added.name} (${added.id}) with config ${created.id}.`,
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  // Config validation errors point at the offending line of agent.yaml.
  for (const issue of error instanceof ApiError ? error.issues : [])
    console.error(
      `  ${file}${issue.line ? `:${issue.line}` : ""} ${issue.path}: ${issue.message}`,
    );
  // fetch rejects with a TypeError when it cannot reach the API at all.
  if (error instanceof TypeError)
    console.error("Run npm run doctor to check the Omnara connection.");
  process.exit(1);
}
