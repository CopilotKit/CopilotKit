![CopilotKit Banner](./assets/banner.png)

# CopilotKit

Add a powerful & customizable copilot to any app, in an afternoon.

## Installation

```bash
pnpm install @copilotkit/react-core @copilotkit/react-ui
```

## Example

You can Bring Your Own UI, but it's easy to get started with one of the built-in UIs:

```typescript
import { Copilot } from "copilotkit";

// Create a new AI-powered copilot instance
const myCopilot = new Copilot();

// Use your copilot in your application
myCopilot.interact("Hello World");
```

> Note: Please refer to our [API Documentation](link-to-your-api-documentation) for more detailed information.

## Key entrypoints:

- `useMakeCopilotReadable`: give static information to the copilot, in sync with on-screen state
- `useMakeCopilotActionable`: allow the copilot to control the state of the application

## Demo

The following GIF showcases CopilotKit in action.

![Demo Gif](path-to-your-demo-gif)

## Contribute

Your contributions are always welcome! Please have a look at the [contribution guidelines](link-to-your-contribution-guidelines) first. 🎉
