// The Angular docs' showcase pieces: <AngularSnippet> (a named region of the
// canonical Angular showcase app) and <AngularFeatureCatalog> (every feature
// Angular supports, with its demo, source, and API). Ports of shell-docs'
// angular-snippet.tsx, angular-feature-catalog.tsx and
// lib/angular-feature-docs.ts.

import { ArrowUpRight } from "lucide-react";
import { Callout } from "fumadocs-ui/components/callout";
import { DocsCode } from "../code";
import {
  getAngularSourceRegion,
  getFrontendCatalog,
  getFrontendRegistry,
  getRegistry,
} from "../data";
import { ACTION_LINK } from "./styles";

export function AngularSnippet({
  region,
  noCaption = false,
}: {
  region: string;
  noCaption?: boolean;
}) {
  const source = getAngularSourceRegion(region);
  if (!source) {
    return (
      <Callout type="warn" role="alert">
        Missing Angular showcase region <code>{region}</code>.
      </Callout>
    );
  }
  const filename = source.file.split("/").at(-1);
  return (
    <DocsCode
      code={source.content}
      lang={source.language}
      title={noCaption ? undefined : filename}
    />
  );
}

const SHOWCASE_ORIGIN = "https://showcase.copilotkit.ai";
const PUBLIC_API = "/reference/angular/public-api";

const API_BY_FEATURE: Record<string, string> = {
  "prebuilt-popup": "/reference/angular/components/CopilotPopup",
  "prebuilt-sidebar": "/reference/angular/components/CopilotSidebar",
  "frontend-tools": "/reference/angular/functions/registerFrontendTool",
  "frontend-tools-async": "/reference/angular/functions/registerFrontendTool",
  "gen-ui-interrupt": "/reference/angular/functions/registerHumanInTheLoop",
  "interrupt-headless": "/reference/angular/functions/injectInterrupt",
  "hitl-in-chat": "/reference/angular/functions/registerHumanInTheLoop",
  "hitl-in-app": "/reference/angular/functions/registerHumanInTheLoop",
  "mcp-apps": "/reference/angular/functions/provideMCPApps",
};

interface AngularFeatureDoc {
  id: string;
  name: string;
  description: string;
  runHref: string | null;
  sourceHref: string;
  apiHref: string;
}

/** Every feature the frontend registry marks supported on Angular. */
function getAngularFeatureDocs(): AngularFeatureDoc[] {
  const features = getRegistry().feature_registry.features;
  const cells = getFrontendCatalog().filter((c) => c.frontend === "angular");
  return Object.entries(getFrontendRegistry().feature_support)
    .filter(([, support]) => support.angular?.state === "supported")
    .map(([id, support]) => {
      const feature = features.find((f) => f.id === id);
      const runnable = cells.find((c) => c.feature === id && c.runnable);
      const cell = runnable ?? cells.find((c) => c.feature === id);
      if (!feature || !cell) {
        throw new Error(
          `Supported Angular feature ${JSON.stringify(id)} needs docs metadata and a catalog cell.`,
        );
      }
      const route = `${SHOWCASE_ORIGIN}/angular/${cell.integration}/${id}`;
      return {
        id,
        name: support.angular.docs?.name ?? feature.name,
        description: support.angular.docs?.description ?? feature.description,
        runHref: runnable ? route : null,
        sourceHref: `${route}/code`,
        apiHref: API_BY_FEATURE[id] ?? PUBLIC_API,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function AngularFeatureCatalog() {
  return (
    <div className="not-prose my-6 grid gap-3">
      {getAngularFeatureDocs().map((feature) => (
        <section
          key={feature.id}
          id={feature.id}
          aria-labelledby={`${feature.id}-title`}
          className="scroll-mt-24 rounded-xl border bg-card p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2
                id={`${feature.id}-title`}
                className="text-lg leading-snug font-semibold"
              >
                {feature.name}
              </h2>
              <code className="font-mono text-xs text-muted-foreground">
                {feature.id}
              </code>
            </div>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-foreground/80">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-brand-mint-deep"
              />
              Supported
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {feature.description}
          </p>
          <nav
            aria-label={`${feature.name} resources`}
            className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"
          >
            {feature.runHref ? (
              <a className={ACTION_LINK} href={feature.runHref}>
                Run example
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-muted-foreground">
                Backend demo pending
              </span>
            )}
            <a className={ACTION_LINK} href={feature.sourceHref}>
              View source
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
            <a className={ACTION_LINK} href={feature.apiHref}>
              {feature.apiHref === PUBLIC_API ? "API inventory" : "API reference"}
            </a>
          </nav>
        </section>
      ))}
    </div>
  );
}
