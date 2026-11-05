"use client";

import { useEffect, useRef, useState } from "react";
import { saveUser, storedName } from "@/lib/user";
import type { DemoUser } from "@/lib/user";
import { cn } from "@/lib/cn";

/**
 * Who is using the demo. Asks once, inline, on the first visit; the name keys
 * threads and Product Analytics (see src/lib/user.ts).
 */
export function NameChip({
  user,
  onChange,
  full = false,
}: {
  user: DemoUser | null;
  onChange: (user: DemoUser) => void;
  /** Always show the name (inside the phone menu). */
  full?: boolean;
}) {
  const [open, setOpen] = useState(user === null);
  const [draft, setDraft] = useState(user?.name ?? "");
  const [invalid, setInvalid] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || user === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, user]);

  const submit = () => {
    const saved = saveUser(draft);
    if (!saved) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setOpen(false);
    if (saved.id !== user?.id || saved.name !== user?.name) onChange(saved);
  };

  return (
    <div
      ref={root}
      className={cn("relative", full && "w-full")}
      data-testid="name-chip"
    >
      <button
        type="button"
        onClick={() => {
          setDraft(user?.name ?? "");
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={user ? `Your name: ${user.name}` : "Add your name"}
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-xl border border-line bg-panel pr-1.5 pl-1.5 text-[15.5px] sm:pr-3.5 text-text transition-colors hover:border-line-strong",
          full && "w-full pr-3.5",
        )}
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-[14px] font-semibold text-accent uppercase">
          {user?.name.charAt(0) ?? "?"}
        </span>
        {/* Initial only on phones, so the navbar fits at 390px. */}
        <span
          className={cn(
            "truncate",
            full ? "min-w-0" : "max-w-[160px] max-sm:sr-only",
          )}
        >
          {user?.name ?? "Add your name"}
        </span>
      </button>

      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="enter absolute top-[calc(100%+10px)] right-0 z-30 w-[min(320px,calc(100vw-32px))] rounded-2xl border border-line bg-panel p-4 shadow-[0_18px_48px_-20px_oklch(0_0_0/45%)]"
        >
          <label
            htmlFor="user-name"
            className="text-[15.5px] font-semibold text-text"
          >
            Your name
          </label>
          <p className="mt-1 text-[14px] leading-snug text-dim">
            Your conversations are saved under it. Use the same name on another
            device to open them.
          </p>
          <input
            id="user-name"
            autoFocus
            value={draft}
            onFocus={() => {
              if (!draft) setDraft(storedName());
            }}
            maxLength={40}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            placeholder="e.g. Ada Lovelace"
            className={cn(
              "mt-3 h-11 w-full rounded-xl border bg-bg px-3.5 text-[16px] text-text placeholder:text-faint focus:outline-none",
              invalid ? "border-fail" : "border-line focus:border-line-strong",
            )}
          />
          {invalid && (
            <p className="mt-1.5 text-[14px] text-fail">
              Use at least one letter or number.
            </p>
          )}
          <button
            type="submit"
            className="mt-3 h-11 w-full rounded-xl bg-accent text-[15.5px] font-semibold text-accent-ink transition-[filter] hover:brightness-110"
          >
            Save
          </button>
        </form>
      )}
    </div>
  );
}
