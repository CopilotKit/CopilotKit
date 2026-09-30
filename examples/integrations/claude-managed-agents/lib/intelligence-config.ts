import { z } from "zod";

/** Require complete server-side Learning wiring rather than silently disabling it. */
export function intelligenceConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const config = z
    .object({
      CPK_INTELLIGENCE_API_KEY: z.string().min(1),
      CPK_INTELLIGENCE_LEARNING_CONTAINER_ID: z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      CPK_APP_USER_ID: z.string().min(1),
      INTELLIGENCE_API_URL: z.string().url().optional(),
      INTELLIGENCE_GATEWAY_WS_URL: z.string().url().optional(),
    })
    .safeParse({
      ...env,
      INTELLIGENCE_API_URL: env.INTELLIGENCE_API_URL || undefined,
      INTELLIGENCE_GATEWAY_WS_URL: env.INTELLIGENCE_GATEWAY_WS_URL || undefined,
    });
  if (!config.success)
    throw new Error(
      "Intelligence setup is incomplete. Configure the project key, Learning Container, and local app-user ID in .env.local. See README.md.",
    );
  const data = config.data;
  return {
    containerId: data.CPK_INTELLIGENCE_LEARNING_CONTAINER_ID,
    userId: data.CPK_APP_USER_ID,
    intelligence: {
      apiKey: data.CPK_INTELLIGENCE_API_KEY,
      ...(data.INTELLIGENCE_API_URL
        ? { apiUrl: data.INTELLIGENCE_API_URL }
        : {}),
      ...(data.INTELLIGENCE_GATEWAY_WS_URL
        ? { wsUrl: data.INTELLIGENCE_GATEWAY_WS_URL }
        : {}),
      getLearningContainerId: () => data.CPK_INTELLIGENCE_LEARNING_CONTAINER_ID,
    },
  };
}
