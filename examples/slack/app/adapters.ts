import type { PlatformAdapter } from "@copilotkit/bot";
import { slack } from "@copilotkit/bot-slack";
import { whatsapp } from "@copilotkit/bot-whatsapp";

/**
 * Build the platform adapters for this deployment from env. Slack is always
 * present; WhatsApp is added only when its credentials are set, so slack-only
 * local dev still runs and WhatsApp activates wherever its env exists (the
 * Railway bot service). The WhatsApp webhook listens on Railway's injected
 * `$PORT` (the public domain routes there); locally it defaults to 3000.
 */
export function buildAdapters(env: NodeJS.ProcessEnv): PlatformAdapter[] {
  const need = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
  };

  const adapters: PlatformAdapter[] = [
    slack({
      botToken: need("SLACK_BOT_TOKEN"),
      appToken: need("SLACK_APP_TOKEN"),
    }),
  ];

  if (env.WHATSAPP_ACCESS_TOKEN) {
    // Fail loud on a malformed PORT rather than letting `Number("abc")` → NaN
    // reach `server.listen()` (Railway always injects a clean numeric $PORT).
    const port = env.PORT ? Number(env.PORT) : 3000;
    if (!Number.isInteger(port) || port < 0) {
      throw new Error(`Invalid PORT: "${env.PORT}" is not a valid port number`);
    }
    adapters.push(
      whatsapp({
        accessToken: need("WHATSAPP_ACCESS_TOKEN"),
        phoneNumberId: need("WHATSAPP_PHONE_NUMBER_ID"),
        appSecret: need("WHATSAPP_APP_SECRET"),
        verifyToken: need("WHATSAPP_VERIFY_TOKEN"),
        port,
        path: env.WHATSAPP_PATH ?? "/webhook",
      }),
    );
  }

  return adapters;
}
