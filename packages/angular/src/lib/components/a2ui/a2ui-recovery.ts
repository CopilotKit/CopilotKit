import { isPlatformBrowser } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";

import type { A2UIRecoveryOptions } from "../../config";
import { safeToolValue } from "../tools/default-tool-renderer";
import { CopilotA2UIProgress } from "./a2ui-progress";
import { isRecord } from "./a2ui-surface-host";

export type A2UIDebugExposure = "hidden" | "collapsed" | "verbose";
export type A2UILifecycleStatus = "building" | "retrying" | "failed";

export interface A2UILifecycleContent {
  status: A2UILifecycleStatus;
  attempt?: number;
  maxAttempts?: number;
  progressTokens?: number;
  error?: string;
  errors?: unknown[];
  attempts?: unknown[];
  debugExposure?: A2UIDebugExposure;
}

/** Read only the server-owned A2UI lifecycle fields from activity content. */
export function readA2UILifecycleContent(
  content: unknown,
): A2UILifecycleContent {
  if (!isRecord(content)) return { status: "building" };
  const status =
    content["status"] === "retrying" || content["status"] === "failed"
      ? content["status"]
      : "building";
  const debugExposure =
    content["debugExposure"] === "hidden" ||
    content["debugExposure"] === "verbose" ||
    content["debugExposure"] === "collapsed"
      ? content["debugExposure"]
      : undefined;
  return {
    status,
    attempt:
      typeof content["attempt"] === "number" ? content["attempt"] : undefined,
    maxAttempts:
      typeof content["maxAttempts"] === "number"
        ? content["maxAttempts"]
        : undefined,
    progressTokens:
      typeof content["progressTokens"] === "number"
        ? content["progressTokens"]
        : undefined,
    error: typeof content["error"] === "string" ? content["error"] : undefined,
    errors: Array.isArray(content["errors"]) ? content["errors"] : undefined,
    attempts: Array.isArray(content["attempts"])
      ? content["attempts"]
      : undefined,
    debugExposure,
  };
}

/** Pre-paint building, retry, and failure UI for a stable A2UI activity. */
@Component({
  selector: "copilot-a2ui-recovery",
  imports: [CopilotA2UIProgress],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lifecycle().status === "failed") {
      <section class="failure" role="status" data-testid="a2ui-failure">
        <strong>Couldn't generate the UI</strong>
        <p>
          Something went wrong rendering this. You can keep chatting and try again.
        </p>
        @if (debugExposure() !== "hidden") {
          <details [attr.open]="debugExposure() === 'verbose' ? '' : null">
            <summary>Developer details</summary>
            <pre>{{ failureDiagnostics() }}</pre>
          </details>
        }
      </section>
    } @else {
      <copilot-a2ui-progress
        [phase]="phase()"
        [tokens]="lifecycle().progressTokens ?? 0"
        [label]="label()"
      />
      @if (
        lifecycle().status === "retrying" &&
        retryRevealed() &&
        debugExposure() !== "hidden" &&
        (lifecycle().errors?.length ?? 0) > 0
      ) {
        <details
          class="diagnostics"
          [attr.open]="debugExposure() === 'verbose' ? '' : null"
        >
          <summary>Validation issues</summary>
          <pre>{{ retryDiagnostics() }}</pre>
        </details>
      }
    }
  `,
  styles: `
    .failure {
      margin-block: 0.75rem;
      max-width: 32rem;
      padding: 0.75rem;
      border: 1px solid #fde68a;
      border-radius: 0.5rem;
      color: #92400e;
      background: #fffbeb;
      font-size: 0.875rem;
    }
    .failure p {
      margin: 0.25rem 0 0;
      font-size: 0.75rem;
    }
    details {
      margin-top: 0.5rem;
      font-size: 0.75rem;
    }
    summary {
      cursor: pointer;
    }
    pre {
      max-height: 14rem;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .diagnostics {
      max-width: 32rem;
      color: #52525b;
    }
  `,
})
export class CopilotA2UIRecovery {
  readonly content = input.required<unknown>();
  readonly options = input<A2UIRecoveryOptions | undefined>();
  readonly lifecycle = computed(() => readA2UILifecycleContent(this.content()));
  readonly retryRevealed = signal(false);
  readonly debugExposure = computed(
    () =>
      this.lifecycle().debugExposure ??
      this.options()?.debugExposure ??
      "collapsed",
  );
  readonly label = computed(() => {
    const lifecycle = this.lifecycle();
    if (lifecycle.status !== "retrying" || !this.retryRevealed()) {
      return "Building interface";
    }
    return lifecycle.attempt !== undefined &&
      lifecycle.maxAttempts !== undefined
      ? `Retrying generation… (${lifecycle.attempt}/${lifecycle.maxAttempts} attempts)`
      : "Retrying generation…";
  });
  readonly phase = computed(() => {
    const tokens = this.lifecycle().progressTokens;
    if (tokens === undefined) return 3;
    if (tokens < 50) return 0;
    if (tokens < 200) return 1;
    if (tokens < 400) return 2;
    return 3;
  });
  readonly failureDiagnostics = computed(() =>
    safeToolValue({
      error: this.lifecycle().error,
      attempts: this.lifecycle().attempts,
    }),
  );
  readonly retryDiagnostics = computed(() =>
    safeToolValue({
      attempt: this.lifecycle().attempt,
      errors: this.lifecycle().errors,
    }),
  );
  readonly #platformId = inject(PLATFORM_ID);
  readonly #zone = inject(NgZone);

  constructor() {
    effect((onCleanup) => {
      const lifecycle = this.lifecycle();
      const options = this.options();
      this.retryRevealed.set(false);
      if (lifecycle.status !== "retrying") return;

      const showAfterAttempts = options?.showAfterAttempts ?? 2;
      if (
        lifecycle.attempt !== undefined &&
        lifecycle.attempt >= showAfterAttempts
      ) {
        this.retryRevealed.set(true);
        return;
      }
      if (!isPlatformBrowser(this.#platformId)) return;
      const timeout = this.#zone.runOutsideAngular(() =>
        globalThis.setTimeout(
          () => this.#zone.run(() => this.retryRevealed.set(true)),
          options?.showAfterMs ?? 2000,
        ),
      );
      onCleanup(() => globalThis.clearTimeout(timeout));
    });
  }
}
