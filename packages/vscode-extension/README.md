# CopilotKit -- VS Code Extension

Live preview for A2UI catalog components inside VS Code. Edit your component files, save, and see the rendered result update instantly in a side panel.

## Installation

**From VS Code Marketplace:**

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "CopilotKit"
4. Click Install

**Manual install:**

1. Download the `.vsix` file from GitHub Releases
2. In VS Code, run `Extensions: Install from VSIX...` from the command palette

## Quick Start

1. Open a project that uses `@copilotkit/a2ui-renderer`
2. Click the **CopilotKit icon** in the Activity Bar (left sidebar)
3. The **Component Preview** panel lists all discovered catalog components
4. Click a component to open the live preview

Alternatively:

- Open any `.ts`/`.tsx` catalog file and run **CopilotKit: Preview Component** from the command palette (Ctrl+Shift+P)
- Right-click a `.ts`/`.tsx` file in the Explorer and select **CopilotKit: Preview Component**

## Sidebar

The CopilotKit sidebar automatically discovers all A2UI catalog components in your workspace -- any `.ts`/`.tsx` file that imports from `@copilotkit/a2ui-renderer` and exports a catalog.

The tree view shows:

- **Components** -- click to preview
- **Fixtures** (nested under components) -- click to preview with specific test data
- Components without fixtures show "(auto-generated)"

Use the **Refresh** button in the panel title bar to re-scan after adding new components.

## Fixture Files

Fixtures provide test data for your component previews. Create a fixture file next to your component:

**JSON format** -- `MyComponent.fixture.json`:

```json
{
  "default": {
    "surfaceId": "preview",
    "messages": [
      { "beginRendering": { "surfaceId": "preview", "root": "root" } },
      { "surfaceUpdate": { "surfaceId": "preview", "components": [] } }
    ]
  },
  "empty state": {
    "surfaceId": "preview",
    "messages": []
  }
}
```

**TypeScript format** -- `MyComponent.fixture.ts`:

```ts
export default {
  default: { surfaceId: "preview", messages: [] },
  loading: { surfaceId: "preview", messages: [] },
};
```

Each key is a named fixture. Use the dropdown in the preview panel to switch between them.

## Commands

| Command                       | Trigger                  | Description                      |
| ----------------------------- | ------------------------ | -------------------------------- |
| CopilotKit: Preview Component | Command palette          | Preview the active editor file   |
| CopilotKit: Preview Component | Right-click in Explorer  | Preview the selected file        |
| Preview Component             | Click in sidebar         | Preview the selected component   |
| Refresh                       | Sidebar title bar button | Re-scan workspace for components |

## Requirements

- VS Code 1.85.0 or later
- A project using `@copilotkit/a2ui-renderer`

## Development

```bash
# Build the extension
nx run @copilotkit/vscode-extension:build

# Watch mode
nx run @copilotkit/vscode-extension:dev

# Run tests
nx run @copilotkit/vscode-extension:test

# Package as .vsix
cd packages/vscode-extension && npx vsce package --no-dependencies
```

**Testing in Extension Development Host:**

1. Open `packages/vscode-extension` in VS Code
2. Press `F5` to launch Extension Development Host
3. The extension activates in the new window

## CI/CD

The extension is automatically built, tested, and published on push to `main` via `.github/workflows/vscode-extension.yml`.

**Setup for publishing:**

1. Create a [VS Code Marketplace publisher](https://marketplace.visualstudio.com/manage) for "copilotkit"
2. Generate a Personal Access Token (PAT) with "Marketplace (Manage)" scope from Azure DevOps
3. Add `VSCE_PAT` as a GitHub Actions secret in the repository settings
