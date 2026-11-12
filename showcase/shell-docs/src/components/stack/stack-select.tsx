"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  BACKENDS,
  COVERAGE_LABEL,
  FRONTENDS,
  FRONTEND_GROUPS,
  LANGUAGES,
  backendById,
  coverageFor,
  frontendById,
  type FrontendId,
} from "@/lib/stack";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { useStack } from "./stack-provider";

// Picking one axis before the other fills the other with the docs' default,
// and the row shows it, so nothing is chosen silently.
const DEFAULT_FRONTEND: FrontendId = "react";
const DEFAULT_BACKEND = "built-in-agent";

const itemClass =
  "flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-start outline-none transition-colors hover:bg-accent focus-visible:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent";

function Row({
  label,
  value,
  icon,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  value?: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-fd-ring data-[popup-open]:bg-accent">
        <span className="flex size-5 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-fd-muted-foreground">{label}</span>
          <span
            className={cn("truncate font-medium", !value && "text-fd-primary")}
          >
            {value ?? "Choose"}
          </span>
        </span>
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-fd-muted-foreground"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={14}
        className="flex max-h-[min(30rem,var(--available-height))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-0 overflow-y-auto rounded-xl p-1 ring-frame-rim"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pt-2 pb-1 text-xs text-fd-muted-foreground">
      {children}
    </p>
  );
}

function FrontendMenu({
  current,
  onPick,
}: {
  current?: FrontendId;
  onPick: (id: FrontendId) => void;
}) {
  return FRONTEND_GROUPS.map((group) => (
    <div key={group} role="group" aria-label={group}>
      <GroupLabel>{group}</GroupLabel>
      {FRONTENDS.filter((f) => f.group === group).map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={current === f.id}
          onClick={() => onPick(f.id)}
          className={itemClass}
        >
          <FrontendLogo icon={f.id} size={16} className="mt-0.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{f.name}</span>
            <span className="text-xs text-fd-muted-foreground">
              {f.summary}
            </span>
          </span>
          {current === f.id ? (
            <Check
              className="mt-0.5 size-4 shrink-0 text-fd-primary"
              aria-hidden="true"
            />
          ) : null}
        </button>
      ))}
    </div>
  ));
}

function BackendMenu({
  frontend,
  current,
  onPick,
}: {
  frontend: FrontendId;
  current?: string;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? BACKENDS.filter((b) => b.name.toLowerCase().includes(q))
      : BACKENDS;
  }, [query]);
  const frontendName = frontendById(frontend)?.name ?? frontend;

  return (
    <>
      <label className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border-b bg-fd-popover px-2.5 py-2 text-sm text-fd-muted-foreground">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">Find your agent framework</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find your agent framework"
          className="min-w-0 flex-1 bg-transparent text-fd-foreground outline-none placeholder:text-fd-muted-foreground"
        />
      </label>
      {matches.length === 0 ? (
        <p className="px-2.5 py-3 text-sm text-fd-muted-foreground">
          No agent framework matches “{query}”.
        </p>
      ) : null}
      {LANGUAGES.map((language) => {
        const items = matches.filter((b) => b.language === language);
        if (items.length === 0) return null;
        return (
          <div key={language} role="group" aria-label={language}>
            <GroupLabel>{language}</GroupLabel>
            {items.map((b) => {
              const coverage = coverageFor(frontend, b);
              const unavailable = coverage === "none";
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={current === b.id}
                  aria-disabled={unavailable || undefined}
                  title={
                    unavailable
                      ? `${COVERAGE_LABEL.none} for ${frontendName}`
                      : undefined
                  }
                  onClick={() => {
                    if (!unavailable) onPick(b.id);
                  }}
                  className={cn(itemClass, "items-center")}
                >
                  <FrameworkLogo slug={b.id} size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {unavailable ? (
                    <span className="text-xs text-fd-muted-foreground">
                      Not for {frontendName} yet
                    </span>
                  ) : coverage === "guide" ? (
                    <span className="text-xs text-fd-muted-foreground">
                      Guide
                    </span>
                  ) : null}
                  {current === b.id ? (
                    <Check
                      className="size-4 shrink-0 text-fd-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
      <p className="px-2.5 pt-2 pb-1.5 text-xs text-fd-muted-foreground/80">
        Coverage labels are sample data.
      </p>
    </>
  );
}

/** Frontend and agent framework: two choices, one bordered group. */
export function StackSelect({ className }: { className?: string }) {
  const { stack, ready, setStack } = useStack();
  const [open, setOpen] = useState<"frontend" | "backend" | null>(null);
  const frontend = stack ? frontendById(stack.frontend) : undefined;
  const backend = stack ? backendById(stack.backend) : undefined;
  const unset = ready && !stack;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex flex-col rounded-xl border bg-fd-secondary/50 text-sm",
          unset && "border-fd-primary/40",
          className,
        )}
      >
        <Row
          label="Frontend"
          value={frontend?.name}
          icon={
            frontend ? (
              <FrontendLogo icon={frontend.id} size={18} />
            ) : (
              <span className="size-4 rounded-full border border-dashed border-fd-muted-foreground/60" />
            )
          }
          open={open === "frontend"}
          onOpenChange={(o) => setOpen(o ? "frontend" : null)}
        >
          <FrontendMenu
            current={stack?.frontend}
            onPick={(id) => {
              const keep = stack?.backend && backendById(stack.backend);
              setStack({
                frontend: id,
                backend:
                  keep && coverageFor(id, keep) !== "none"
                    ? keep.id
                    : DEFAULT_BACKEND,
              });
              setOpen(null);
            }}
          />
        </Row>
        <div className="mx-2.5 border-t" />
        <Row
          label="Agent framework"
          value={backend?.name}
          icon={
            backend ? (
              <FrameworkLogo slug={backend.id} size={18} />
            ) : (
              <span className="size-4 rounded-full border border-dashed border-fd-muted-foreground/60" />
            )
          }
          open={open === "backend"}
          onOpenChange={(o) => setOpen(o ? "backend" : null)}
        >
          <BackendMenu
            frontend={stack?.frontend ?? DEFAULT_FRONTEND}
            current={stack?.backend}
            onPick={(id) => {
              setStack({
                frontend: stack?.frontend ?? DEFAULT_FRONTEND,
                backend: id,
              });
              setOpen(null);
            }}
          />
        </Row>
      </div>
      {unset ? (
        <p className="px-1 text-xs text-fd-muted-foreground">
          Choose once to tailor the code on every page.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The sidebar's top block through Fumadocs' documented
 * `searchToggle.components.lg` option: the stack choices, then Fumadocs' own
 * search button with the classes the Spacious sidebar gives it.
 */
export function SidebarStackAndSearch() {
  return (
    <div className="flex flex-col gap-2">
      <StackSelect />
      <FullSearchTrigger
        hideIfDisabled
        className="h-10 gap-3 rounded-xl bg-card ps-[calc(--spacing(2.5)-1px)] pe-2 shadow-lift hover:bg-accent [&_svg]:shrink-0"
      />
    </div>
  );
}
