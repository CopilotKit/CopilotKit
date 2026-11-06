import { sdk } from "@omnara/sdk";
import type { OmnaraClient } from "@omnara/sdk";

type Project = { orgID: string; projectID: string };

/** Find OMNARA_PROFILE, a profile id (aprf_...) or name, as the app does. */
export async function findProfile(
  client: OmnaraClient,
  project: Project,
  profile: string,
) {
  let id = profile.startsWith("aprf_") ? profile : undefined;
  if (!id) {
    const { data } = await sdk.listAgentProfiles({
      client,
      path: project,
      // The name filter is a glob, so match the literal name.
      query: { name: profile.replace(/[\\*?]/g, "\\$&"), limit: 100 },
    });
    id = data.data.find((p) => p.name === profile)?.id;
  }
  if (!id) return undefined;
  const { data } = await sdk.getAgentProfile({
    client,
    path: { ...project, agentProfileID: id },
  });
  return data;
}
