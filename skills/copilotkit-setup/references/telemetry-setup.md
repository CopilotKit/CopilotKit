# CopilotCloud Telemetry Setup

## What is CopilotCloud?

CopilotCloud is CopilotKit's hosted platform that provides:

- **Usage analytics** -- see how users interact with your AI features (message volume, tool usage, session duration)
- **Error monitoring** -- surface runtime errors and failed agent interactions
- **Premium features** -- access to hosted runtimes, advanced agent orchestration, and priority support (requires a paid plan)

The license key is a lightweight identifier that connects your local CopilotKit instance to CopilotCloud. It does not gate any open-source functionality -- CopilotKit works fully without it.

## The `npx copilotkit auth` flow

Running the CLI command starts an interactive authentication (verify the exact command with `npx copilotkit --help` as it may vary by version):

```bash
npx copilotkit auth
```

1. The CLI opens your default browser to the CopilotCloud login/signup page.
2. Sign in with GitHub, Google, or email.
3. Select or create a project in the CopilotCloud dashboard.
4. The CLI receives the license key and prints it to stdout:
   ```
   Successfully authenticated!
   Your license key: ck_abc123...
   ```

If the browser does not open automatically, the CLI prints a URL you can copy-paste manually.

## Where to put the license key

### Option A: Inline in CopilotKitProvider

Pass the key directly as a prop:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  licenseKey="ck_abc123..."
>
  {children}
</CopilotKitProvider>
```

This is the simplest approach for quick prototyping but exposes the key in source code.

### Option B: Environment variable (recommended)

Add the key to your environment file:

**Next.js** (`.env.local`):
```
NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=ck_abc123...
```

**Vite** (`.env`):
```
VITE_COPILOTKIT_LICENSE_KEY=ck_abc123...
```

Then reference it in the provider:

```tsx
// Next.js
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  licenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
>

// Vite
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  licenseKey={import.meta.env.VITE_COPILOTKIT_LICENSE_KEY}
>
```

The `NEXT_PUBLIC_` or `VITE_` prefix is required because the license key is used on the client side. It is safe to expose -- the key is a project identifier, not a secret.

## Opting out

To disconnect from CopilotCloud, simply remove the `licenseKey` prop from `CopilotKitProvider` (and delete the environment variable if you set one). No other changes are needed -- CopilotKit will continue to function normally without it.
