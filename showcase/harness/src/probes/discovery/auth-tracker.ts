import { DiscoverySourceAuthError } from "./errors.js";
import type { DiscoverySourceError } from "./errors.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import type { Logger, ProbeResult } from "../../types/index.js";

type DiscoveryAuthSignal =
  | {
      errorMessage: string;
      sourceName: string;
      firstFailureAt: string;
      authFailuresSinceSuccess: number;
      cacheStatus: "serving-stale" | "no-cache";
    }
  | {
      recovered: true;
      sourceName: string;
      recoveredAt: string;
    };

interface SourceAuthState {
  authFailuresSinceSuccess: number;
  firstFailureAt: string | null;
  lastErrorMessage: string | null;
  isAlerting: boolean;
  lastWriteAt: number | null;
}

export interface AuthTrackerOptions {
  threshold: number;
  writer: StatusWriter;
  logger: Logger;
  now: () => number;
}

/** Minimum interval (ms) between sustained-alerting writes to PocketBase. */
const SUSTAINED_WRITE_INTERVAL_MS = 300_000; // 5 minutes

export class DiscoveryAuthTracker {
  private readonly opts: AuthTrackerOptions;
  private readonly states = new Map<string, SourceAuthState>();

  constructor(opts: AuthTrackerOptions) {
    this.opts = opts;
  }

  private getState(sourceName: string): SourceAuthState {
    let state = this.states.get(sourceName);
    if (!state) {
      state = {
        authFailuresSinceSuccess: 0,
        firstFailureAt: null,
        lastErrorMessage: null,
        isAlerting: false,
        lastWriteAt: null,
      };
      this.states.set(sourceName, state);
    }
    return state;
  }

  async recordSuccess(sourceName: string): Promise<void> {
    const state = this.getState(sourceName);
    const wasAlerting = state.isAlerting;

    state.authFailuresSinceSuccess = 0;
    state.firstFailureAt = null;
    state.lastErrorMessage = null;
    state.isAlerting = false;

    if (wasAlerting) {
      const recoveredAt = new Date(this.opts.now()).toISOString();
      const result: ProbeResult<DiscoveryAuthSignal> = {
        key: "system:discovery-auth-failed",
        state: "green",
        signal: {
          recovered: true,
          sourceName,
          recoveredAt,
        },
        observedAt: recoveredAt,
      };
      this.opts.logger.info("discovery.auth-tracker.recovered", {
        sourceName,
        recoveredAt,
      });
      await this.opts.writer.write(result);
    }
  }

  async recordFailure(
    sourceName: string,
    error: DiscoverySourceError,
    cacheStatus: "serving-stale" | "no-cache",
  ): Promise<void> {
    if (!(error instanceof DiscoverySourceAuthError)) {
      return;
    }

    const state = this.getState(sourceName);
    state.authFailuresSinceSuccess += 1;
    if (state.firstFailureAt === null) {
      state.firstFailureAt = new Date(this.opts.now()).toISOString();
    }
    state.lastErrorMessage = error.message;

    if (state.authFailuresSinceSuccess >= this.opts.threshold) {
      const observedAt = new Date(this.opts.now()).toISOString();
      const result: ProbeResult<DiscoveryAuthSignal> = {
        key: "system:discovery-auth-failed",
        state: "red",
        signal: {
          errorMessage: error.message,
          sourceName,
          firstFailureAt: state.firstFailureAt!,
          authFailuresSinceSuccess: state.authFailuresSinceSuccess,
          cacheStatus,
        },
        observedAt,
      };

      const now = this.opts.now();

      if (!state.isAlerting) {
        state.isAlerting = true;
        this.opts.logger.warn("discovery.auth-tracker.threshold-crossed", {
          sourceName,
          authFailuresSinceSuccess: state.authFailuresSinceSuccess,
          threshold: this.opts.threshold,
          cacheStatus,
        });
        state.lastWriteAt = now;
        await this.opts.writer.write(result);
      } else {
        this.opts.logger.debug("discovery.auth-tracker.sustained-alert", {
          sourceName,
          authFailuresSinceSuccess: state.authFailuresSinceSuccess,
          cacheStatus,
        });

        // Rate-limit sustained alerting writes: at most once per 5 minutes
        const elapsed = now - (state.lastWriteAt ?? 0);
        if (elapsed >= SUSTAINED_WRITE_INTERVAL_MS) {
          state.lastWriteAt = now;
          await this.opts.writer.write(result);
        }
      }
    }
  }
}
