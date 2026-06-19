import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas for the Claude-Desktop MCP config shape
// ---------------------------------------------------------------------------

const StdioEntrySchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const RemoteEntrySchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

// An entry must have EITHER command (stdio) OR url (remote), not an
// ambiguous mix.  We discriminate via a union so Zod gives a clear error
// when neither field is present.
const ServerEntrySchema = z.union([StdioEntrySchema, RemoteEntrySchema]);

const McpConfigSchema = z.object({
  servers: z.record(ServerEntrySchema),
});

// ---------------------------------------------------------------------------
// Normalized tagged-union types
// ---------------------------------------------------------------------------

export interface StdioServerConfig {
  name: string;
  kind: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface RemoteServerConfig {
  name: string;
  kind: "remote";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type McpServerConfig = StdioServerConfig | RemoteServerConfig;

// ---------------------------------------------------------------------------
// parseMcpConfig
// ---------------------------------------------------------------------------

/**
 * Validate `raw` against the Claude-Desktop MCP config shape and return a
 * flat array of normalized {@link McpServerConfig} objects.
 *
 * Throws a descriptive error when:
 * - `raw` does not satisfy the Zod schema (including a missing `servers` key)
 * - An entry has neither `command` nor `url`
 */
export function parseMcpConfig(raw: unknown): McpServerConfig[] {
  const result = McpConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid MCP config: ${result.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join("; ")}`,
    );
  }

  const configs: McpServerConfig[] = [];

  for (const [name, entry] of Object.entries(result.data.servers)) {
    if ("command" in entry && typeof entry.command === "string") {
      const stdio = entry as z.infer<typeof StdioEntrySchema>;
      const config: StdioServerConfig = {
        name,
        kind: "stdio",
        command: stdio.command,
      };
      if (stdio.args !== undefined) config.args = stdio.args;
      if (stdio.env !== undefined) config.env = stdio.env;
      if (stdio.enabled !== undefined) config.enabled = stdio.enabled;
      configs.push(config);
    } else if ("url" in entry && typeof entry.url === "string") {
      const remote = entry as z.infer<typeof RemoteEntrySchema>;
      const config: RemoteServerConfig = {
        name,
        kind: "remote",
        url: remote.url,
      };
      if (remote.headers !== undefined) config.headers = remote.headers;
      if (remote.enabled !== undefined) config.enabled = remote.enabled;
      configs.push(config);
    } else {
      throw new Error(
        `MCP server "${name}" must have either a "command" (stdio) or "url" (remote) field`,
      );
    }
  }

  return configs;
}

// ---------------------------------------------------------------------------
// loadMcpConfig
// ---------------------------------------------------------------------------

/**
 * Read a JSON file at `path` using the injected `read` function, parse it,
 * and return normalized {@link McpServerConfig} objects.
 *
 * Returns `[]` when the file does not exist (ENOENT); rethrows all other
 * errors.
 *
 * The `read` parameter is injected so this module stays electron-free and
 * is straightforward to unit-test.
 */
export function loadMcpConfig(
  read: (path: string) => string,
  path: string,
): McpServerConfig[] {
  let text: string;
  try {
    text = read(path);
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }

  const raw: unknown = JSON.parse(text);
  return parseMcpConfig(raw);
}
