import * as React from "react";
import type { MountErrorPayload } from "../../extension/playground/bridge-types";

interface Props {
  mountErrors: MountErrorPayload[];
  runtimeUrl: string | null;
  replayMode: boolean;
  fixtureName: string | null;
}

export function DiagnosticsPanel({
  mountErrors,
  runtimeUrl,
  replayMode,
  fixtureName,
}: Props): React.JSX.Element {
  return (
    <section className="playground-diagnostics">
      <h3>Diagnostics</h3>
      <dl>
        <dt>Runtime</dt>
        <dd>{runtimeUrl ?? "(not started)"}</dd>
        <dt>Mode</dt>
        <dd>{replayMode ? `Replay (${fixtureName ?? "unknown"})` : "Live"}</dd>
        <dt>Mount errors</dt>
        <dd>
          {mountErrors.length === 0
            ? "none"
            : `${mountErrors.length} component(s) failed to mount`}
        </dd>
      </dl>
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
