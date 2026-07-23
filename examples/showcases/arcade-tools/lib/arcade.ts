import Arcade from "@arcadeai/arcadejs";

/**
 * Server-side Arcade client, created lazily so the module can be imported (e.g.
 * during `next build`) without `ARCADE_API_KEY` set, since the SDK throws on
 * construction when the key is missing. It's instantiated on first use, inside
 * the request, where the env var is available.
 *
 * Keep this module server-only (it is imported from the runtime route, which
 * runs on the server). Never import it from a Client Component, which would
 * ship your Arcade API key to the browser bundle.
 */
let arcadeClient: Arcade | undefined;
function getArcade(): Arcade {
  if (!arcadeClient) {
    arcadeClient = new Arcade({ apiKey: process.env.ARCADE_API_KEY });
  }
  return arcadeClient;
}

/**
 * Arcade scopes every authorization and tool call to a stable user id, which
 * it uses to vault and reuse each user's OAuth tokens. In production this is
 * YOUR authenticated user's id (their email, a UUID, etc.), derived per-request
 * from your own auth/session.
 *
 * We fail CLOSED in production on purpose: a shared fallback id would put every
 * end user on ONE Arcade token vault, so whoever connected Gmail last would own
 * it, so visitor B could read visitor A's inbox. A demo fallback only applies in
 * development so `npm run dev` works out of the box.
 */
export function getArcadeUserId(): string {
  const userId = process.env.ARCADE_USER_ID;
  if (userId) return userId;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ARCADE_USER_ID is not set. In production, derive a stable per-user id from " +
        "your authenticated session and pass it to runArcadeTool. Never share one id.",
    );
  }
  return "demo-user@example.com";
}

export type ArcadeToolResult =
  | {
      authorizationRequired: true;
      toolName: string;
      provider: string;
      authUrl: string;
    }
  | {
      authorizationRequired: false;
      toolName: string;
      provider: string;
      output: unknown;
    }
  | { error: string; toolName: string };

/**
 * Authorize-then-execute, the core Arcade pattern, wrapped so a CopilotKit
 * tool can call it in one line.
 *
 * 1. `tools.authorize` asks Arcade whether this user has already granted the
 *    OAuth scopes the tool needs. Tools that need no auth (e.g. web search)
 *    come back `"completed"` immediately. The status enum is
 *    `not_started | pending | completed | failed`.
 * 2. If the user hasn't authorized yet (`pending`/`not_started`) we DON'T block
 *    the run. We hand the auth URL back to the chat so CopilotKit can render a
 *    "Connect" card. The user approves in a new tab, then asks the agent to
 *    continue; the next call sees `"completed"` and runs the tool. A `failed`
 *    status (or a missing URL) becomes an error instead of a dead card.
 * 3. `tools.execute` runs the tool with the user's vaulted credentials and
 *    returns its structured output. Credentials never touch the LLM.
 *
 * Important: Arcade reports *runtime* failures as data (`success === false`
 * and/or `output.error`), NOT as a thrown exception. We must check for them, or
 * a failed send/read would render a false "success" card to the user.
 */
export async function runArcadeTool({
  toolName,
  input,
  userId,
}: {
  toolName: string;
  input: Record<string, unknown>;
  userId: string;
}): Promise<ArcadeToolResult> {
  const provider = providerLabel(toolName);

  try {
    const arcade = getArcade();
    const auth = await arcade.tools.authorize({
      tool_name: toolName,
      user_id: userId,
    });

    if (auth.status !== "completed") {
      // `failed`, or a missing URL we can't render: surface an error, not a
      // Connect card that links nowhere.
      if (auth.status === "failed" || !auth.url) {
        return {
          error: `Couldn't start authorization for ${provider}. Please try again.`,
          toolName,
        };
      }
      return {
        authorizationRequired: true,
        toolName,
        provider,
        authUrl: auth.url,
      };
    }

    const response = await arcade.tools.execute({
      tool_name: toolName,
      input,
      user_id: userId,
    });

    // Fail closed: a runtime error comes back here, not in `catch`. Log the full
    // detail server-side, but in production don't forward the tool's raw error
    // message (it can contain addresses or internal detail) to the browser/model.
    if (response.success === false || response.output?.error) {
      console.error(
        `[arcade] ${toolName} returned an error:`,
        response.output?.error ?? "(success=false)",
      );
      return {
        error:
          process.env.NODE_ENV === "production"
            ? "The tool call didn't complete. Please try again."
            : (response.output?.error?.message ?? "The tool call failed."),
        toolName,
      };
    }

    return {
      authorizationRequired: false,
      toolName,
      provider,
      output: response.output?.value ?? null,
    };
  } catch (err) {
    // Unexpected/transport error. Return a plain error shape instead of throwing
    // (a thrown error kills the agent run; a returned object lets the model
    // explain and recover). Don't leak internals to the browser in production -
    // log the detail server-side and surface a generic message.
    console.error(`[arcade] ${toolName} failed:`, err);
    const detail = err instanceof Error ? err.message : String(err);
    return {
      error:
        process.env.NODE_ENV === "production"
          ? "The tool call failed unexpectedly. Check the server logs for details."
          : detail,
      toolName,
    };
  }
}

/**
 * Friendly service name for the authorization card, derived from the Arcade
 * tool name. e.g. `"Gmail.SendEmail"` -> `"Gmail"`.
 */
export function providerLabel(toolName: string): string {
  const toolkit = toolName.split(".")[0] ?? toolName;
  const map: Record<string, string> = {
    Gmail: "Gmail",
    Google: "Google",
    GoogleNews: "Google News",
    GoogleDocs: "Google Docs",
    GoogleCalendar: "Google Calendar",
    GitHub: "GitHub",
    Slack: "Slack",
    Notion: "Notion",
    Linear: "Linear",
    X: "X",
  };
  return map[toolkit] ?? toolkit;
}
