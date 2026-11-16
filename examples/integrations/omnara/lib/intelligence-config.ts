import { z } from "zod";

/** Read the server-side Intelligence settings, or explain what setup is missing. */
export function intelligenceConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const config = z
    .object({
      CPK_INTELLIGENCE_API_KEY: z.string().min(1),
      CPK_APP_USER_ID: z.string().min(1),
      INTELLIGENCE_API_URL: z.string().url().optional(),
      INTELLIGENCE_GATEWAY_WS_URL: z.string().url().optional(),
    })
    .safeParse({
      ...env,
      INTELLIGENCE_API_URL: env.INTELLIGENCE_API_URL || undefined,
      INTELLIGENCE_GATEWAY_WS_URL: env.INTELLIGENCE_GATEWAY_WS_URL || undefined,
    });
  if (!config.success) {
    const keys = [...new Set(config.error.issues.map((i) => i.path[0]))];
    throw new Error(
      `Intelligence setup is incomplete. Check ${keys.join(", ")} in .env, then run npm run doctor. See README.md.`,
    );
  }
  const data = config.data;
  return {
    userId: data.CPK_APP_USER_ID,
    intelligence: {
      apiKey: data.CPK_INTELLIGENCE_API_KEY,
      ...(data.INTELLIGENCE_API_URL
        ? { apiUrl: data.INTELLIGENCE_API_URL }
        : {}),
      ...(data.INTELLIGENCE_GATEWAY_WS_URL
        ? { wsUrl: data.INTELLIGENCE_GATEWAY_WS_URL }
        : {}),
    },
  };
}
