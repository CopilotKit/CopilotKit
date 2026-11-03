"use client";

import dynamic from "next/dynamic";

// The previews run CopilotKit in the browser only, as on shell-docs.
const Story = dynamic(
  () => import("./catalog-runtime").then((module) => module.CatalogStory),
  {
    ssr: false,
    loading: ({ error }) =>
      error ? (
        <p role="alert">
          The preview could not load. Reload the page to try again.
        </p>
      ) : (
        <p className="text-sm text-fd-muted-foreground">Loading preview…</p>
      ),
  },
);

export function CatalogStoryLoader({ name }: { name: string }) {
  return <Story name={name} />;
}
