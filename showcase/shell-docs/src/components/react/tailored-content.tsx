"use client";

import type { ReactNode } from "react";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

// Local className-joining helper so this component has no external dep.
// Mirrors the subset of `classnames` behavior used below (strings + falsy values).
function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type TailoredContentOptionProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
  id: string;
};

/**
 * Declarative child marker for `TailoredContent`. This component intentionally
 * renders nothing; the parent reads its props (including `children`) directly
 * and renders the selected option's content itself.
 */
export function TailoredContentOption(_props: TailoredContentOptionProps) {
  return null;
}

type TailoredContentProps = {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  defaultOptionIndex?: number;
  id: string;
};

type IconElement = React.ReactElement<{ className?: string }>;

function TailoredContentInner({
  children,
  className,
  defaultOptionIndex = 0,
  id,
  header,
}: TailoredContentProps) {
  // All hooks must run unconditionally to satisfy the Rules of Hooks.
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const warnedKeyRef = useRef<string | null>(null);

  // Memoize derived arrays so downstream hook deps have stable identities.
  const options = useMemo(
    () =>
      React.Children.toArray(children).filter((child) =>
        React.isValidElement(child),
      ) as React.ReactElement<TailoredContentOptionProps>[],
    [children],
  );
  const optionIds = useMemo(
    () => options.map((option) => option.props.id),
    [options],
  );

  // Warn (dev-mode friendly) when duplicate option ids would cause ambiguous
  // URL <-> selection mapping. Runs only when ids change; warnedKeyRef guards
  // against duplicate warns for the same set (e.g. StrictMode double-invoke).
  useEffect(() => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const oid of optionIds) {
      if (seen.has(oid) && !duplicates.includes(oid)) {
        duplicates.push(oid);
      }
      seen.add(oid);
    }
    if (duplicates.length === 0) return;
    const warnKey = duplicates.join(",");
    if (warnedKeyRef.current === warnKey) return;
    warnedKeyRef.current = warnKey;
    // eslint-disable-next-line no-console
    console.warn(
      `TailoredContent(id=${id}): duplicate option id(s) detected: ${duplicates
        .map((d) => `"${d}"`)
        .join(", ")}. Option ids must be unique.`,
    );
  }, [optionIds, id]);

  const updateSelection = useCallback(
    (index: number) => {
      if (index < 0 || index >= options.length) return;
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set(id, optionIds[index]);
      // Update URL without reload; derived selectedIndex will follow.
      // Use history entries so browser back/forward can move between options.
      router.push(`?${newParams.toString()}`, { scroll: false });
    },
    [router, searchParams, id, optionIds, options.length],
  );

  // No hooks below this point — safe to short-circuit when there are no options.
  if (options.length === 0) return null;

  // Clamp defaultOptionIndex to the valid range.
  const clampedDefault = Math.min(
    Math.max(0, defaultOptionIndex),
    options.length - 1,
  );

  // Derive selectedIndex from the URL on every render so state stays in sync
  // with navigation (back/forward, external updates to the search param).
  const urlParam = searchParams.get(id);
  const indexFromUrl = urlParam ? optionIds.indexOf(urlParam) : -1;
  const selectedIndex = indexFromUrl >= 0 ? indexFromUrl : clampedDefault;

  const focusTab = (index: number) => {
    const el = tabRefs.current[index];
    if (el) el.focus();
  };

  const onKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    switch (e.key) {
      case "Enter":
      case " ":
      case "Spacebar":
        e.preventDefault();
        updateSelection(index);
        return;
      case "ArrowRight": {
        e.preventDefault();
        const next = (index + 1) % options.length;
        updateSelection(next);
        focusTab(next);
        return;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const prev = (index - 1 + options.length) % options.length;
        updateSelection(prev);
        focusTab(prev);
        return;
      }
      case "Home": {
        e.preventDefault();
        updateSelection(0);
        focusTab(0);
        return;
      }
      case "End": {
        e.preventDefault();
        const last = options.length - 1;
        updateSelection(last);
        focusTab(last);
        return;
      }
      default:
        return;
    }
  };

  const itemCn =
    "shell-docs-radius-control group relative flex min-h-[5.5rem] flex-1 cursor-pointer items-start gap-3 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] p-3.5 text-left text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:min-h-[6rem]";
  const selectedCn =
    "selected border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text)]";
  const iconCn =
    "h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-60 transition-colors group-[.selected]:text-[var(--accent)] group-[.selected]:opacity-90";
  const indicatorCn =
    "tailored-content-selected-indicator mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors";

  const tablistId = `tailored-content-tablist-${id}`;
  const tabId = (optId: string) => `tailored-content-tab-${id}-${optId}`;
  const panelId = (optId: string) => `tailored-content-panel-${id}-${optId}`;

  const selectedOption = options[selectedIndex];

  return (
    <div>
      <div className={cn("tailored-content-wrapper mt-4", className)}>
        {header}
        <div
          id={tablistId}
          role="tablist"
          aria-orientation="horizontal"
          className="flex flex-col md:flex-row gap-3 mt-2 mb-6 w-full"
        >
          {options.map((option, index) => {
            const isSelected = selectedIndex === index;
            return (
              <button
                type="button"
                key={option.props.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={tabId(option.props.id)}
                className={cn(itemCn, isSelected && selectedCn)}
                onClick={() => updateSelection(index)}
                onKeyDown={(e) => onKeyDown(e, index)}
                role="tab"
                aria-selected={isSelected}
                aria-label={`${option.props.title}${
                  isSelected ? ", selected" : ""
                }`}
                aria-controls={panelId(option.props.id)}
                tabIndex={isSelected ? 0 : -1}
              >
                <span
                  className={cn(
                    indicatorCn,
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)] bg-[var(--bg-surface)] text-transparent group-hover:border-[var(--accent)] group-hover:bg-[var(--accent-dim)] group-hover:text-[var(--accent)]",
                  )}
                  aria-hidden="true"
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1 flex min-w-0 items-center gap-2">
                    {React.isValidElement(option.props.icon)
                      ? (() => {
                          const icon = option.props.icon as IconElement;
                          return React.cloneElement(icon, {
                            className: cn(
                              icon.props?.className,
                              iconCn,
                              "my-0",
                            ),
                          });
                        })()
                      : null}
                    <span className="block min-w-0 text-base font-semibold leading-snug">
                      {option.props.title}
                    </span>
                  </span>
                  <span className="block text-sm leading-relaxed text-[var(--text-secondary)]">
                    {option.props.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {selectedOption && (
        <div
          role="tabpanel"
          id={panelId(selectedOption.props.id)}
          aria-labelledby={tabId(selectedOption.props.id)}
        >
          {selectedOption.props.children}
        </div>
      )}
    </div>
  );
}

/**
 * `TailoredContent` renders a set of tab-like options and the currently
 * selected option's content. The selection is persisted in the URL via
 * `?<id>=<optionId>` so links are shareable.
 *
 * Next.js App Router requires `useSearchParams()` to be wrapped in a
 * `<Suspense>` boundary. The exported component wraps the inner
 * implementation so consumers don't need to do that themselves.
 */
export function TailoredContent(props: TailoredContentProps) {
  return (
    <Suspense fallback={null}>
      <TailoredContentInner {...props} />
    </Suspense>
  );
}
