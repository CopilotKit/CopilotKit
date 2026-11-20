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

/** The standard Button's behaviour, shared by the Button overrides below. */
const STANDARD_BUTTON = `// Everything the standard Button does besides drawing, so a replacement behaves the same.
function useStandardButton(p: Props) {
  const label = p.children ?? p.child ?? p.label ?? p.text;
  // A failed check of severity "error" holds the Button back, as the standard one does.
  const blocked = (p.checks ?? []).some(({ condition: c }: Props) =>
    c === false ||
    (c && typeof c === "object" && !c.valid && (c.severity ?? "error") === "error"),
  );
  return {
    label,
    // An icon-only Button still needs a name.
    name: !label && p.icon ? String(p.icon) : undefined,
    disabled: Boolean(p.disabled || p.loading || blocked),
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      // In order: a Form submits; a link opens; a copy copies; anything else reaches the agent.
      if (p.submit && e.currentTarget.form) return;
      const href = String(p.href ?? "").trim();
      if (href) {
        if (/^(https?:|mailto:)/i.test(href))
          window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      if (p.copy) return void navigator.clipboard?.writeText(String(p.copy));
      p.onClick?.({});
    },
  };
}`;

/** app/genui.tsx for shadcn/ui: the standard catalog with its Button, Badge and Divider drawn by shadcn. */
export const GENUI_SHADCN = `"use client";
import type { MouseEvent } from "react";
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

${STANDARD_BUTTON}

function ShadcnButton(p: Props) {
  const a11y = useGenerativeUIAccessibility();
  const b = useStandardButton(p);
  const solid = p.variant === "primary" || p.variant === "solid";
  return (
    <Button
      {...a11y}
      aria-label={a11y["aria-label"] ?? b.name}
      type={p.submit ? "submit" : "button"}
      disabled={b.disabled}
      variant={solid ? "default" : "outline"}
      onClick={b.onClick}
    >
      {b.label}
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
import type { MouseEvent } from "react";
import "@language-lit/material3-expressive/styles.css";
import {
  createGenerativeUI,
  standardUI,
  useGenerativeUIAccessibility,
} from "@copilotkit/react-core/v2/generative-ui";
import { Button, Divider } from "@language-lit/material3-expressive";

// Each wrapper takes the props of the standard component it replaces.
type Props = Record<string, any>;

${STANDARD_BUTTON}

function MaterialButton(p: Props) {
  const a11y = useGenerativeUIAccessibility();
  const b = useStandardButton(p);
  const solid = p.variant === "primary" || p.variant === "solid";
  return (
    <Button
      {...a11y}
      aria-label={a11y["aria-label"] ?? b.name}
      type={p.submit ? "submit" : "button"}
      disabled={b.disabled}
      variant={solid ? "filled" : "outlined"}
      onClick={b.onClick}
    >
      {b.label}
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
