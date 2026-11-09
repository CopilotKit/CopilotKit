/**
 * ComparisonTable - Protocol comparison table
 *
 * Shows side-by-side comparison of the three generative UI protocols:
 * Static GenUI, MCP Apps, and A2UI.
 *
 * Responsive layout:
 * - Mobile: Stacked cards (hidden on md:)
 * - Desktop: Table layout (hidden below md:)
 */

const protocols = [
  {
    name: "Static GenUI",
    features: "React components via useRenderToolCall",
    bestFor: "Type-safe, customizable UI patterns",
    example: "Weather cards, stock tickers, approval flows",
  },
  {
    name: "MCP Apps",
    features: "HTML apps in sandboxed iframes",
    bestFor: "Rich interactive apps, isolation",
    example: "Flight booking, trading simulator",
  },
  {
    name: "A2UI",
    features: "Declarative JSON → Lit components",
    bestFor: "Agent-composed UI, cross-framework",
    example: "Restaurant finder, dynamic forms",
  },
  {
    name: "Open Generative UI",
    features: "Agent-generated HTML/CSS/JS in sandboxed iframes",
    bestFor: "Freeform UI, CDN libraries, live streaming",
    example: "Charts, dashboards, spreadsheets, 3D scenes",
  },
];

export function ComparisonTable() {
  return (
    <>
      {/* Mobile: Stacked cards */}
      <div className="md:hidden space-y-4">
        {protocols.map((protocol) => (
          <div key={protocol.name} className="glass-card p-4">
            <h3 className="font-bold text-lg mb-2 text-gradient">
              {protocol.name}
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium text-[--color-text-tertiary]">
                  Features
                </dt>
                <dd className="text-[--color-text-secondary]">
                  {protocol.features}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[--color-text-tertiary]">
                  Best For
                </dt>
                <dd className="text-[--color-text-secondary]">
                  {protocol.bestFor}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[--color-text-tertiary]">
                  Example
                </dt>
                <dd className="text-[--color-text-secondary]">
                  {protocol.example}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop: Table - refactor existing table to use protocols array */}
      <div className="hidden md:block">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Protocol</th>
              <th>Features</th>
              <th>Best For</th>
              <th>Example Use</th>
            </tr>
          </thead>
          <tbody>
            {protocols.map((protocol) => (
              <tr key={protocol.name}>
                <td className="font-medium text-gradient">{protocol.name}</td>
                <td>{protocol.features}</td>
                <td>{protocol.bestFor}</td>
                <td>{protocol.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
