import { z } from "zod";

/** The profile `npm run agent:apply` creates from omnara/agent.yaml. */
export const DEFAULT_PROFILE = "copilotkit-assistant";
/** Hosted Omnara. A self-hosted deployment serves its API at /api/v1. */
export const DEFAULT_API_URL = "https://api.omnara.com/v1";

/** Read the server-side Omnara settings, or explain what setup is missing. */
export function omnaraConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const config = z
    .object({
      OMNARA_API_KEY: z.string().min(1),
      OMNARA_ORG_ID: z.string().startsWith("org_"),
      OMNARA_PROJECT_ID: z.string().startsWith("proj_"),
      OMNARA_PROFILE: z.string().min(1).default(DEFAULT_PROFILE),
      OMNARA_API_URL: z.string().url().default(DEFAULT_API_URL),
    })
    .safeParse({
      ...env,
      OMNARA_PROFILE: env.OMNARA_PROFILE || undefined,
      OMNARA_API_URL: env.OMNARA_API_URL || undefined,
    });
  if (!config.success) {
    const keys = [...new Set(config.error.issues.map((i) => i.path[0]))];
    throw new Error(
      `Omnara setup is incomplete. Check ${keys.join(", ")} in .env, then run npm run doctor. See README.md.`,
    );
  }
  const data = config.data;
  return {
    apiKey: data.OMNARA_API_KEY,
    orgId: data.OMNARA_ORG_ID,
    projectId: data.OMNARA_PROJECT_ID,
    profile: data.OMNARA_PROFILE,
    baseUrl: data.OMNARA_API_URL,
  };
}
