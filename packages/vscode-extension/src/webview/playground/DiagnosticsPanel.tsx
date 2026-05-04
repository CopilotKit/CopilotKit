import * as React from "react";
import type { MountErrorPayload } from "../../extension/playground/bridge-types";

interface Props {
  mountErrors: MountErrorPayload[];
  runtimeUrl: string | null;
  replayMode: boolean;
  fixtureName: string | null;
  vscodeLmTools: { enabled: boolean; count: number };
  /**
   * Outcome of the Tailwind compile pass that runs alongside the bundle.
   * When omitted entirely, the playground bundled before this feature
   * landed (or the user has no workspace open).
   */
  tailwind?: { entryCss?: string; skipped?: string; error?: string };
}

export function DiagnosticsPanel({
  mountErrors,
  runtimeUrl,
  replayMode,
  fixtureName,
  vscodeLmTools,
  tailwind,
}: Props): React.JSX.Element {
  return (
    <section className="playground-diagnostics">
      <h3>Diagnostics</h3>
      <dl>
        <dt>Runtime</dt>
        <dd>{runtimeUrl ?? "(not started)"}</dd>
        <dt>Mode</dt>
        <dd>{replayMode ? `Replay (${fixtureName ?? "unknown"})` : "Live"}</dd>
        <dt>VS Code tools</dt>
        <dd>{describeVscodeLmTools(vscodeLmTools)}</dd>
        <dt>Tailwind</dt>
        <dd>{describeTailwind(tailwind)}</dd>
        <dt>Mount errors</dt>
        <dd>
          {mountErrors.length === 0
            ? "none"
            : `${mountErrors.length} component(s) failed to mount`}
        </dd>
      </dl>
      {vscodeLmTools.enabled && vscodeLmTools.count === 0 && (
        <p className="playground-diagnostics-hint">
          No VS Code language-model tool providers detected. Install the GitHub
          Copilot Chat extension in this dev host to give the model web search
          and other system capabilities.
        </p>
      )}
      {tailwind?.skipped && (
        <p className="playground-diagnostics-hint">
          Tailwind utility classes won&apos;t be styled because no entry CSS
          (e.g. <code>src/app/globals.css</code> with{" "}
          <code>@import &quot;tailwindcss&quot;</code>) was found. Set{" "}
          <code>copilotkit.playground.tailwindEntryCss</code> if your entry
          lives elsewhere.
        </p>
      )}
      {mountErrors.length > 0 && (
        <ul className="playground-diagnostics-errors">
          {mountErrors.map((e, i) => (
            <li key={i}>
              <strong>{e.componentName}</strong> — {e.error.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describeVscodeLmTools(info: {
  enabled: boolean;
  count: number;
}): string {
  if (!info.enabled) return "off";
  if (info.count === 0) return "0 (no provider)";
  return `${info.count} available`;
}

function describeTailwind(info?: {
  entryCss?: string;
  skipped?: string;
  error?: string;
}): string {
  if (!info) return "(unknown)";
  if (info.error) return `error: ${info.error}`;
  if (info.skipped) return "not detected";
  if (info.entryCss) return shortPath(info.entryCss);
  return "(no output)";
}

function shortPath(p: string): string {
  const matched = p.match(/([^/\\]+[/\\][^/\\]+)$/);
  return matched ? matched[1].replace(/\\/g, "/") : p;
}
