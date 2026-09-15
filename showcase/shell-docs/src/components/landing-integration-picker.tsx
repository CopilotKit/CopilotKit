"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, X } from "lucide-react";
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
  const [selected, setSelected] = useState<LandingIntegration | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const frontendName = frontends.find((option) => option.id === frontend)?.name;

  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selected]);

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
                  if (isFrontendId(option.id)) setFrontend(option.id);
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
            <button
              key={integration.id}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setSelected(integration)}
              className={ROW_CLASS}
            >
              {content}
            </button>
          ) : (
            <Link
              key={integration.id}
              href={integrationHref(integration.choices[0].slug, frontend)}
              className={ROW_CLASS}
            >
              {content}
            </Link>
          );
        })}
      </div>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[var(--nav-control-border)] bg-[var(--bg-surface)] p-0 text-[var(--text)] shadow-[var(--shadow-panel)] backdrop:bg-black/45"
      >
        {selected && (
          <div className="p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={`${id}-title`}
                  className="text-xl font-semibold tracking-tight"
                >
                  {selected.name}
                </h2>
                <p
                  id={`${id}-description`}
                  className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]"
                >
                  Choose your agent language to continue with {frontendName}.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close language selector"
                onClick={() => dialogRef.current?.close()}
                className="-mr-2 -mt-2 inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid gap-2">
              {selected.choices
                .filter((choice) => !choice.secondary)
                .map((choice) => (
                  <Link
                    key={choice.slug}
                    href={integrationHref(choice.slug, frontend)}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-[var(--nav-control-border)] px-4 py-3 text-sm font-medium hover:bg-[var(--accent-dim)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    {choice.name}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                ))}
            </div>
            {selected.choices
              .filter((choice) => choice.secondary)
              .map((choice) => (
                <Link
                  key={choice.slug}
                  href={integrationHref(choice.slug, frontend)}
                  className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--accent)]"
                >
                  {choice.name}{" "}
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              ))}
          </div>
        )}
      </dialog>
    </>
  );
}
