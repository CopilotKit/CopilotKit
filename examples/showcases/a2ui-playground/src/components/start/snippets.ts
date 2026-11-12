/**
 * The code in the Get started prompt. The snippets type-check against the
 * installed @copilotkit/* 1.85.0 typings.
 */

/** The packages to install, for any package manager's add command. */
export const PACKAGES =
  "@copilotkit/react-core@1.85.0 @copilotkit/runtime@1.85.0 zod@3.25.76";

export const CATALOG = `"use client";
import { createGenerativeUI, standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { z } from "zod";

const weatherProps = z.object({
  city: z.string(),
  tempC: z.number(),
  summary: z.string().optional(),
});

function WeatherCard({ city, tempC, summary }: z.infer<typeof weatherProps>) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm opacity-70">{city}</p>
      <p className="text-3xl font-semibold">{tempC}°C</p>
      {summary ? <p className="text-sm">{summary}</p> : null}
    </div>
  );
}

export const ui = createGenerativeUI({
  id: "acme/app@1",
  extends: [standardUI], // the 69 standard components: Column, Card, Text, Button...
  components: {
    WeatherCard: {
      component: WeatherCard,
      description: "Current weather for one city.",
      props: weatherProps,
    },
  },
});`;

export const PROVIDER = `"use client";
import "@copilotkit/react-core/v2/styles.css";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ui } from "./genui";

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui }}>
      <CopilotChat />
    </CopilotKitProvider>
  );
}`;

/** The provider with CopilotKit's standard catalog as it ships: no catalog file of your own. */
export const PROVIDER_STANDARD = `"use client";
import "@copilotkit/react-core/v2/styles.css";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";

export default function Page() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      generativeUI={{ ui: standardUI }}
    >
      <CopilotChat />
    </CopilotKitProvider>
  );
}`;

/** app/genui.tsx for shadcn/ui: the standard catalog with its Button, Badge and Divider drawn by shadcn. */
export const GENUI_SHADCN = `"use client";
import {
  createGenerativeUI,
  standardUI,
  useGenerativeUIAccessibility,
} from "@copilotkit/react-core/v2/generative-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Each wrapper takes the props of the standard component it replaces.
type Props = Record<string, any>;

function ShadcnButton(p: Props) {
  const a11y = useGenerativeUIAccessibility();
  const solid = p.variant === "primary" || p.variant === "solid";
  return (
    <Button
      {...a11y}
      type={p.submit ? "submit" : "button"}
      disabled={Boolean(p.disabled || p.loading)}
      variant={solid ? "default" : "outline"}
      onClick={() => {
        // A link opens; anything else is the click the agent hears about.
        if (/^https?:/.test(p.href ?? "")) window.open(p.href, "_blank");
        else if (!p.submit) p.onClick?.({});
      }}
    >
      {p.children ?? p.child ?? p.label}
    </Button>
  );
}

function ShadcnBadge(p: Props) {
  const a11y = useGenerativeUIAccessibility();
  return (
    <Badge {...a11y} variant={p.variant === "outline" ? "outline" : "secondary"}>
      {p.label}
    </Badge>
  );
}

export const ui = createGenerativeUI({
  id: "my-app/genui@1",
  extends: [standardUI],
  overrides: {
    Button: { component: ShadcnButton },
    Badge: { component: ShadcnBadge },
    Divider: { component: () => <Separator /> },
  },
  components: {},
});`;

/** app/genui.tsx for Material 3: the standard catalog with its Button and Divider drawn by Material 3 Expressive. */
export const GENUI_MATERIAL = `"use client";
import "@language-lit/material3-expressive/styles.css";
import {
  createGenerativeUI,
  standardUI,
  useGenerativeUIAccessibility,
} from "@copilotkit/react-core/v2/generative-ui";
import { Button, Divider } from "@language-lit/material3-expressive";

// Each wrapper takes the props of the standard component it replaces.
type Props = Record<string, any>;

function MaterialButton(p: Props) {
  const a11y = useGenerativeUIAccessibility();
  const solid = p.variant === "primary" || p.variant === "solid";
  return (
    <Button
      {...a11y}
      type={p.submit ? "submit" : "button"}
      disabled={Boolean(p.disabled || p.loading)}
      variant={solid ? "filled" : "outlined"}
      onClick={() => {
        // A link opens; anything else is the click the agent hears about.
        if (/^https?:/.test(p.href ?? "")) window.open(p.href, "_blank");
        else if (!p.submit) p.onClick?.({});
      }}
    >
      {p.children ?? p.child ?? p.label}
    </Button>
  );
}

export const ui = createGenerativeUI({
  id: "my-app/genui@1",
  extends: [standardUI],
  overrides: {
    Button: { component: MaterialButton },
    Divider: { component: () => <Divider /> },
  },
  components: {},
});`;

export const ROUTE = `import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const copilotRuntime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: "google/gemini-3.8-flash" }) },
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});
export const GET = handler;
export const POST = handler;`;
