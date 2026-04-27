import showcaseConfig from "../lib/showcase.config.json";
import { INTEGRATIONS } from "../lib/integration";

interface ShowcaseDemoProps {
  /**
   * Demo slug as it appears under `showcase/packages/<slug>/src/app/demos/`.
   * Common values: "agentic-chat", "tool-rendering", "hitl", "shared-state-read-write",
   * "gen-ui-tool-based", "subagents".
   */
  feature: string;
  /** Embed height in pixels. Default 600. */
  height?: number;
  /** Optional label shown above the iframe. */
  title?: string;
}

type ShowcaseEntry = {
  label: string;
  backendUrl: string | null;
  deployed: boolean;
  features: string[];
};

const config = showcaseConfig as Record<string, ShowcaseEntry>;

/**
 * Embeds a deployed showcase demo as an iframe. One iframe is rendered per
 * integration, wrapped in `data-variant-for=<slug>` — the integration CSS
 * hides the wrappers that don't match `body[data-integration]`, so only the
 * active integration's iframe ever displays.
 *
 * For source-code views, use the separate `<ShowcaseCode>` component which
 * fetches and highlights GitHub source at build time.
 */
export function ShowcaseDemo({
  feature,
  height = 600,
  title,
}: ShowcaseDemoProps) {
  return (
    <div className="my-6">
      {INTEGRATIONS.map((slug) => {
        const entry = config[slug];
        const hasDemo =
          !!entry?.deployed &&
          !!entry.backendUrl &&
          entry.features.includes(feature);
        const url = hasDemo ? `${entry!.backendUrl}/demos/${feature}` : null;
        return (
          <div key={slug} data-variant-for={slug}>
            {url ? (
              <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 bg-white dark:bg-zinc-950">
                {title && (
                  <div className="flex items-center px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-zinc-800/60 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {title}
                  </div>
                )}
                <iframe
                  src={url}
                  title={title ?? `${feature} demo`}
                  loading="lazy"
                  className="w-full block"
                  style={{ height: `${height}px`, border: 0 }}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-zinc-900/50 px-6 py-8 text-sm text-gray-600 dark:text-gray-400">
                <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                  Live demo not yet available for {entry?.label ?? slug}
                </div>
                <div className="text-gray-500 dark:text-gray-400">
                  {entry
                    ? `The "${feature}" demo isn't deployed for this integration yet.`
                    : `No showcase package is configured for this integration.`}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ShowcaseDemo;
