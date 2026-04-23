import * as React from "react";
import type { PlaygroundScanResult } from "../../extension/playground/types";

interface Props {
  result: PlaygroundScanResult;
  onRefresh: () => void;
  onOpenSource: (filePath: string, line?: number) => void;
}

export function ScannerView({
  result,
  onRefresh,
  onOpenSource,
}: Props): React.JSX.Element {
  const hasProvider = result.providers.length > 0;
  const primary = result.providers[0];

  return (
    <div className="playground-root">
      <header className="playground-header">
        <h2>CopilotKit Playground</h2>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </header>

      {result.warnings.length > 0 && (
        <ul className="playground-warnings">
          {result.warnings.map((w, i) => (
            <li key={i} className={`warning warning--${w.kind}`}>
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {!hasProvider ? (
        <p className="playground-empty">
          No &lt;CopilotKit&gt; provider found in this workspace. Add one to try
          the chat playground.
        </p>
      ) : (
        <section className="playground-provider">
          <h3>Provider</h3>
          <button
            type="button"
            className="link"
            onClick={() => onOpenSource(primary.filePath, primary.loc.line)}
          >
            {shortPath(primary.filePath)}:{primary.loc.line}
          </button>
          <dl>
            {Object.entries(primary.props).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{formatPropValue(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      )}

      {result.ancestorChain && result.ancestorChain.length > 0 && (
        <section className="playground-providers-chain">
          <h3>Provider chain</h3>
          <ol>
            {result.ancestorChain.map((p, i) => (
              <li key={`${p.filePath}:${p.loc.column}-${i}`}>{p.tagName}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="playground-components">
        <h3>Components with hooks ({result.componentsWithHooks.length})</h3>
        <ul>
          {result.componentsWithHooks.map((c) => (
            <li key={`${c.filePath}:${c.loc.line}`}>
              <button
                type="button"
                className="link"
                onClick={() => onOpenSource(c.filePath, c.loc.line)}
              >
                {c.componentName}
              </button>
              <span className="muted"> — {shortPath(c.filePath)}</span>
              <ul className="hooks">
                {c.hooks.map((h, i) => (
                  <li key={i}>
                    <code>{h.hook}</code>
                    {h.name ? (
                      <>
                        {" "}
                        <em>{h.name}</em>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.slice(-3).join("/");
}

function formatPropValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "object" && v !== null && "__unserializable" in v) {
    const u = v as unknown as { reason: string; source: string };
    return `<${u.reason}: ${u.source}>`;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
