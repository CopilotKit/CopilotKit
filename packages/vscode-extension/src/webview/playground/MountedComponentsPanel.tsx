import * as React from "react";
import type { PlaygroundBundleExports } from "./bundle-loader";

interface Props {
  bundle: PlaygroundBundleExports | null;
  bundleError: string | null;
}

export function MountedComponentsPanel({
  bundle,
  bundleError,
}: Props): React.JSX.Element {
  return (
    <aside className="playground-mounted">
      <h3>Mounted Components</h3>
      {bundleError && (
        <div role="alert" className="playground-bundle-error">
          <strong>Bundle failed:</strong> {bundleError}
        </div>
      )}
      {!bundle && !bundleError && (
        <p className="playground-waiting">Waiting for bundle…</p>
      )}
      {bundle && <bundle.PlaygroundEntry />}
    </aside>
  );
}
