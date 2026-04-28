import * as React from "react";
import type { PlaygroundBundleExports } from "./bundle-loader";
import type {
  ComponentWithHooks,
  PlaygroundScanResult,
} from "../../extension/playground/types";
import type { MountErrorPayload } from "../../extension/playground/bridge-types";

interface Props {
  bundle: PlaygroundBundleExports | null;
  bundleError: string | null;
  scan: PlaygroundScanResult;
  mountErrors: MountErrorPayload[];
  onOpenSource: (filePath: string, line?: number) => void;
}

/**
 * Lists the user components the scanner found and their mount status. The
 * components themselves are mounted exactly once inside ChatPlayground (the
 * chat surface); rendering them again here would duplicate every hook call,
 * which both wastes work and double-reports any mount error.
 */
export function MountedComponentsPanel({
  bundle,
  bundleError,
  scan,
  mountErrors,
  onOpenSource,
}: Props): React.JSX.Element {
  const errorByName = React.useMemo(() => {
    const map = new Map<string, MountErrorPayload>();
    for (const e of mountErrors) {
      if (!map.has(e.componentName)) map.set(e.componentName, e);
    }
    return map;
  }, [mountErrors]);

  return (
    <aside className="playground-mounted">
      <h3>Components</h3>
      {bundleError && (
        <div role="alert" className="playground-bundle-error">
          <strong>Bundle failed</strong>
          <p>{bundleError}</p>
        </div>
      )}
      {!bundle && !bundleError && <p className="muted">Waiting for bundle…</p>}
      {bundle && scan.componentsWithHooks.length === 0 && (
        <p className="muted">No components with CopilotKit hooks found.</p>
      )}
      {bundle && scan.componentsWithHooks.length > 0 && (
        <ul className="playground-mounted-list">
          {scan.componentsWithHooks.map((c) => (
            <ComponentRow
              key={`${c.filePath}:${c.componentName}`}
              component={c}
              error={errorByName.get(c.componentName) ?? null}
              onOpenSource={onOpenSource}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

function ComponentRow({
  component,
  error,
  onOpenSource,
}: {
  component: ComponentWithHooks;
  error: MountErrorPayload | null;
  onOpenSource: (filePath: string, line?: number) => void;
}): React.JSX.Element {
  const status = error ? "error" : "ok";
  return (
    <li className={`playground-mounted-row playground-mounted-row-${status}`}>
      <button
        className="link"
        onClick={() => onOpenSource(component.filePath, component.loc.line)}
        title={component.filePath}
      >
        {component.componentName}
      </button>
      <span className={`status-dot status-dot-${status}`} aria-label={status} />
      {error && (
        <p className="playground-mounted-error">{error.error.message}</p>
      )}
    </li>
  );
}
