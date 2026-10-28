// Import shim for the legacy v1 styling guide. shell-docs rendered nothing
// for these (its import was stripped and no component was registered); the
// variable reference lives in prose on /custom-look-and-feel/css. Here the
// CSS reference renders that table; the interactive inspector has no port.
const VARIABLES: [string, string][] = [
  ["--copilot-kit-primary-color", "Main brand/action color for buttons and interactive elements"],
  ["--copilot-kit-contrast-color", "Color that contrasts with primary, used for text on primary elements"],
  ["--copilot-kit-background-color", "Main page/container background color"],
  ["--copilot-kit-secondary-color", "Secondary background for cards, panels, and elevated surfaces"],
  ["--copilot-kit-secondary-contrast-color", "Primary text color for main content"],
  ["--copilot-kit-separator-color", "Border color for dividers and containers"],
  ["--copilot-kit-muted-color", "Muted color for disabled/inactive states"],
  ["--copilot-kit-shadow-sm / -md / -lg", "Elevation shadows for subtle surfaces, cards, and modals"],
];

export function CopilotKitCSS() {
  return (
    <table>
      <thead>
        <tr>
          <th>CSS variable</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {VARIABLES.map(([name, description]) => (
          <tr key={name}>
            <td>
              <code>{name}</code>
            </td>
            <td>{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InteractiveCSSInspector() {
  return null;
}
