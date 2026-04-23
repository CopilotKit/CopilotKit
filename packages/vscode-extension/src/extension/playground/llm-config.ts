import * as fs from "node:fs";
import * as path from "node:path";

export type LlmProvider = "openai" | "anthropic";

const ENABLED_PROVIDERS: readonly LlmProvider[] = ["openai", "anthropic"];

export type LlmConfigResult =
  | {
      source: "explicit" | "auto-detect";
      provider: LlmProvider;
      model: string;
      apiKey: string;
    }
  | { source: "missing" };

export interface LlmConfigDeps {
  /** Read a VSCode SecretStorage key (never resolved from settings.json). */
  readSecret(key: string): Promise<string | undefined>;
  /** Read a VSCode workspace/user setting by dotted path. */
  readSetting(key: string): unknown;
  /** Parse the workspace `.env` file into a key→value record. Returns {} if absent. */
  readEnvFile(workspaceRoot: string): Record<string, string>;
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-6",
};

const ENV_KEY_FOR: Record<LlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const SECRET_KEY_FOR: Record<LlmProvider, string> = {
  openai: "copilotkit.openai.apiKey",
  anthropic: "copilotkit.anthropic.apiKey",
};

/**
 * Resolves provider + model + apiKey in priority order:
 *   1. settings provider/model + SecretStorage key  → "explicit"
 *   2. workspace `.env` auto-detect                 → "auto-detect"
 *   3. nothing found                                → { source: "missing" }
 */
export async function resolveLlmConfig(
  workspaceRoot: string,
  deps: LlmConfigDeps,
): Promise<LlmConfigResult> {
  const settingProvider = coerceProvider(
    deps.readSetting("copilotkit.playground.provider"),
  );
  if (settingProvider && ENABLED_PROVIDERS.includes(settingProvider)) {
    const apiKey = await deps.readSecret(SECRET_KEY_FOR[settingProvider]);
    if (apiKey) {
      const model =
        (deps.readSetting("copilotkit.playground.model") as
          | string
          | undefined) ?? DEFAULT_MODELS[settingProvider];
      return { source: "explicit", provider: settingProvider, model, apiKey };
    }
  }

  const env = deps.readEnvFile(workspaceRoot);
  for (const provider of ENABLED_PROVIDERS) {
    const envKey = ENV_KEY_FOR[provider];
    const value = env[envKey];
    if (value) {
      return {
        source: "auto-detect",
        provider,
        model: DEFAULT_MODELS[provider],
        apiKey: value,
      };
    }
  }

  return { source: "missing" };
}

function coerceProvider(v: unknown): LlmProvider | null {
  if (v === "openai" || v === "anthropic") return v;
  return null;
}

/**
 * Parses a workspace `.env` file into a flat key→value record.
 * Ignores blank lines + `# comment` lines. Strips matching surrounding
 * single/double quotes from values. Missing file returns `{}`.
 */
export function parseEnvFile(workspaceRoot: string): Record<string, string> {
  const file = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  const content = fs.readFileSync(file, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
