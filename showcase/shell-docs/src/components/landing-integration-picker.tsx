"use client";

import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

import { useId, useState } from "react";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ChevronRight } from "lucide-react";
import { FrameworkLogo } from "./icons/framework-icons";
import { PickLogoMark } from "./docs-map-parts";
import { frontendPathForBackend, isFrontendId } from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";
import type { MapPick } from "@/lib/homepage-map";
import type { LandingIntegration } from "@/lib/landing-integrations";

function integrationHref(slug: string, frontend: FrontendId): string {
  if (frontend === "react")
    return slug === "built-in-agent" ? "/quickstart" : `/${slug}`;
  return frontendPathForBackend(
    frontend,
    "",
    slug === "built-in-agent" ? null : slug,
  );
}

const ROW_CLASS =
  "group flex min-h-16 w-full cursor-pointer items-center gap-3 border-b border-[var(--border)] py-3 text-left text-sm text-[var(--text)] no-underline transition-colors hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

export function LandingIntegrationPicker({
  frontends,
  integrations,
}: {
  frontends: readonly MapPick[];
  integrations: readonly LandingIntegration[];
}) {
  const [frontend, setFrontend] = useState<FrontendId>("react");
  const id = useId();
  const track = useHomepageTelemetry();

  return (
    <>
      <fieldset className="mt-7 min-w-0 border-0 p-0">
        <legend className="mb-3 text-xs font-medium text-[var(--text-secondary)]">
          Your frontend
        </legend>
        <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-[var(--nav-control-border)] bg-[var(--bg-elevated)] p-1">
          {frontends.map((option) => (
            <label key={option.id} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-frontend`}
                value={option.id}
                checked={frontend === option.id}
                onChange={() => {
                  if (isFrontendId(option.id)) {
                    setFrontend(option.id);
                    track("frontend_selected", {
                      frontend: option.id,
                      surface: "integration_directory",
                    });
                  }
                }}
                className="peer sr-only"
              />
              <span
                className={`shell-docs-radius-control inline-flex min-h-10 items-center gap-2 border px-3 text-xs font-medium transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)] ${frontend === option.id ? "border-[var(--nav-control-border)] bg-[var(--bg-surface)] text-[var(--accent)] shadow-sm" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text)]"}`}
              >
                <span aria-hidden="true">
                  <PickLogoMark logo={option.logo} size={17} />
                </span>
                {option.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <h3 className="mt-7 text-xs font-medium text-[var(--text-secondary)]">
        Your agent backend
      </h3>
      <div className="mt-2 grid grid-cols-1 gap-x-7 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const content = (
            <>
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--accent)]"
              >
                <FrameworkLogo
                  slug={integration.logoSlug}
                  fallbackSrc={integration.logo}
                  size={21}
                />
              </span>
              <span className="flex-1 font-medium leading-snug">
                {integration.name}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
              />
            </>
          );
          return integration.choices.length > 1 ? (
            <Popover key={integration.id}>
              <PopoverTrigger asChild>
                <button type="button" className={ROW_CLASS}>
                  {content}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                aria-label={`${integration.name} language`}
              >
                <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                  Choose your language
                </p>
                {integration.choices.map((choice) => (
                  <Link
                    key={choice.slug}
                    href={integrationHref(choice.slug, frontend)}
                    onClick={() =>
                      track("integration_selected", {
                        frontend,
                        backend: choice.slug,
                        destination: integrationHref(choice.slug, frontend),
                      })
                    }
                    className="block rounded-lg px-3 py-3 hover:bg-[var(--accent-dim)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    {choice.name}
                  </Link>
                ))}
              </PopoverContent>
            </Popover>
          ) : (
            <Link
              key={integration.id}
              href={integrationHref(integration.choices[0].slug, frontend)}
              onClick={() =>
                track("integration_selected", {
                  frontend,
                  backend: integration.choices[0].slug,
                  destination: integrationHref(
                    integration.choices[0].slug,
                    frontend,
                  ),
                })
              }
              className={ROW_CLASS}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </>
  );
}
