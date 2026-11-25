"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { frontendHref, isChannel } from "@/lib/live-scope";
import { FRONTENDS, FRONTEND_GROUPS, frontendById } from "@/lib/stack";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { FRAMEWORKS, LANGUAGES, frameworkById } from "./data";
import { useFrontend } from "./frontend";
import { rememberFramework, useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/** Ids under a heading, the shape Base UI's grouped list takes. */
type Group = { value: string; items: string[] };

/** What each side of the menu's switch lists. */
const MODES = {
  agent: {
    label: "Agent framework",
    search: "Find your agent framework",
    empty: "No framework matches.",
    groups: LANGUAGES.map((lang) => ({
      value: lang,
      items: FRAMEWORKS.filter((f) => f.language === lang).map((f) => f.id),
    })) satisfies Group[],
  },
  frontend: {
    label: "Frontend",
    search: "Find your frontend",
    empty: "No frontend matches.",
    // Grouped as the sidebar's Frontend picker groups them.
    groups: FRONTEND_GROUPS.map((group) => ({
      value: group,
      items: FRONTENDS.filter((f) => f.group === group).map((f) => f.id),
    })) satisfies Group[],
  },
};

type Mode = keyof typeof MODES;

// Frontend and framework ids never collide, so one lookup names both lists.
const nameOf = (id: string) =>
  frontendById(id)?.name ?? frameworkById(id)?.name ?? id;

/**
 * Puts the highlight where it would be had the menu opened on this side: the
 * first match while the reader is searching, else the checked row. Base UI
 * keeps the old list's highlighted index when the items change and has no
 * way to set it, so this hovers the row the way the pointer would.
 */
function highlightAfterSwitch(list: HTMLElement | null, query: string) {
  if (!list) return;
  list.scrollTop = 0;
  const row =
    list.querySelector<HTMLElement>(
      query ? '[role="option"]' : '[role="option"][aria-selected="true"]',
    ) ?? list.querySelector<HTMLElement>('[role="option"]');
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  const { left, top } = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: left + 1,
      clientY: top + 1,
      movementX: 1,
    }),
  );
}

/**
 * The home's primary action: pick where you start, land on its quickstart.
 * A switch at the top of the menu picks the list: agent frameworks by
 * language (the default) or frontends by kind. Flipping it keeps what you
 * typed. Opens with the search focused; your last framework, or your
 * frontend, is checked.
 */
export function QuickstartMenu() {
  const router = useRouter();
  const [current] = useLastFramework();
  const { frontend, setFrontend } = useFrontend();
  const track = useHomepageTelemetry();
  // Kept while the page is open, so the menu reopens on the reader's side.
  const [mode, setMode] = useState<Mode>("agent");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the switch was last pressed by a tap. A pressed tab switches on
  // focus, so the switch's own event can't tell.
  const tapped = useRef(false);
  const { search, empty, groups } = MODES[mode];

  return (
    <Combobox
      items={groups}
      value={mode === "frontend" ? frontend : (current ?? null)}
      itemToStringLabel={nameOf}
      autoHighlight
      onValueChange={(id: string | null) => {
        if (!id) return;
        const picked = frontendById(id);
        if (picked) {
          // A channel's quickstart is its "Connect and run your agent" guide.
          const destination = frontendHref(
            [],
            picked.id,
            isChannel(picked.id) ? "connect" : "",
          );
          track("quickstart_selected", { frontend: picked.id, destination });
          setFrontend(picked.id);
          router.push(destination);
          return;
        }
        const destination = frameworkHref("d", id, "quickstart");
        track("quickstart_selected", { backend: id, destination });
        rememberFramework(id);
        router.push(destination);
      }}
    >
      <ComboboxTrigger
        render={
          <Button className="group h-11 rounded-full bg-foreground px-5 text-background hover:bg-foreground/85 data-popup-open:bg-foreground/85 [&>svg]:text-background [&>svg]:transition-transform [&>svg]:duration-200 data-popup-open:[&>svg]:rotate-180 motion-reduce:[&>svg]:transition-none" />
        }
      >
        Start the quickstart
      </ComboboxTrigger>
      <ComboboxContent
        sideOffset={8}
        className="w-72 rounded-xl ring-frame-rim"
      >
        <Tabs
          value={mode}
          onValueChange={(next: Mode) => {
            setMode(next);
            const tap = tapped.current;
            // After the new rows render: settle the highlight, then hand
            // focus back to the search so typing, arrows, and Enter carry on.
            // A tap leaves the phone's keyboard down, as a tap that opens the
            // menu does.
            requestAnimationFrame(() => {
              const input = inputRef.current;
              highlightAfterSwitch(listRef.current, input?.value.trim() ?? "");
              if (!tap) input?.focus();
            });
          }}
          className="gap-0"
        >
          <TabsList
            activateOnFocus
            aria-label="Start from"
            onPointerDownCapture={(e) => {
              tapped.current = e.pointerType === "touch";
            }}
            onKeyDownCapture={() => {
              tapped.current = false;
            }}
            className="m-1 mb-0 h-8 w-auto rounded-full bg-secondary p-0.5"
          >
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <TabsTrigger
                key={m}
                value={m}
                className="h-full cursor-pointer rounded-full px-3.5 text-xs data-active:shadow-sm"
              >
                {MODES[m].label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* The popup styles its search field as a direct child; inside the
              tabs it takes the same classes here, a little lower so its
              focus ring clears the switch. */}
          <ComboboxInput
            ref={inputRef}
            showTrigger={false}
            placeholder={search}
            aria-label={search}
            className="m-1 mt-1.5 mb-0 border-input/30 bg-input/30 shadow-none"
          >
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </ComboboxInput>
          {/* The list is the switch's tab panel. The search drives it, so
              the panel takes no tab stop, and pressing its blank space (the
              empty message) leaves focus in the search. The list is 24rem at
              most, else what the screen leaves under the switch and search.
              Above the pill the popup grows upward, so there the panel keeps
              that height on both sides and the switch stays put. */}
          <TabsContent
            value={mode}
            tabIndex={-1}
            onMouseDown={(e) => {
              if (!listRef.current?.contains(e.target as Node)) {
                e.preventDefault();
              }
            }}
            className="[--list-h:min(24rem,calc(var(--available-height)-5.375rem))] group-data-[side=top]/combobox-content:min-h-(--list-h)"
          >
            <ComboboxEmpty>{empty}</ComboboxEmpty>
            <ComboboxList ref={listRef} className="max-h-(--list-h) p-1.5">
              {(group: Group) => (
                <ComboboxGroup
                  key={group.value}
                  items={group.items}
                  className="not-first:mt-1"
                >
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(id: string) => {
                      const fe = frontendById(id);
                      return (
                        <ComboboxItem
                          key={id}
                          value={id}
                          className="min-h-9 gap-2.5 rounded-lg px-2"
                        >
                          {fe ? (
                            // At its full 18px (rows shrink a bare svg to
                            // 16), in its own colors when highlighted too.
                            <FrontendLogo
                              icon={fe.id}
                              size={18}
                              className="size-4.5 **:text-inherit!"
                            />
                          ) : (
                            <FrameworkLogo slug={id} size={18} />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {nameOf(id)}
                          </span>
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </TabsContent>
        </Tabs>
      </ComboboxContent>
    </Combobox>
  );
}
