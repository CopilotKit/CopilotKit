"use client";

import { useState } from "react";
import { useDesignSystem } from "@/design-systems/context";
import { CodeBlock, CommandLine } from "./code-block";
import { GENUI_NOTE, GENUI_SNIPPET, providerSnippet } from "./prompt";
import { PACKAGES, ROUTE } from "./snippets";
import { Steps } from "./steps";
import { Tabs } from "./tabs";

type PM = "npm" | "pnpm" | "yarn" | "bun";

const PMS: Array<{ id: PM; add: string; dev: string }> = [
  { id: "npm", add: "npm install", dev: "npm run dev" },
  { id: "pnpm", add: "pnpm add", dev: "pnpm dev" },
  { id: "yarn", add: "yarn add", dev: "yarn dev" },
  { id: "bun", add: "bun add", dev: "bun dev" },
];

/** The prompt's steps by hand, in a Next.js App Router app. */
export function ManualSetup() {
  const { id } = useDesignSystem();
  const [pm, setPm] = useState<PM>("npm");
  const p = PMS.find((x) => x.id === pm) ?? PMS[0];
  const genui = GENUI_SNIPPET[id];
  const pmTabs = (
    <Tabs
      options={PMS.map((x) => ({ id: x.id, label: x.id }))}
      value={pm}
      onChange={setPm}
      label="Package manager"
      idBase="start-pm"
      className="self-start"
    />
  );

  return (
    <Steps
      start={3}
      rise={4}
      steps={[
        {
          title: "Install the packages",
          body: (
            <div className="flex flex-col gap-2.5">
              {pmTabs}
              <div
                role="tabpanel"
                id={`start-pm-panel-${pm}`}
                aria-labelledby={`start-pm-tab-${pm}`}
              >
                <CommandLine command={`${p.add} ${PACKAGES}`} />
              </div>
            </div>
          ),
        },
        {
          title: "Add your Gemini API key",
          help: (
            <>
              Get one from{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
              >
                Google AI Studio
              </a>
              . The runtime reads it on the server only.
            </>
          ),
          body: (
            <CodeBlock
              code="GOOGLE_API_KEY=your-key"
              file=".env.local"
              lang="sh"
            />
          ),
        },
        {
          title: "Create the runtime route",
          help: "This endpoint runs the agent and checks the UI it sends back.",
          body: (
            <CodeBlock
              code={ROUTE}
              file="app/api/copilotkit/[[...slug]]/route.ts"
            />
          ),
        },
        ...(genui
          ? [
              {
                title: "Register your components",
                help: GENUI_NOTE[id],
                body: <CodeBlock code={genui} file="app/genui.tsx" />,
              },
            ]
          : []),
        {
          title: "Add the chat to a page",
          help:
            id === "copilotkit"
              ? "The standard catalog comes straight from the package, so there is no catalog file to write."
              : "The provider gets your catalog from app/genui.tsx.",
          body: <CodeBlock code={providerSnippet(id)} file="app/page.tsx" />,
        },
        {
          title: "Run it",
          help: "Open the page and ask for “a dashboard of this week's signups”.",
          body: <CommandLine command={p.dev} />,
        },
      ]}
    />
  );
}
