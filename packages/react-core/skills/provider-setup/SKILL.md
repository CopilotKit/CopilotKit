---
name: provider-setup
description: >
  Mount CopilotKitProvider in a React app — runtimeUrl, headers, credentials,
  properties, publicLicenseKey, onError, debug, showDevConsole. Load when
  setting up CopilotKit for the first time, fixing provisional-agent or
  "connecting forever" issues, adding the "use client" boundary for Next.js
  App Router, rotating auth headers, or wiring a global onError handler.
  publicLicenseKey is canonical; publicApiKey is a deprecated alias.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires: []
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/index.ts"
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
---

# CopilotKit Provider Setup (React)

Mount `CopilotKitProvider` once near the root of the React tree. Every
CopilotKit hook (`useAgent`, `useFrontendTool`, `useRenderTool`, etc.) and
every chat component (`CopilotChat`, `CopilotPopup`, `CopilotSidebar`) must
be rendered inside this provider.

All v2 imports use the `@copilotkit/react-core/v2` subpath. Imports from the
package root are v1 and will not work with v2 hooks or components.

## Setup

### Next.js App Router (and any RSC-based framework)

`@copilotkit/react-core/v2` is marked `"use client"`. You must mount the
provider from a client component, not a server component. The cleanest
pattern is a dedicated client-only `providers.tsx`.

```tsx
// app/providers.tsx
"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { useMemo } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${getToken()}` }),
    [],
  );

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      headers={headers}
      credentials="include"
      onError={({ code, error, context }) => {
        console.error("[copilotkit]", code, error, context);
      }}
    >
      {children}
    </CopilotKitProvider>
  );
}
```

```tsx
// app/layout.tsx — server component
import { Providers } from "./providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### Vite / React Router v7 / SPA

```tsx
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function App({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}
```

### SPA with CopilotKit Cloud (no self-hosted runtime)

```tsx
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
```

`publicLicenseKey` is the only production-safe way to run CopilotKit from a
pure client bundle. `publicApiKey` is a deprecated alias — accept in old
code, but always write `publicLicenseKey` in new code.

## Core Patterns

### Stable headers for rotating auth tokens

For tokens that change during the session, use the imperative setter instead
of re-rendering the provider with a new `headers` prop.

```tsx
"use client";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect } from "react";

export function AuthTokenSync({ token }: { token: string }) {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    copilotkit.setHeaders({ Authorization: `Bearer ${token}` });
  }, [copilotkit, token]);
  return null;
}
```

### Global error handler

`onError` fires for every `CopilotKitCoreErrorCode` emitted by core. Keeps
UI from getting stuck in "connecting..." when the runtime URL is wrong or
CORS is misconfigured.

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  onError={({ code, error, context }) => {
    telemetry.capture({ code, message: error.message, context });
  }}
/>
```

### Sharing app properties with every run

`properties` flows to the runtime on each agent run — useful for tenant IDs,
feature flags, or anything the server needs.

```tsx
const properties = useMemo(
  () => ({ tenantId: user.tenantId, locale: user.locale }),
  [user.tenantId, user.locale],
);

<CopilotKitProvider runtimeUrl="/api/copilotkit" properties={properties} />;
```

## Common Mistakes

### CRITICAL — Mounting the provider from a Server Component

Wrong:

```tsx
// app/page.tsx (server component — no "use client")
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">...</CopilotKitProvider>
  );
}
```

Correct:

```tsx
// app/providers.tsx
"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}

// app/layout.tsx imports <Providers>.
```

`@copilotkit/react-core/v2` begins with `"use client"`. Importing it from a
server component silently strips interactivity — the provider renders but
none of the hooks wire up.

Source: `packages/react-core/src/v2/index.ts:1`

### CRITICAL — Using `agents__unsafe_dev_only` or `selfManagedAgents` in production

Wrong:

```tsx
<CopilotKitProvider
  agents__unsafe_dev_only={{
    default: new BuiltInAgent({ apiKey: process.env.OPENAI_KEY! }),
  }}
/>
// or the alias (same thing):
<CopilotKitProvider
  selfManagedAgents={{ default: new BuiltInAgent({ apiKey: "..." }) }}
/>
```

Correct:

```tsx
// Route through a runtime that keeps secrets server-side:
<CopilotKitProvider runtimeUrl="/api/copilotkit" />

// Or for a pure SPA, use CopilotKit Cloud:
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
```

Both props are aliases for the same dev-only mechanism and ship any embedded
credentials to the browser bundle. Never use either for production agents.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx:136-138,393`

### HIGH — Inline object props rebuilt every render

Wrong:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  headers={{ Authorization: `Bearer ${token}` }}
  properties={{ tenantId: user.tenantId }}
/>
```

Correct:

```tsx
const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
const properties = useMemo(
  () => ({ tenantId: user.tenantId }),
  [user.tenantId],
);

<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  headers={headers}
  properties={properties}
/>;
```

New object identity on every render causes the provider to diff-churn
internal state and may thrash tool/renderer registration. `useStableArrayProp`
also logs a `console.error` when array-prop shape changes without
memoization.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx:324-340,399-410`

### HIGH — Missing `onError` leaves users stuck in "connecting..."

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
```

Correct:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  onError={({ code, error, context }) => {
    telemetry.capture({ code, error, context });
  }}
/>
```

Without `onError`, connection failures (bad runtime URL, CORS, network) keep
the provider in a provisional state with `ProxiedCopilotRuntimeAgent`
instances that never resolve. The chat UI keeps showing "connecting..."
forever and users never see the actual error.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx:638-660`

### HIGH — Writing `publicApiKey` in new code

Wrong:

```tsx
<CopilotKitProvider publicApiKey="ck_pub_..." />
```

Correct:

```tsx
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
```

`publicApiKey` still works as a deprecated alias, but `publicLicenseKey` is
the canonical name in v2. Always write the canonical form in new code.

Source: `packages/core/src/core/core.ts` (license resolution)

### MEDIUM — Putting the provider below a layout that uses CopilotKit

Wrong:

```tsx
<html>
  <body>
    <Header>{/* Header uses useFrontendTool internally */}</Header>
    <CopilotKitProvider>{children}</CopilotKitProvider>
  </body>
</html>
```

Correct:

```tsx
<html>
  <body>
    <CopilotKitProvider>
      <Header />
      {children}
    </CopilotKitProvider>
  </body>
</html>
```

Any component that calls `useCopilotKit`, `useFrontendTool`, `useAgent`, or
any other CopilotKit hook must be a descendant of `CopilotKitProvider`.
Placing the provider beside or below a consumer throws at mount.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx` (context)
