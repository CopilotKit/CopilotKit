import { lambdaClient, isTelemetryDisabled } from "@copilotkit/shared";
import type { LambdaSendOptions } from "@copilotkit/shared";
import type { StateStore } from "../state/state-store.js";
import { resolveInstallId } from "./install-id.js";

export const CHANNEL_TELEMETRY_EVENTS = [
  "oss.channel.configured",
  "oss.channel.started",
  "oss.channel.start_failed",
  "oss.channel.agent_run",
  "oss.channel.agent_run_failed",
] as const;
export type ChannelTelemetryEvent = (typeof CHANNEL_TELEMETRY_EVENTS)[number];

export function isTestEnv(): boolean {
  const env = process.env as Record<string, string | undefined>;
  return env.NODE_ENV === "test" || !!env.VITEST || !!env.JEST_WORKER_ID;
}

export function resolveEnvironment(): string {
  const e = (process.env.NODE_ENV ?? "").toLowerCase();
  if (e === "production" || e === "development" || e === "test") return e;
  return "unknown";
}

export interface ChannelTelemetryOptions {
  backend: StateStore;
  packageName: string;
  packageVersion: string;
  environment?: string;
  disabled?: boolean;
  sessionId?: string;
  send?: (o: LambdaSendOptions) => Promise<void>;
  resolveId?: () => Promise<string>;
}

export class ChannelTelemetry {
  private readonly disabled: boolean;
  private readonly sendFn: (o: LambdaSendOptions) => Promise<void>;
  private readonly sessionId: string;
  private readonly environment: string;
  private readonly resolveId: () => Promise<string>;
  private idPromise?: Promise<string>;
  private static disclosed = false;

  constructor(private readonly opts: ChannelTelemetryOptions) {
    this.disabled = opts.disabled ?? (isTelemetryDisabled() || isTestEnv());
    this.sendFn = opts.send ?? lambdaClient.send;
    this.sessionId = opts.sessionId ?? globalThis.crypto.randomUUID();
    this.environment = opts.environment ?? resolveEnvironment();
    this.resolveId =
      opts.resolveId ?? (() => resolveInstallId({ backend: opts.backend }));
  }

  capture(
    event: ChannelTelemetryEvent,
    properties: Record<string, unknown>,
  ): void {
    if (this.disabled) return;
    this.disclose();
    void this.dispatch(event, properties);
  }

  private disclose(): void {
    if (ChannelTelemetry.disclosed) return;
    ChannelTelemetry.disclosed = true;
    console.info(
      "[CopilotKit Channel] anonymous telemetry enabled — see https://docs.copilotkit.ai/telemetry to opt out (set COPILOTKIT_TELEMETRY_DISABLED=true).",
    );
  }

  private async dispatch(
    event: ChannelTelemetryEvent,
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
          channel_session_id: this.sessionId,
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
