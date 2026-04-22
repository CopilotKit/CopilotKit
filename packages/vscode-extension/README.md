# CopilotKit for VS Code

Preview generative-UI components, explore CopilotKit hooks, and inspect AG-UI agent runs — all without leaving your editor.

## Features

The extension adds a **CopilotKit** container to the activity bar with three panels:

### A2UI Catalog Preview

Live-preview A2UI catalog components from your workspace. Pick a component and a fixture, and see it rendered with hot-reload on edits. Fixture files (`*.fixture.*`) are validated in-editor against the component's registered schema, with diagnostics reported inline.

### Hook Explorer (Generative UI)

Scans your workspace for `useCopilotAction`, `useCoAgent`, and related CopilotKit hooks, then renders each hook's generative UI — including in-progress and completed states — so you can iterate on agent UIs without running the full agent loop. Jump-to-source and copy-identity actions are available from the sidebar.

### AG-UI Inspector

Attach to any AG-UI-compliant agent stream (e.g. a local CopilotKit runtime) and inspect the event timeline in real time: tool calls, message deltas, state patches, and lifecycle events — with payload drill-down for each event.

## Requirements

- VS Code `1.85.0` or newer
- A workspace containing CopilotKit components, hooks, or an AG-UI runtime to inspect

## Install

Install from the Visual Studio Marketplace, or search for **"CopilotKit"** from the Extensions view inside VS Code.

## Links

- Website — https://copilotkit.ai
- GitHub — https://github.com/CopilotKit/CopilotKit
- Docs — https://docs.copilotkit.ai

## Feedback

Bugs and feature requests → https://github.com/CopilotKit/CopilotKit/issues
