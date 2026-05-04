import * as React from "react";
import type { PlaygroundBundleExports } from "./bundle-loader";
import type {
  ComponentWithHooks,
  PlaygroundScanResult,
} from "../../extension/playground/types";
import type { MountErrorPayload } from "../../extension/playground/bridge-types";
import { ResizeHandle } from "./ResizeHandle";

interface Props {
  bundle: PlaygroundBundleExports | null;
  bundleError: string | null;
  scan: PlaygroundScanResult;
  mountErrors: MountErrorPayload[];
  /**
   * Whether the panel is collapsed. The panel itself doesn't render
   * the collapse chevron — that lives at the layout root in App.tsx
   * so it stays visible when the panel is fully hidden. We still
   * accept the flag so the resize handle can be hidden in collapsed
   * state (no point dragging an invisible panel).
   */
  collapsed: boolean;
  onOpenSource: (filePath: string, line?: number) => void;
}

/**
 * Lists the user components the scanner found and their mount status. The
 * components themselves are mounted exactly once inside ChatPlayground (the
 * chat surface); rendering them again here would duplicate every hook call,
 * which both wastes work and double-reports any mount error.
 *
 * Each component row is collapsible and (expanded by default) reveals the
 * specific CopilotKit hooks registered inside, e.g.
 *   WeatherComponent
 *     ▸ useFrontendTool · displayCurrentWeather
 *
 * Hooks are clickable: clicking jumps the editor to the exact line of the
 * hook call, which is more useful than "open the file" when a single
 * component registers several hooks.
 */
export function MountedComponentsPanel({
  bundle,
  bundleError,
  scan,
  mountErrors,
  collapsed,
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
      {!collapsed && (
        <ResizeHandle
          cssVar="--playground-mounted-w"
          side="left"
          min={180}
          max={600}
          defaultPx={260}
          storageKey="copilotkit.playground.mounted-width"
        />
      )}
      <div className="playground-mounted-header">
        <h3>Components</h3>
      </div>
      <div className="playground-mounted-scroll">
        {bundleError && (
          <div role="alert" className="playground-bundle-error">
            <strong>Bundle failed</strong>
            <p>{bundleError}</p>
          </div>
        )}
        {!bundle && !bundleError && (
          <p className="muted">Waiting for bundle…</p>
        )}
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
      </div>
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
  // Default-expanded so the hook list is visible without an extra click.
  // The hooks ARE the useful payload for users debugging "which file
  // registered displayCurrentWeather?" — that's the question this panel
  // exists to answer at a glance.
  const [expanded, setExpanded] = React.useState(true);
  const status = error ? "error" : "ok";
  const hookCount = component.hooks.length;

  return (
    <li className={`playground-mounted-row playground-mounted-row-${status}`}>
      <div className="playground-mounted-row-header">
        {hookCount > 0 ? (
          <button
            type="button"
            className="playground-mounted-twisty"
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="playground-mounted-twisty playground-mounted-twisty-spacer" />
        )}
        <button
          className="link playground-mounted-component-name"
          onClick={() => onOpenSource(component.filePath, component.loc.line)}
          title={component.filePath}
        >
          {component.componentName}
        </button>
        <span
          className={`status-dot status-dot-${status}`}
          aria-label={status}
        />
      </div>
      {error && (
        <p className="playground-mounted-error">{error.error.message}</p>
      )}
      {expanded && hookCount > 0 && (
        <ul className="playground-mounted-hooks">
          {component.hooks.map((h, i) => (
            <li
              key={`${h.hook}:${h.name ?? "_"}:${h.loc.line}:${i}`}
              className="playground-mounted-hook"
            >
              <button
                type="button"
                className="link playground-mounted-hook-button"
                onClick={() => onOpenSource(component.filePath, h.loc.line)}
                title={`${component.filePath}:${h.loc.line}`}
              >
                <span className="playground-mounted-hook-name">{h.hook}</span>
                {h.name ? (
                  <>
                    <span className="playground-mounted-hook-sep"> · </span>
                    <span className="playground-mounted-hook-tool">
                      {h.name}
                    </span>
                  </>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
