/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — TelemetryAgentRunner:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — TelemetryAgentRunnerConfig:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * TelemetryAgentRunner - A wrapper around AgentRunner that adds telemetry
 * for agent execution streams.
 *
 * This captures the following telemetry events:
 * - oss.runtime.agent_execution_stream_started - when an agent execution starts
 * - oss.runtime.agent_execution_stream_ended - when an agent execution completes
 * - oss.runtime.agent_execution_stream_errored - when an agent execution fails
 */

import { type AgentRunner, InMemoryAgentRunner } from "../../../v2/runtime";
import { createHash } from "node:crypto";
import { tap, catchError, finalize } from "rxjs";
import telemetry from "../telemetry-client";
import type { AgentExecutionResponseInfo } from "@copilotkit/shared/src/telemetry/events";

/**
 * Configuration options for TelemetryAgentRunner
 */
export interface TelemetryAgentRunnerConfig {
  /**
   * The underlying runner to delegate to
   * If not provided, defaults to InMemoryAgentRunner
   */
  runner?: AgentRunner;

  /**
   * Optional LangSmith API key (will be hashed for telemetry)
   */
  langsmithApiKey?: string;
}

/**
 * An AgentRunner wrapper that adds telemetry tracking for agent executions.
 *
 * Usage:
 * ```ts
 * const runtime = new CopilotRuntime({
 *   runner: new TelemetryAgentRunner(),
 *   // or with custom runner:
 *   runner: new TelemetryAgentRunner({ runner: customRunner }),
 * });
 * ```
 */
export class TelemetryAgentRunner implements AgentRunner {
  private readonly _runner: AgentRunner;
  private readonly hashedLgcKey: string | undefined;

  constructor(config?: TelemetryAgentRunnerConfig) {
    this._runner = config?.runner ?? new InMemoryAgentRunner();
    this.hashedLgcKey = config?.langsmithApiKey
      ? createHash("sha256").update(config.langsmithApiKey).digest("hex")
      : undefined;
  }

  /**
   * Runs an agent with telemetry tracking.
   * Wraps the underlying runner's Observable stream with telemetry events.
   */
  run(...args: Parameters<AgentRunner["run"]>): ReturnType<AgentRunner["run"]> {
    const streamInfo: AgentExecutionResponseInfo = {
      hashedLgcKey: this.hashedLgcKey,
    };
    let streamErrored = false;

    // Capture stream started event
    telemetry.capture("oss.runtime.agent_execution_stream_started", {
      hashedLgcKey: this.hashedLgcKey,
    });

    // Delegate to the underlying runner and wrap with telemetry
    return this._runner.run(...args).pipe(
      // Extract metadata from events if available
      tap((event) => {
        // Try to extract provider/model info from raw events
        const rawEvent = (
          event as {
            rawEvent?: {
              metadata?: Record<string, unknown>;
              data?: Record<string, unknown>;
            };
          }
        ).rawEvent;
        if (rawEvent?.data) {
          const data = rawEvent.data as { output?: { model?: string } };
          if (data?.output?.model) {
            streamInfo.model = data.output.model;
            streamInfo.provider = data.output.model;
          }
        }
        if (rawEvent?.metadata) {
          const metadata = rawEvent.metadata as {
            langgraph_host?: string;
            langgraph_version?: string;
          };
          if (metadata?.langgraph_host) {
            streamInfo.langGraphHost = metadata.langgraph_host;
          }
          if (metadata?.langgraph_version) {
            streamInfo.langGraphVersion = metadata.langgraph_version;
          }
        }
      }),
      catchError((error) => {
        // Capture stream error event
        streamErrored = true;
        telemetry.capture("oss.runtime.agent_execution_stream_errored", {
          ...streamInfo,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }),
      finalize(() => {
        // Capture stream ended event (only if not errored)
        if (!streamErrored) {
          telemetry.capture(
            "oss.runtime.agent_execution_stream_ended",
            streamInfo,
          );
        }
      }),
    );
  }

  /**
   * Delegates to the underlying runner's connect method
   */
  connect(
    ...args: Parameters<AgentRunner["connect"]>
  ): ReturnType<AgentRunner["connect"]> {
    return this._runner.connect(...args);
  }

  /**
   * Delegates to the underlying runner's isRunning method
   */
  isRunning(
    ...args: Parameters<AgentRunner["isRunning"]>
  ): ReturnType<AgentRunner["isRunning"]> {
    return this._runner.isRunning(...args);
  }

  /**
   * Delegates to the underlying runner's stop method
   */
  stop(
    ...args: Parameters<AgentRunner["stop"]>
  ): ReturnType<AgentRunner["stop"]> {
    return this._runner.stop(...args);
  }
}
