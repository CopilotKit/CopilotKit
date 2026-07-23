# CopilotKit Provider Setup (React)

Mount the `CopilotKit` provider (from `@copilotkit/react-core/v2`) once
near the root of the React tree. Every CopilotKit hook (`useAgent`,
`useFrontendTool`, `useRenderTool`, etc.) and every chat component
(`CopilotChat`, `CopilotPopup`, `CopilotSidebar`) must be rendered inside
this provider.

> **Which provider component?** Always use `CopilotKit` imported from `@copilotkit/react-core/v2`. It is the compatibility bridge across v1 and v2 and a strict superset of the other provider APIs. Do **not** use `CopilotKit` from the package root (`@copilotkit/react-core`, legacy v1) or `CopilotKitProvider` from `/v2` (a subset of the functionality).

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

import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      credentials="include"
      onError={({ code, error, context }) => {
        console.error("[copilotkit]", code, error, context);
      }}
    >
      {children}
    </CopilotKit>
  );
}
```

For auth headers that change over the session (rotating bearer tokens,
refreshed cookies), see the "Stable headers for rotating auth tokens"
pattern below. Avoid putting a `useMemo(() => ({ Authorization: ... }),
[])` on the provider — an empty deps array captures the token at mount
and never refreshes.

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
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function App({ children }: { children: React.ReactNode }) {
  return <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>;
}
```

### SPA with CopilotKit Intelligence (no self-hosted runtime)

```tsx
<CopilotKit publicLicenseKey="ck_pub_..." />
```

`publicLicenseKey` is the canonical prop for running CopilotKit from a
pure client bundle. `publicApiKey` is a deprecated alias that resolves to
the same value — accept it in old code, but always write
`publicLicenseKey` in new code.

## Core Patterns

### Stable headers for rotating auth tokens

For tokens that change during the session, use the imperative setter instead
of re-rendering the provider with a new `headers` prop.

```tsx
"use client";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect } from "react";

export function AuthTokenSync({ token }: { token: string | null }) {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    // setHeaders is an overwrite, not a merge — spread the current headers so
    // entries set elsewhere (e.g. the public license key) survive. A `null`
    // value clears that header, so logging out removes `Authorization` instead
    // of sending an empty one.
    copilotkit.setHeaders({
      ...copilotkit.headers,
      Authorization: token ? `Bearer ${token}` : null,
    });
  }, [copilotkit, token]);
  return null;
}
```

`setHeaders` accepts `null`/`undefined` values and drops those keys, so passing
`Authorization: null` is the supported way to clear a header. Setting it to an
empty string would keep the header present with a blank value.

Do not set the same header through both the `headers` prop and imperative
`setHeaders`. Whenever any provider prop changes, the provider calls
`setHeaders` with its prop-derived headers — a full overwrite that drops every
imperatively-set header, not just keys the prop also defines. Keep rotating
values like the auth token out of the `headers` prop and manage them only
through `setHeaders` (as above).

### Global error handler

`onError` fires for every `CopilotKitCoreErrorCode` emitted by core. Keeps
UI from getting stuck in "connecting..." when the runtime URL is wrong or
CORS is misconfigured.

```tsx
<CopilotKit
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

<CopilotKit runtimeUrl="/api/copilotkit" properties={properties} />;
```

## Common Mistakes

### CRITICAL — Mounting the provider from a Server Component

Wrong:

```tsx
// app/page.tsx (server component — no "use client")
import { CopilotKit } from "@copilotkit/react-core/v2";

export default function Page() {
  return <CopilotKit runtimeUrl="/api/copilotkit">...</CopilotKit>;
}
```

Correct:

```tsx
// app/providers.tsx
"use client";
import { CopilotKit } from "@copilotkit/react-core/v2";

export function Providers({ children }: { children: React.ReactNode }) {
  return <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>;
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
<CopilotKit
  agents__unsafe_dev_only={{
    default: new BuiltInAgent({ apiKey: process.env.OPENAI_KEY! }),
  }}
/>
// or the alias (same thing):
<CopilotKit
  selfManagedAgents={{ default: new BuiltInAgent({ apiKey: "..." }) }}
/>
```

Correct:

```tsx
// Route through a runtime that keeps secrets server-side:
<CopilotKit runtimeUrl="/api/copilotkit" />

// Or for a pure SPA, use CopilotKit Intelligence:
<CopilotKit publicLicenseKey="ck_pub_..." />
```

Both props are aliases for the same dev-only mechanism and ship any embedded
credentials to the browser bundle. Never use either for production agents.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx:136-138,393`

### HIGH — Inline object props rebuilt every render

Wrong:

```tsx
<CopilotKit
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

<CopilotKit
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
<CopilotKit runtimeUrl="/api/copilotkit" />
```

Correct:

```tsx
<CopilotKit
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
<CopilotKit publicApiKey="ck_pub_..." />
```

Correct:

```tsx
<CopilotKit publicLicenseKey="ck_pub_..." />
```

`publicApiKey` still works as a deprecated alias, but `publicLicenseKey`
is the canonical name. The `CopilotKit` provider resolves
`publicLicenseKey || publicApiKey`. Always write the canonical form in
new code.

Source: `packages/react-core/src/components/copilot-provider/copilotkit.tsx:172`

### MEDIUM — Putting the provider below a layout that uses CopilotKit

Wrong:

```tsx
<html>
  <body>
    <Header>{/* Header uses useFrontendTool internally */}</Header>
    <CopilotKit>{children}</CopilotKit>
  </body>
</html>
```

Correct:

```tsx
<html>
  <body>
    <CopilotKit>
      <Header />
      {children}
    </CopilotKit>
  </body>
</html>
```

Any component that calls `useCopilotKit`, `useFrontendTool`, `useAgent`, or
any other CopilotKit hook must be a descendant of the `CopilotKit`
provider. Placing the provider beside or below a consumer throws at mount.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx` (context)
