"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Component as ComponentIcon,
  FlaskConical,
  Layers,
  MessageSquare,
  Package,
  Play,
  Rocket,
  Search,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { GROUPS, isComponentName } from "@/components/docs/catalog-index";

const PAGES = [
  { label: "Playground", href: "/", icon: MessageSquare },
  { label: "Components", href: "/components", icon: ComponentIcon },
  { label: "Macros", href: "/components/macros", icon: Layers },
  { label: "Skills", href: "/skills", icon: Package },
  { label: "Evals", href: "/evals", icon: FlaskConical },
  { label: "Get started", href: "/start", icon: Rocket },
  { label: "Watch a build", href: "/watch", icon: Play },
];

/**
 * The Gen UI 2.0 standard component names, read from the installed package.
 * The package is large, so it loads the first time search is about to open
 * (pages that render surfaces already have it).
 */
function useStandardNames(load: boolean) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!load || names.length) return;
    let live = true;
    import("@copilotkit/react-core/v2/generative-ui")
      .then(({ standardUI }) => {
        if (live)
          setNames(
            Object.keys(standardUI.manifestComponents).filter(
              (n) => !isComponentName(n),
            ),
          );
      })
      .catch((e) =>
        console.warn("Search could not load the standard components", e),
      );
    return () => {
      live = false;
    };
  }, [load, names.length]);
  return names;
}

/** shadcn-docs style search trigger plus a Command dialog (opens on Cmd/Ctrl+K or "/"). Icon-only below 640px. */
export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [mac, setMac] = useState(true);
  const standard = useStandardNames(open || warm);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if (
        (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "/" && !typing)
      ) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Search components and pages"
        onClick={() => setOpen(true)}
        onPointerEnter={() => setWarm(true)}
        onFocus={() => setWarm(true)}
        className="flex size-9 flex-none items-center justify-center gap-2 rounded-md border border-border bg-secondary/50 text-[14px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:w-44 sm:justify-start sm:pl-3 sm:pr-1.5 md:w-56 lg:w-64"
      >
        <Search className="size-4 flex-none sm:size-3.5" />
        <span className="hidden min-w-0 flex-1 truncate text-left sm:inline lg:hidden">
          Search...
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-left lg:inline">
          Search components...
        </span>
        <span className="hidden flex-none items-center gap-0.5 sm:flex">
          <Kbd className="h-5 min-w-5 border border-border bg-background/60 px-1 text-[11px]">
            {mac ? "⌘" : "Ctrl"}
          </Kbd>
          <Kbd className="h-5 min-w-5 border border-border bg-background/60 px-1 text-[11px]">
            K
          </Kbd>
        </span>
      </button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Jump to a page or a component"
        className="sm:max-w-[560px]"
      >
        <Command>
          <CommandInput placeholder="Search components and pages..." />
          <CommandList className="docs-scroll max-h-[380px]">
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Pages">
              {PAGES.map((p) => (
                <CommandItem
                  key={p.href}
                  value={`page ${p.label}`}
                  onSelect={() => go(p.href)}
                >
                  <p.icon className="text-muted-foreground" />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {GROUPS.map((g) => (
              <CommandGroup key={g.cat} heading={g.cat}>
                {g.items.map((n) => (
                  <CommandItem
                    key={n}
                    value={`${n} ${g.cat}`}
                    onSelect={() => go(`/components/${n}`)}
                  >
                    <span className="size-1.5 flex-none rounded-full bg-muted-foreground/40" />
                    {n}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {standard.length ? (
              <CommandGroup heading="Gen UI 2.0 standard">
                {standard.map((n) => (
                  <CommandItem
                    key={n}
                    value={`${n} standard`}
                    onSelect={() => go(`/components/${n}`)}
                  >
                    <span className="size-1.5 flex-none rounded-full bg-muted-foreground/40" />
                    {n}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
