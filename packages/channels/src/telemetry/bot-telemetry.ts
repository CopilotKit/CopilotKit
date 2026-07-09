import { lambdaClient, isTelemetryDisabled } from "@copilotkit/shared";
import type { LambdaSendOptions } from "@copilotkit/shared";
import type { StateStore } from "../state/state-store.js";
import { resolveInstallId } from "./install-id.js";

export const BOT_TELEMETRY_EVENTS = [
  "oss.bot.configured",
  "oss.bot.started",
  "oss.bot.start_failed",
  "oss.bot.agent_run",
  "oss.bot.agent_run_failed",
] as const;
export type BotTelemetryEvent = (typeof BOT_TELEMETRY_EVENTS)[number];

export function isTestEnv(): boolean {
  const env = process.env as Record<string, string | undefined>;
  return env.NODE_ENV === "test" || !!env.VITEST || !!env.JEST_WORKER_ID;
}

export function resolveEnvironment(): string {
  const e = (process.env.NODE_ENV ?? "").toLowerCase();
  if (e === "production" || e === "development" || e === "test") return e;
  return "unknown";
}

export interface BotTelemetryOptions {
  backend: StateStore;
  packageName: string;
  packageVersion: string;
  environment?: string;
  disabled?: boolean;
  sessionId?: string;
  send?: (o: LambdaSendOptions) => Promise<void>;
  resolveId?: () => Promise<string>;
}

export class BotTelemetry {
  private readonly disabled: boolean;
  private readonly sendFn: (o: LambdaSendOptions) => Promise<void>;
  private readonly sessionId: string;
  private readonly environment: string;
  private readonly resolveId: () => Promise<string>;
  private idPromise?: Promise<string>;
  private static disclosed = false;

  constructor(private readonly opts: BotTelemetryOptions) {
    this.disabled = opts.disabled ?? (isTelemetryDisabled() || isTestEnv());
    this.sendFn = opts.send ?? lambdaClient.send;
    this.sessionId = opts.sessionId ?? globalThis.crypto.randomUUID();
    this.environment = opts.environment ?? resolveEnvironment();
    this.resolveId =
      opts.resolveId ?? (() => resolveInstallId({ backend: opts.backend }));
  }

  capture(event: BotTelemetryEvent, properties: Record<string, unknown>): void {
    if (this.disabled) return;
    this.disclose();
    void this.dispatch(event, properties);
  }

  private disclose(): void {
    if (BotTelemetry.disclosed) return;
    BotTelemetry.disclosed = true;
    console.info(
      "[CopilotKit Bot] anonymous telemetry enabled — see https://docs.copilotkit.ai/telemetry to opt out (set COPILOTKIT_TELEMETRY_DISABLED=true).",
    );
  }

  private async dispatch(
    event: BotTelemetryEvent,
    properties: Record<string, unknown>,
  ): Promise<void> {
    try {
      this.idPromise ??= this.resolveId();
      const anonymous_id = await this.idPromise;
      await this.sendFn({
        event,
        properties,
        globalProperties: {
          anonymous_id,
          bot_session_id: this.sessionId,
          environment: this.environment,
        },
        packageName: this.opts.packageName,
        packageVersion: this.opts.packageVersion,
      });
    } catch {
      /* best-effort: telemetry must not break the host app */
    }
  }
}
