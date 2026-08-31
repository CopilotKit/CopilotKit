# CopilotKit Intelligence Telemetry Setup

## What is CopilotKit Intelligence?

CopilotKit Intelligence is CopilotKit's hosted platform that provides:

- **Usage analytics** -- see how users interact with your AI features (message volume, tool usage, session duration)
- **Error monitoring** -- surface runtime errors and failed agent interactions
- **Premium features** -- access to hosted runtimes, advanced agent orchestration, and priority support (requires a paid plan)

The license key is a lightweight identifier that connects your local CopilotKit instance to CopilotKit Intelligence. It does not gate any open-source functionality -- CopilotKit works fully without it.

## The `npx copilotkit login` flow

Running the CLI command starts an interactive authentication (verify the available commands with `npx copilotkit --help` if a version differs):

```bash
npx copilotkit login
npx copilotkit project select
```

1. `login` opens your default browser to the CopilotKit Intelligence login/signup page.
2. Sign in with GitHub, Google, or email.
3. `project select` picks or creates a hosted project and records it in `.copilotkit/project.json`.
4. The CLI provisions a project API key for the runtime and reports the license key for the client.

If the browser does not open automatically, the CLI prints a URL you can copy-paste manually.

There is no `copilotkit auth` command. The command is `login`.

## Where to put the license key

Store the key in an environment variable. Add it to your environment file:

**Next.js** (`.env.local`):

```
NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=<your-license-key>
```

**Vite** (`.env`):

```
VITE_COPILOTKIT_LICENSE_KEY=<your-license-key>
```

Then reference it in the provider:

```tsx
// Next.js
<CopilotKit
  runtimeUrl="/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
>

// Vite
<CopilotKit
  runtimeUrl="/api/copilotkit"
  publicLicenseKey={import.meta.env.VITE_COPILOTKIT_LICENSE_KEY}
>
```

The `NEXT_PUBLIC_` or `VITE_` prefix is required because the license key is used on the client side. It is safe to expose -- the key is a project identifier, not a secret.

## Opting out

To disconnect from CopilotKit Intelligence, simply remove the `publicLicenseKey` prop from the `CopilotKit` provider (and delete the environment variable if you set one). No other changes are needed -- CopilotKit will continue to function normally without it.
