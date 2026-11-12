"use client";

import { useState } from "react";
import { DesignSystemLogo } from "@/components/site/design-system-logo";
import { useDesignSystem } from "@/design-systems/context";
import { DESIGN_SYSTEMS } from "@/design-systems/registry";
import type { DesignSystemId } from "@/design-systems/registry";
import { cn, focusRing } from "@/lib/utils";
import { CopyPrompt } from "./copy-prompt";
import { ManualSetup } from "./manual-setup";
import { MARKER, RAIL, RAIL_LINE, STEP_TITLE } from "./steps";
import { Tabs } from "./tabs";

const PICKS: Record<
  DesignSystemId,
  {
    label: string;
    note: string;
  }
> = {
  copilotkit: {
    label: "CopilotKit",
    note: "The standard catalog",
  },
  chatcn: {
    label: "shadcn/ui",
    note: "Your shadcn components",
  },
  material: {
    label: "Material 3",
    note: "Material 3 Expressive",
  },
  byoc: {
    label: "Your own",
    note: "Components you already have",
  },
};

type Mode = "agent" | "manual";

/** Pick the components, then the path: a prompt for a coding agent, or the steps by hand. */
export function StartFlow() {
  const { id, setId } = useDesignSystem();
  const [mode, setMode] = useState<Mode>("agent");

  return (
    <div>
      {/* One rail, one count: the library is step 1, the setup path step 2, and its steps carry on from 3. */}
      <section
        aria-labelledby="start-choose"
        className={`${RAIL} wb-rise pb-12`}
        style={{ "--rise": 2 } as React.CSSProperties}
      >
        <span aria-hidden className={RAIL_LINE} />
        <span aria-hidden className={MARKER}>
          1
        </span>
        <div className="min-w-0 pt-[3px]">
          <h2 id="start-choose" className={STEP_TITLE}>
            Choose your component library
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="start-choose"
            className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
            onKeyDown={(e) => {
              // A radio group is one tab stop; the arrow keys move the choice, as with native radios.
              const step =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              e.preventDefault();
              const at = DESIGN_SYSTEMS.findIndex((d) => d.id === id);
              const next =
                DESIGN_SYSTEMS[
                  (at + step + DESIGN_SYSTEMS.length) % DESIGN_SYSTEMS.length
                ];
              setId(next.id);
              e.currentTarget
                .querySelector<HTMLElement>(
                  `[data-start-design-system="${next.id}"]`,
                )
                ?.focus();
            }}
          >
            {DESIGN_SYSTEMS.map((d) => {
              const on = d.id === id;
              const { label, note } = PICKS[d.id];
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  data-start-design-system={d.id}
                  onClick={() => setId(d.id)}
                  className={cn(
                    "relative flex flex-col items-start gap-3 rounded-[12px] border p-3.5 text-left transition-[border-color,box-shadow,background-color]",
                    on
                      ? "border-foreground bg-card shadow-[0_0_0_1px_var(--foreground)] dark:border-white/35 dark:bg-white/[0.07] dark:shadow-[0_0_0_1px_oklch(1_0_0/12%)]"
                      : "border-border bg-card hover:border-foreground/30 dark:bg-white/[0.04]",
                    focusRing,
                  )}
                >
                  <span className="flex w-full items-start justify-between">
                    <DesignSystemLogo id={d.id} className="size-6" />
                    {/* The radio itself: a ring that fills when chosen. */}
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 place-items-center rounded-full border transition-colors",
                        on
                          ? "border-foreground bg-foreground dark:border-white/70 dark:bg-white/70"
                          : "border-foreground/25",
                      )}
                    >
                      {on ? (
                        <span className="size-1.5 rounded-full bg-background" />
                      ) : null}
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[14.5px] font-medium text-foreground">
                      {label}
                    </span>
                    <span className="text-[12.5px] leading-snug text-muted-foreground">
                      {note}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Step 2: how to set the chosen library up. The steps it opens carry on the count from 3. */}
      <section aria-labelledby="start-setup">
        <div
          className={`${RAIL} wb-rise pb-12`}
          style={{ "--rise": 3 } as React.CSSProperties}
        >
          <span aria-hidden className={RAIL_LINE} />
          <span aria-hidden className={MARKER}>
            2
          </span>
          <div className="min-w-0 pt-[3px]">
            <h2 id="start-setup" className={STEP_TITLE}>
              Choose your setup path
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              Set up {PICKS[id].label} with a coding agent, or do it by hand.
            </p>
            <div className="mt-3">
              <Tabs
                options={[
                  { id: "agent", label: "With a coding agent" },
                  { id: "manual", label: "By hand" },
                ]}
                value={mode}
                onChange={setMode}
                label="How to set it up"
                idBase="start-mode"
              />
            </div>
          </div>
        </div>
        <div
          role="tabpanel"
          id={`start-mode-panel-${mode}`}
          aria-labelledby={`start-mode-tab-${mode}`}
        >
          {mode === "agent" ? <CopyPrompt /> : <ManualSetup />}
        </div>
      </section>
    </div>
  );
}
