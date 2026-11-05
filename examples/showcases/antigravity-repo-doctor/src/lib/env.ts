import { z } from "zod";

// Blank values in .env files mean "unset", not "empty string".
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const ServerEnv = z.object({
  /** The Python Antigravity agent (agent/). */
  AGENT_URL: z.string().url().default("http://127.0.0.1:8000/"),
  /** CopilotKit Intelligence project key. Unset runs without threads. */
  CPK_INTELLIGENCE_API_KEY: optional(z.string().min(1)),
  INTELLIGENCE_API_URL: optional(z.string().url()),
  INTELLIGENCE_GATEWAY_WS_URL: optional(z.string().url()),
  /**
   * Optional read-only GitHub token (public repositories need no scopes), used
   * only for the server's GitHub API reads. Unset works, at 60 requests an hour.
   */
  GITHUB_TOKEN: optional(z.string().min(1)),
  /** The user for requests that carry no name yet (see src/lib/user.ts). */
  DEMO_USER_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).default("repo-doctor-demo"),
  ),
});

export type ServerEnv = z.infer<typeof ServerEnv>;

let cached: ServerEnv | undefined;

/** Validated server environment. Throws a readable error on bad config. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnv.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid environment:\n${problems.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
