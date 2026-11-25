"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
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
  ComboboxSeparator,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { frontendHref, isChannel } from "@/lib/live-scope";
import { FRONTENDS, FRONTEND_GROUPS, frontendById } from "@/lib/stack";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { FRAMEWORKS, LANGUAGES, frameworkById } from "./data";
import { useFrontend } from "./frontend";
import { rememberFramework, useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/** The two halves of the list, and which one the switch puts first. */
type Side = "agent" | "frontend";

/**
 * Ids under a group label (a language or a platform), the shape Base UI's
 * grouped list takes, and the half of the list the group sits in.
 */
interface MenuGroup {
  value: string;
  kind: Side;
  items: string[];
}

const FRAMEWORK_GROUPS: MenuGroup[] = LANGUAGES.map((lang) => ({
  value: lang,
  kind: "agent" as const,
  items: FRAMEWORKS.filter((f) => f.language === lang).map((f) => f.id),
})).filter((group) => group.items.length > 0);

// Grouped as the sidebar's Frontend picker groups them.
const FRONTEND_ITEM_GROUPS: MenuGroup[] = FRONTEND_GROUPS.map((group) => ({
  value: group,
  kind: "frontend" as const,
  items: FRONTENDS.filter((f) => f.group === group).map((f) => f.id),
}));

/** Each side of the switch: its own half first, then the other. */
const SIDES: Record<
  Side,
  { label: string; search: string; empty: string; groups: MenuGroup[] }
> = {
  agent: {
    label: "Agent framework",
    search: "Find your framework or frontend",
    empty: "No framework or frontend matches.",
    groups: [...FRAMEWORK_GROUPS, ...FRONTEND_ITEM_GROUPS],
  },
  frontend: {
    label: "Frontend",
    search: "Find your frontend or framework",
    empty: "No frontend or framework matches.",
    groups: [...FRONTEND_ITEM_GROUPS, ...FRAMEWORK_GROUPS],
  },
};

/**
 * A half of the switch: the label draws the demo frame's round segment
 * around a visually hidden radio, so the switch reads as one setting.
 */
const SEGMENT =
  "relative flex h-full flex-1 cursor-pointer items-center justify-center rounded-full border border-transparent px-3.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/60 transition-all select-none hover:text-foreground has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-focus-visible:outline-1 has-focus-visible:outline-ring has-data-checked:bg-background has-data-checked:text-foreground has-data-checked:shadow-sm dark:text-muted-foreground dark:hover:text-foreground dark:has-data-checked:border-input dark:has-data-checked:bg-input/30 dark:has-data-checked:text-foreground";

/** Each half's heading, over its groups. */
const SECTION: Record<Side, string> = {
  agent: "Agent frameworks",
  frontend: "Frontends",
};

// Frontend and framework ids never collide, so one lookup names both halves.
const nameOf = (id: string) =>
  frontendById(id)?.name ?? frameworkById(id)?.name ?? id;

function Row({ id }: { id: string }) {
  const fe = frontendById(id);
  return (
    <ComboboxItem value={id} className="min-h-9 gap-2.5 rounded-lg px-2">
      {fe ? (
        // At its full 18px (rows shrink a bare svg to 16), in its own colors
        // when highlighted too.
        <FrontendLogo
          icon={fe.id}
          size={18}
          className="size-4.5 **:text-inherit!"
        />
      ) : (
        <FrameworkLogo slug={id} size={18} />
      )}
      <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
    </ComboboxItem>
  );
}

/**
 * A group of rows. The first group shown of each half opens it with the
 * half's heading, lilac like the sidebar's section headings; the second half
 * also takes an edge-to-edge rule above it. Both follow the search, so a half
 * with no match shows neither. A listbox's groups can't nest, so the heading
 * is hidden from assistive tech and each group's label carries its half.
 */
function MenuGroupRows({ group, index }: { group: MenuGroup; index: number }) {
  const above = ComboboxPrimitive.useFilteredItems<MenuGroup>()[index - 1];
  const opensHalf = above?.kind !== group.kind;
  return (
    <>
      {opensHalf && above ? <ComboboxSeparator className="-mx-1.5" /> : null}
      <ComboboxGroup
        items={group.items}
        className={opensHalf ? undefined : "mt-1"}
      >
        {opensHalf ? (
          <div
            aria-hidden="true"
            className="px-2 pt-1.5 text-xs font-medium text-primary"
          >
            {SECTION[group.kind]}
          </div>
        ) : null}
        <ComboboxLabel>
          <span className="sr-only">{SECTION[group.kind]}, </span>
          {group.value}
        </ComboboxLabel>
        <ComboboxCollection>
          {(id: string) => <Row key={id} id={id} />}
        </ComboboxCollection>
      </ComboboxGroup>
    </>
  );
}

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
 * The home's primary action: start from your agent framework or your
 * frontend, and land on its quickstart. One list holds both halves, each
 * under its heading and by its groups; the switch at its top picks which
 * half comes first, and the search always spans both. Opens with the search
 * focused at the top of the first half, where your last framework, or your
 * frontend, is checked.
 */
export function QuickstartMenu() {
  const router = useRouter();
  const [current] = useLastFramework();
  const { frontend, setFrontend } = useFrontend();
  const track = useHomepageTelemetry();
  // Kept while the page is open, so the menu reopens on the reader's side.
  const [side, setSide] = useState<Side>("agent");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the switch was last pressed by a tap. A radio checks on focus,
  // so the switch's own event can't tell.
  const tapped = useRef(false);
  const { search, empty, groups } = SIDES[side];

  return (
    <Combobox
      items={groups}
      value={side === "frontend" ? frontend : current}
      itemToStringLabel={nameOf}
      autoHighlight
      onValueChange={(id: string | null, { reason }) => {
        // Only a pick opens a quickstart: typing on the closed pill would
        // otherwise "select" the first name with that letter and navigate.
        if (!id || reason !== "item-press") return;
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
      {/* Wide enough for either search prompt at a phone's 16px text. The
          list is 24rem at most, else what the screen leaves under the switch
          and the search (--list-h). */}
      <ComboboxContent
        sideOffset={8}
        className="w-80 rounded-xl ring-frame-rim [--list-h:min(24rem,calc(var(--available-height)-5.375rem))]"
      >
        {/* Which half comes first: a radio group, since it's one setting
            over the same list. Arrows move and check, like the demo frame's
            switch; a change hands focus back to the search. */}
        <RadioGroup
          aria-label="List first"
          value={side}
          onValueChange={(next) => {
            if (next !== "agent" && next !== "frontend") return;
            setSide(next);
            const tap = tapped.current;
            // After the rows move: settle the highlight, then hand focus back
            // to the search so typing, arrows, and Enter carry on. A tap
            // leaves the phone's keyboard down, as a tap that opens the menu
            // does.
            requestAnimationFrame(() => {
              const input = inputRef.current;
              highlightAfterSwitch(listRef.current, input?.value.trim() ?? "");
              if (!tap) input?.focus();
            });
          }}
          onPointerDownCapture={(e) => {
            tapped.current = e.pointerType === "touch";
          }}
          onKeyDownCapture={() => {
            tapped.current = false;
          }}
          // 6px over the search, so its focus ring clears the switch.
          className="m-1 mb-1.5 flex h-8 w-auto gap-0 rounded-full bg-secondary p-0.5"
        >
          {(Object.keys(SIDES) as Side[]).map((s) => (
            <label key={s} className={SEGMENT}>
              <RadioGroupItem value={s} className="sr-only absolute size-px" />
              {SIDES[s].label}
            </label>
          ))}
        </RadioGroup>
        <ComboboxInput
          ref={inputRef}
          showTrigger={false}
          placeholder={search}
          aria-label={search}
        >
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        {/* Above the pill the popup grows upward, so there the list, or the
            empty message in its place, keeps the list's full height, and the
            switch stays put under the pointer. */}
        <ComboboxEmpty className="group-data-[side=top]/combobox-content:min-h-(--list-h)">
          {empty}
        </ComboboxEmpty>
        <ComboboxList
          ref={listRef}
          className="max-h-(--list-h) p-1.5 group-data-[side=top]/combobox-content:not-data-empty:min-h-(--list-h)"
        >
          {(group: MenuGroup, index: number) => (
            <MenuGroupRows key={group.value} group={group} index={index} />
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
