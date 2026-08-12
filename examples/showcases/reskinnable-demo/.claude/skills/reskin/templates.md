# Skin file templates

Copy each block into `src/skins/<id>/<file>` and replace `<id>` / `<Brand>` /
domain specifics. These are written against this app's frozen `Skin` contract
(`src/shell/skin-contract.ts`) and mirror the six shipped skins
(`src/skins/{banking,airline,logistics,keel,people,commerce}/`) — see
[demo-beats.md](./demo-beats.md) § "Which skin to copy for what" for which one to
open for which problem.

These templates are the **wiring floor**, not a finished skin. A skin also has to
hit the demo beats (SKILL.md § "FIRST: a skin is a live sales demo"); where a
template slot is load-bearing for a beat, it says so.

Throughout: replace `<id>` with your lowercase skin id (e.g. `support`) and
`<Id>` with the PascalCase form (e.g. `Support`). The id must equal the route
segment, `themeClass` (`theme-<id>`), and the agent id.

---

## `identity.ts`

A `.ts` file (no JSX) — build the logo with `createElement`, exactly like
`src/skins/airline/identity.ts` and `src/skins/banking/identity.ts`.

```ts
import { createElement } from "react";

function <Id>Logo({ className }: { className?: string }) {
  // `currentColor` so the mark inherits the brand color wherever it mounts
  // (nav, selector, chat header).
  return createElement(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
    createElement("path", { d: "M4 13.5L9 7l4 4.5L20 4", stroke: "currentColor", strokeWidth: 2.2 }),
  );
}

export const <id>Identity = {
  brand: "<Brand>",
  tagline: "<one-line tagline>",
  logo: <Id>Logo,
  // favicon?:       emoji browser-tab icon (e.g. "🛟") — the shell's FaviconSync
  //                 renders it into a <link rel="icon"> per skin; omit for the
  //                 static favicon.ico
  // assistantName?: chat header title (defaults to brand)
  // greeting?:      chat welcome message (defaults to tagline)
} as const;
```

## `theme.css`

Re-value shared tokens ONLY (the names are declared in `src/app/globals.css`).
Do not add new token names. Values are HSL channels, space-separated (the shell
wraps them in `hsl(...)`). The re-valuable set (see `src/skins/airline/theme.css`
for a full, working example): `--brand`, `--brand-violet`, `--brand-indigo`,
`--brand-foreground`, `--brand-soft`, `--background`, `--foreground`, `--canvas`,
`--surface`, `--surface-muted`, `--ink`, `--ink-muted`, `--hairline`,
`--positive`, `--positive-soft`, `--negative`, `--negative-soft`, `--radius`.

**Do not remove the `prettier-ignore` below.** Prettier formats fenced blocks by
language, and its CSS parser reads `<id>` as a token to re-space — it rewrites
`.theme-<id>` into `.theme-<id >`, an INVALID selector that silently applies no
theme, and then reports that broken form as correctly formatted. (The `ts`/`tsx`
fences need no guard: they fail to parse as TypeScript, so Prettier skips them
whole.)

<!-- prettier-ignore -->
```css
.theme-<id> {
  --radius: 1.125rem;

  /* OPT-IN dark mode. `src/hooks/use-theme.ts` forces any skin WITHOUT this flag
     to light and ignores the stored dark preference, so a `.dark .theme-<id>`
     block below does NOTHING unless you also set this. Set it (and ship the dark
     block) to make the theme toggle a real control; omit BOTH to stay light-only
     — a legitimate choice (airline does it). Without the flag the toggle in your
     layout is a dead button. */
  --nw-dark-capable: 1;

  --brand: 252 83% 67%;
  --brand-violet: 252 83% 67%;
  --brand-indigo: 248 84% 60%;
  --brand-foreground: 0 0% 100%;
  --brand-soft: 252 90% 96%;

  --background: 255 60% 99%;
  --foreground: 252 30% 14%;
  --canvas: 255 60% 97%;
  --surface: 0 0% 100%;
  --surface-muted: 252 40% 98%;
  --ink: 252 30% 14%;
  --ink-muted: 250 12% 46%;
  --hairline: 252 30% 92%;

  --positive: 152 62% 40%;
  --positive-soft: 152 70% 95%;
  --negative: 349 78% 56%;
  --negative-soft: 349 90% 96%;
}

/* DARK — ship this ONLY if you set `--nw-dark-capable: 1` above. `.dark` lands on
   <html> (an ancestor of the `.theme-<id>` root), so this descendant selector
   re-values only the tokens that DIFFER — surfaces, ink, and semantic tokens —
   and lets the brand ramp and `--radius` inherit from the light block.
   (Mirror `src/skins/logistics/theme.css` / `src/skins/banking/theme.css`.) */
.dark .theme-<id> {
  color-scheme: dark;

  --background: 252 20% 8%;
  --foreground: 255 30% 95%;
  --canvas: 252 20% 8%;
  --surface: 252 16% 12%;
  --surface-muted: 252 14% 15%;
  --ink: 255 30% 95%;
  --ink-muted: 250 10% 62%;
  --hairline: 252 12% 22%;

  --brand-soft: 252 40% 20%;

  --positive: 152 52% 50%;
  --positive-soft: 152 35% 15%;
  --negative: 349 76% 64%;
  --negative-soft: 349 40% 18%;
}
```

**If your dark block LIFTS `--brand`, it MUST re-value `--brand-foreground` too.**
The template above leaves both alone in dark on purpose. A dark-anchored brand
(commerce's `206 72% 30%`, keel's `170 38% 28%`, people's `315 38% 36%`) vanishes
on a dark surface, so the dark block lifts it — and that FLIPS the polarity of
every pair the brand anchors while `--brand-foreground: 0 0% 100%` stays behind in
the light block. Commerce shipped that way and every primary button in its dark
mode measured **2.60:1**; the labels are small and semibold, so 4.5:1 applies, not
3:1. Two traps make this invisible:

- **Do not "fix" it by darkening `--brand`.** `--brand` is simultaneously a FILL
  under `--brand-foreground` and TEXT on `--brand-soft` (nav active state, brand
  pills, `activeSelectClass`). Darkening it to satisfy white labels collapses the
  text pair instead. Re-value `--brand-foreground` to a deep ink in the brand's
  own hue — logistics does this in light mode for its bright amber
  (`--brand-foreground: 30 50% 10%`), commerce in dark (`206 60% 10%`).
- **`--brand-violet` on `--brand-soft` is a real pair in DARK ONLY.** The shared
  chrome pairs brand-soft with `text-brand-indigo` in light and reaches for
  `dark:text-brand-violet` in dark (`components/ui/dropdown-menu.tsx`,
  `select.tsx`, `avatar.tsx`, `button.tsx`). If your skin repurposes
  `--brand-violet` as a domain accent, that pair still has to clear 4.5:1 in dark.
  **It does NOT do that everywhere**, so do not conclude `--brand-indigo` is
  exempt in dark: `button.tsx`'s `outline` variant re-inks its hovered LABEL to
  `--brand-indigo` with no dark counterpart (2.75:1 in banking dark, 1.21:1 in
  keel), and the theme toggle does the same for its icon. Both are shell-wide
  follow-ups no skin can fix alone; `theme.test.ts`'s
  `UN_OVERRIDDEN_BRAND_SOFT_INK` is the live list, and a test there fails if the
  set grows or shrinks — read it rather than trusting this sentence.

- **A tinted chip's ground is the TINT, not the card under it.** A chip written as
  `bg-<token>/12 text-<token>` — the shape every skin reaches for to make an accent
  chip — paints its label against a 12% wash of its own colour over the card, which
  is darker than the card. Measure the card and you get a number the user never
  sees: commerce's rose read 4.52:1 on `--surface` and **3.75:1** on the wash it
  actually renders on, and the guard called that a pass for a release. Composite
  the tint before measuring (`theme.test.ts`'s `bg.alpha` / `bg.over`).

Nothing else in this app catches a contrast regression — it type-checks, lints and
renders. Copy `src/skins/commerce/theme.test.ts`: it parses your `theme.css`,
computes WCAG ratios for your skin's text pairs in BOTH modes and asserts them.
Copy two habits from it as well, both earned: it locates each rule by an
**anchored, line-start** selector (an `indexOf(".theme-<id> {")` also matches
inside `.dark .theme-<id> {`, so reordering the file silently pointed every
light-mode assertion at the dark block), and it **derives** each pair's render
sites by grepping for the class pair rather than citing `file:line` — every
hand-written citation in the first version had rotted, which is how the wrong-ground
measurement above survived review.

## `layout.tsx`

Side-effect-import `./theme.css` here so the block loads when the skin mounts.
Style with the shared semantic utilities (`bg-canvas`, `text-ink`,
`border-hairline`, `bg-surface`, `text-brand`, …) so the skin reskins with the
theme. Read the active skin via `useSkin()`. Mirror `src/skins/logistics/layout.tsx`
— it is the debugged reference for the two non-obvious things this chrome MUST
get right:

- **Root is `h-full overflow-hidden` — not `h-screen`, not `min-h-screen` — and the
  `<aside>` is `h-full`.** This chrome fills the shell's app CARD, which the frame
  has already inset by its own padding, so a viewport-height root overflows the card
  by that padding. It must still be BOUNDED: if the container can grow past the card
  the whole document scrolls, the nav scrolls away with it, and `<main>`'s own
  `overflow-y-auto` goes inert because its parent is unbounded. `h-full
overflow-hidden` bounds it to the card so `<main>` scrolls INSIDE it.
- **The meta-utility strip is skin-authored chrome, not shell-provided.** A new
  skin gets no Reset / theme toggle / Help for free — you add them here (see the
  `mt-auto` group). Details in SKILL.md § "The meta-utility strip".

```tsx
"use client";
import "./theme.css"; // side-effect import registers the .theme-<id> block
import type { ReactNode } from "react";
import Link from "next/link";
import { HelpCircle, RotateCcw } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { ThemeToggle } from "@/components/ui/theme-toggle"; // SHARED shell component — importing it is fine
import { useAskCopilot } from "./components/use-ask-copilot"; // PORT this into your skin (see below)
import { cn } from "@/lib/utils";

// Sidebar width is yours alone — NOTHING in the shell reads it, so pick whatever
// your chrome needs. The skin switcher is a dropdown in its own card at the top of
// the assistant column, so it occupies a slot and can never overlap your nav; the
// `--nw-nav-inset-left` / `--nw-nav-inset-right` variables older skins published
// for the retired floating selector are gone. Do not add those publishers, and do
// not couple this constant to anything outside your own layout. (SKILL.md § "The
// layout contract".)
const SIDEBAR_WIDTH_PX = 240;

export function <Id>Layout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  // EVERY in-skin link goes through skinHref — never a hardcoded `/${skin.id}/…`.
  // Under LOCK_SKIN the deploy is served AT `/` with the skin segment gone from
  // the URL space, and a hardcoded prefix puts it straight back in the address
  // bar on the first nav click. See src/shell/skin-path.ts and src/proxy.ts.
  const skinHref = useSkinHref(skin.id);
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const Logo = skin.identity.logo;

  // BEAT 3b — the ROUTE readable. Without this the agent cannot tell which page
  // is open, so "what's on my screen?" answers identically everywhere and the
  // beat dies. Pages register their own readables for what is visibly rendered.
  //
  // Derive the segment RELATIVE to the skin base, or you report the skin id
  // instead of a page — the exact bug banking hit before its cutover, when this
  // read `pathname.split("/")[1]` and every page answered "banking".
  // useSkinSegments handles the base for you. Do NOT hand-roll it with a fixed
  // `.slice(2)`: that eats the first real segment on a LOCK_SKIN deploy, where
  // the pathname has no prefix to skip.
  const restHead = useSkinSegments(skin.id)[0] ?? "";
  useAgentContext({
    description: "The current page where the user is",
    // Name the INDEX page something meaningful, not "" — in banking `/banking`
    // IS the Credit Cards view, so it reports "cards".
    value: restHead === "" ? "<index page name>" : restHead,
  });

  // ⚠ Do NOT branch on `res.ok` ALONE. Your reset route wipes the store as its
  // FIRST act and nothing rolls that back, so a non-2xx (commerce's route 502s
  // when the memory wipe/re-seed fell short) still means THE STORE IS GONE. An
  // ok-only branch then alerts and stays put, leaving the page — and the agent's
  // readables, which describe that page — asserting rows that no longer exist,
  // and leaving any module-level client journal (see rule 4 below) reciting
  // writes the reset took away. Read what the BODY says about the store instead,
  // navigate on every outcome except a provably untouched one, and put the
  // route's own explanation in the alert: a bare "HTTP 502" drops the one
  // sentence saying the memory beats may start out already taught. Commerce's
  // `runPresenterReset` (src/skins/commerce/layout.tsx) is the worked version.
  const handleReset = async () => {
    if (!window.confirm("Reset demo state? This restores the seeded scenario.")) return;
    let res: Response;
    try {
      res = await fetch(`/api/${skin.id}/v1/dev/reset`, { method: "POST" });
    } catch (err) {
      // No response at all: an in-memory store whose server restarted mid-call
      // has already reset itself, so reload rather than trust the screen.
      window.alert(`Reset could not be confirmed: ${String(err)}. Reloading.`);
      window.location.assign(skinHref());
      return;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const reset = Array.isArray(body.reset) ? body.reset : null;
    // `false` only where the route answered BEFORE it mutated (the 403 gate).
    if (reset === null && typeof body.error === "string") {
      window.alert(`The demo was NOT reset (HTTP ${res.status}). Nothing has changed.`);
      return;
    }
    // Alert FIRST (it is modal, so it is read), then hard-navigate to the skin
    // root for a pristine slate (fresh store, cleared canvas, new thread on the
    // next message) AND the clean starting URL — `/` itself on a locked deploy.
    if (!res.ok) {
      window.alert(
        `Reset incomplete (HTTP ${res.status}). The demo data WAS reset; ` +
          `${String(body.memoryError ?? "see the server logs")}.`,
      );
    }
    window.location.assign(skinHref());
  };

  return (
    // h-full + overflow-hidden (NOT h-screen / min-h-screen): this chrome fills the
    // shell's app CARD, which is already inset by the frame's padding. Bounded to
    // the card so the nav stays pinned and <main> scrolls INSIDE it.
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-7 flex items-center gap-2.5 px-2 text-brand">
          <Logo className="h-7 w-7" />
          <span className="text-base font-bold tracking-tight text-ink">{skin.identity.brand}</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {skin.nav.map((route) => {
            const href = skinHref(route.segment);
            // Compare SEGMENTS, not the whole pathname: under a lock the href is
            // prefix-free while the matched route is not, so `pathname === href`
            // is not reliably true for the active entry.
            const active = restHead === route.segment;
            const Icon = route.icon;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                {route.label}
              </Link>
            );
          })}
        </nav>

        {/* Meta-utility strip — skin-authored chrome, pinned to the bottom.
            Reset is presenter-gated; the theme toggle is a dead control unless
            your theme.css also ships a dark palette (see `--nw-dark-capable`). */}
        <div className="mt-auto flex items-center gap-1 border-t border-hairline px-1 pt-3">
          {resetEnabled && (
            <button
              type="button"
              onClick={handleReset}
              aria-label="Reset demo state"
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <ThemeToggle />
          <button
            type="button"
            aria-label="Ask the copilot for help"
            onClick={() => void askCopilot("What can you help me with here? Give me a short list.")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
```

`useAskCopilot` (the Help control's handler) is **ported, not imported** — copy
`src/skins/logistics/components/use-ask-copilot.ts` into your own
`src/skins/<id>/components/`. A skin's only inbound dependency is the `Skin`
contract, so it must never reach into `src/skins/banking/**` or any other skin.
`ThemeToggle`, by contrast, lives in the SHARED `src/components/ui/` and is fair
to import directly. And keep the button and the endpoint in agreement: your
skin's `dev/reset` route should allow the reset when
`presenterResetEnabled() || process.env.NODE_ENV !== "production"` (mirror
`src/app/api/logistics/v1/dev/reset/route.ts`) — otherwise a production booth
shows a Reset button that 403s.

## `data/use-data.ts` (OPTIONAL → `useData`) — and you almost certainly want REST instead

⚠️ **No shipped skin sets `useData` any more, so this template is the only
reference for it and there is no worked example to open.** `ls
src/skins/*/data/use-data.ts` returns nothing. `airline` and `keel` held state this
way and both migrated onto their own REST ledgers; the
field is still live in the contract and the shell still runs it, but choosing it
today means choosing the shape every skin moved off.

**Two reasons they moved, both of which will bite a new skin the same way.**
(1) Beat 3d's whole claim is that the artifact belongs to the application and
survives deleting the thread — client state cannot make that true. (2) Anything
TIME-DEPENDENT held in client state becomes a second clock: keel ticked runs on a
900 ms `setInterval` while the server held them as state only, so the client painted
progress the server had never heard of and the next re-read after any write silently
rewound it. Time now settles server-side on every read
(`src/app/api/keel/v1/settle-runs.ts`) and the interval only re-fetches.

So: put your seed, types and pure derivations in `data/`, put the store behind
`src/app/api/<id>/v1/*`, and read it through one snapshot context
(`ledger-context.tsx`) — mirror any shipped skin. Set `useData` only for state that
is genuinely client-owned and genuinely shell-managed. When it is omitted (the norm),
`useSkinData<T>()` returns `undefined`.

```ts
"use client";
import { useState } from "react";

const SEED = [/* seed rows */];

export function use<Id>Data() {
  const [items, setItems] = useState(SEED);
  return { items, setItems };
}
export type <Id>Data = ReturnType<typeof use<Id>Data>;
```

### REST-backed instead? Five rules for your write paths

A REST-backed skin replaces the hook above with a ledger CONTEXT that holds one
snapshot and exposes a `refresh()` every write path calls after its mutation
(`src/skins/commerce/data/ledger-context.tsx` is the worked example). Every one of
these fails **silently** if you skip it, and none is caught by lint, tsc or a
test you would think to write:

1. **Guard every `setState` behind a provider-lifetime liveness ref.** The shell
   remounts the entire runtime subtree keyed by skin id, so switching skins in the
   selector unmounts your provider while a mutation's `refresh()` is still in
   flight. That is routine operation, not a rare race. One `useRef(true)` cleared
   by the mount effect's cleanup covers the mount fetch AND `refresh`.
2. **Type it `Promise<boolean>`, not `Promise<void>`.** A `refresh()` that
   resolves regardless of whether the re-read succeeded lets every caller print
   "done" over pre-mutation rows — the one failure mode indistinguishable from a
   slow network. Resolve `true` only when a snapshot was actually committed, and
   have callers say so when it is `false`: pages via their inline error slot or a
   one-line notice, tool handlers by appending it to the string they return (see
   commerce's `staleNote`). Do NOT reject — the callers `await` it bare, so
   rejecting turns a dev-server restart into a dozen unhandled rejections and a
   blank app mid-demo.
3. **Check `res.ok` BEFORE you call `refresh()`, on every write path.** A
   `refresh()` after a refused write repaints the identical rows, so a real 409 or
   422 is indistinguishable from a slow network — and every one of these controls
   is something a presenter clicks on stage. Surface the route's own `message`
   (your `errorResponse` map writes them to be read by a human) and fall back to a
   status-bearing sentence, then `return` without refreshing. Note this is a
   DIFFERENT report from rule 2's: refused means nothing happened, stale means the
   write landed and only the view is behind. Four of commerce's page write paths
   shipped without this check while three others in the same files had it —
   nothing type-checks the difference, so grep your own pages for
   `await fetch(` and confirm each hit branches on `res.ok`.
4. **`res.ok` is only HALF of the failures — catch the REJECTED fetch too.**
   `fetch` rejects outright when the browser is offline, the connection drops, or
   the dev server restarts mid-call, and `!res.ok` never runs. In a page handler
   that is an unhandled rejection and a button that never recovers; in a TOOL
   handler it is worse — the throw escapes the handler, so the agent receives no
   result for that step AT ALL and cannot narrate it. Every one of commerce's
   seven write handlers shipped checking `res.ok` and nothing else, and the same
   grep as rule 3 passed on all seven.

   Write it ONCE as a wrapper and route every handler through it —
   `narrateWrite` in `src/skins/commerce/settle.ts` is the worked example, tested
   in `write-failures.test.tsx`. Seven hand-written try/catches is how the eighth
   handler ships without one. The wrapper must distinguish three outcomes, not
   two: the write never landed, the write landed and only the follow-up broke
   (report the SUCCESS — a failure line over a write that really happened is the
   mirror-image lie), and the server refused it. And make the receipt's TONE
   follow the line: a failure sentence under a green tick is the same as showing
   no error, because from the back of a room the tick is what registers.

   If a beat is a CHAIN of writes against one record — commerce's beat 5 holds
   the order, posts the note, then notifies the customer — a failure on step two
   leaves the ledger half-mutated. Say so: "held the order, but could not post
   the note" is both more useful on stage and more honest than a bare failure.
   Commerce keys a small module-level journal by record id for exactly this
   (`landedWritesOn`); it is safe to leave unbounded only because the presenter
   reset CLEARS IT EXPLICITLY and then hard-navigates (a real document load drops
   the module too). Both halves, and unconditionally: relying on the navigate
   alone was a bug, because the reset can wipe the store and answer non-2xx, and
   the old handler only navigated on `res.ok` — so on exactly those paths the
   journal outlived the ledger and the next failure recited writes that were
   reset away.

5. **A control that writes must not be RE-ENTRANT, and must only clear what the
   user typed on a path that SUCCEEDED.** Two halves of one mistake, and the
   teach-mode page is where both hurt most, because that is the surface a
   presenter is clicking live.

   A button with no in-flight guard fires twice on a double-click. Your store
   almost certainly settles each record once — commerce refuses the repeat with
   `ALREADY_FINALIZED` / `ALREADY_DECIDED` — so rule 3 dutifully paints that
   refusal on a card whose action **just succeeded**, and the presenter is told
   the thing they did failed. Guard it with a ref, not only `useState`: the state
   is what renders "Finalizing…" and `disabled`, and the ref is what makes the
   guard a mutex regardless of whether a lever remembered `disabled`. And guard it
   in a `try/finally`: a rejecting `fetch` that skips the release latches the
   button on "Issuing…" for the rest of the demo, with no way back but a reload.
   `useInFlight` in `src/skins/commerce/components/use-in-flight.ts` is the worked
   example — and it is in `components/`, not in a page, for a reason worth
   copying: it first lived inside `pages/promotions.tsx`, a hook exported from a
   PAGE does not read as importable, and the second page that needed one grew a
   weaker `useState`-only copy with no mutex and no `finally` instead. Put shared
   guards where a second page can plausibly import them.

   **Mount an instance no finer than the MESSAGE CHANNEL its writes share.** A
   per-button or per-surface mutex is no help when two controls report into one
   error slot: whichever write finishes last speaks for both, so a refusal gets
   erased by an unrelated success and the refused write says nothing at all — the
   same silent no-op, reached through the report instead of the request. Commerce
   needed BOTH halves: one instance per promotion card (its four levers write one
   record) plus a separate message slot per surface (decision vs waiver), and one
   instance per RETURNS page, because every decision there reports through the
   page's single notice.

   Note the rule cuts both ways — coarser is not automatically safer, and "one per
   page" is not the answer, the CHANNEL is. The orders queue's two levers report
   about a single ROW, so they share that row's guard and that row's slot, and a
   different row's write may proceed: a page-wide slot there meant one row's
   success cleared another row's refusal, and a page-wide guard would have blocked
   a write that could never have spoken for it. Split the slot per record FIRST,
   then mount the guard to match it.

   The other half: a write helper that reports refusal by RETURNING (rule 3) will
   also return on the path where the caller then does `setInput("")`. So a refused
   filing wipes the sentence the user typed and they retype it on stage. Have the
   helper resolve `Promise<boolean>` — "did this write LAND", which is NOT rule
   2's "and the view is current" — and clear typed state only inside
   `if (landed)`. A validation refusal is not exotic: commerce's justification has
   a server-side minimum length (`INVALID_JUSTIFICATION`, 422) that no input
   attribute enforces, so the ordinary too-short filing takes that path.

   And the case that is neither: a write that LANDED whose follow-up `refresh()`
   did not. That is not a refusal, and a control that reads it as one re-arms
   itself and invites the write a second time — on a money path, a second refund
   for money that already moved. Report it the way `settle.ts`'s
   `STALE_VIEW_NOTE` / `staleNote(refreshed)` does, as "it happened, and the page
   is behind", and LOCK the control rather than re-arming it: on a failed re-read
   the row still shows its old status, so the control is still on screen.

   Testing it: jsdom does **not** dispatch a click to a `disabled` button, so a
   rendered double-click only ever proves the visible half. Test the guard hook
   directly with `renderHook` for the mutex
   (`src/skins/commerce/components/use-in-flight.test.tsx`), and drive the
   rendered page with a `fetch` you settle by hand for the rest — see
   `src/skins/commerce/pages/promotions.test.tsx`,
   `src/skins/commerce/pages/returns.test.tsx` and
   `src/skins/commerce/pages/orders.test.tsx`, which cover the double-click, the
   rejecting fetch, the landed-but-stale write, and erasure both across surfaces
   and across rows. Watch the ledger mock while you are there: `refresh` is
   `Promise<boolean>`, `vi.mock` does not type-check the factory against the real
   module, and a mock returning `Promise<void>` sends every write down the
   stale-view branch with the happy path still green.

## `pages/<page>.tsx`

One component per nav segment. Read the skin's data via `useSkinData<T>()`.

**Each page registers its own on-screen readable** (beat 3b). The route readable in
`layout.tsx` says _which_ page is open; this says _what is on it_ — the active
filters and the rows actually rendered after filtering and sorting, not the whole
data set. That distinction is the beat: the agent describing what the user can
literally see. Mirror `src/skins/banking/pages/charges.tsx:139`.

**Every list in the readable must be the same expression the panel renders.** Derive
each visible list ONCE — `const visible = useMemo(…)`, `const visibleNotifications =
useMemo(() => data.notifications.slice(0, NOTIFICATION_ROWS), …)` — and hand that one
array to both the JSX and `useAgentContext`. Two independent slices of the same source
is how commerce's Orders page came to send five notifications while rendering six: the
agent then confidently describes a screen the presenter is not looking at, off by one
row, which is the version of wrong that survives a live demo. Mirror
`src/skins/commerce/pages/orders.tsx` (its `visible` / `visibleNotifications` pair and
`orders.test.tsx`, which asserts the readable equals the DOM).

**Every COUNT obeys the same rule as every list.** A "Top N of X" caption's
denominator, and any total you send the agent, must come off that same derivation —
publish `matching` (levers applied) and `visible` (truncated) from one `useMemo` and
read both. Whole-collection figures may stay whole-collection, but then label them as
such on screen and nest them under a scoped key (commerce uses `book: { … }`) so the
agent cannot report them as the contents of the view. See demo-beats.md § 3c.

```tsx
"use client";
import { useAgentContext } from "@copilotkit/react-core/v2";
// The REST path, which is what every shipped skin does: ONE `GET /ledger`
// snapshot shared through your own context. Only reach for
// `useSkinData<<Id>Data>()` from "@/shell/skin-provider" if you set `useData`,
// which nothing currently does — and then guard the `undefined`.
import { use<Id>Ledger } from "../ledger-context";

export function <Id>HomePage() {
  const data = use<Id>Ledger();
  const visible = /* the rows actually rendered, after filter + sort */ [];

  // BEAT 3b — what is VISIBLY on screen right now, not the whole data set.
  useAgentContext({
    description:
      "The <Page> page the user is currently viewing: the active filters/sort " +
      "and the visible rows, in the order shown.",
    value: JSON.stringify({
      page: "<segment>",
      filters: {
        /* the live filter/sort state */
      },
      visibleCount: visible.length,
      // The SAME expression the panel renders — never a second slice of the same
      // source. If a list on screen is truncated, truncate it ONCE, above, and
      // let both the JSX and this readable map that one array.
      rows: visible,
    }),
  });

  return <div>{/* render domain UI from `data` */}</div>;
}
```

## `tools.tsx`

Renders `null`. Register frontend tools / HITL / gen-UI components and
`useAgentContext` readables here (all from `@copilotkit/react-core/v2`). Mirror
`src/skins/logistics/tools.tsx` for the wiring and
`src/skins/banking/tools.tsx` for the beats — between them they are the debugged
reference for the five things this file MUST get right.

**1. Every registration closes with a deps array.** `useComponent`,
`useFrontendTool`, and `useHumanInTheLoop` each take an **optional deps array as
a second argument** (`useFrontendTool(tool, deps?: ReadonlyArray<unknown>)`,
`useHumanInTheLoop(tool, deps?)`, `useComponent(spec, deps?)` — see the installed
types in `@copilotkit/react-core/dist/copilotkit-CBCT7BlL.d.cts`). Omit it and
the render/handler closure captures whatever the data was at REGISTRATION time —
for a REST-backed skin, the EMPTY array from before the first fetch — **forever**.
This is the worst class of bug because it **compiles, lints, and passes every
test**: the agent narrates confidently ("the trade-offs are on screen") while the
component renders its "not found" branch over stale/empty data. Banking documents
the same trap in a code comment (search "closure captures empty arrays" in
`src/skins/banking/tools.tsx`). Pass the data each closure reads.

**2. A parameterized `useComponent` render receives the schema output DIRECTLY.**
`render: ({ myParam }) => …` — NOT `{ args }`. Per the installed types,
`InferRenderProps<T> = T extends StandardSchemaV1 ? InferSchemaOutput<T> : any`
and `render: ComponentType<NoInfer<InferRenderProps<TSchema>>>`. By contrast
`useHumanInTheLoop` and `useFrontendTool` renders DO receive `{ args, status,
respond }`. Do not copy the HITL `{ args }` shape into a `useComponent`.

It also receives that output **UNVALIDATED** — the schema is documentation, and a
render-only tool posts an empty tool result, so there is nothing to correct the
model with. Enumerate any closed-set parameter (`z.enum(YOUR_CONST_TUPLE)`) AND
resolve it in the render, saying plainly that the value is unknown rather than
drawing an empty visual. See SKILL.md's gen-UI enforcement rule and commerce's
`src/skins/commerce/category-argument.ts`. **Except a beat-6 gate's unlock codes**
— that one closed set stays a free `z.string()`, because enumerating it hands the
agent the procedure it is supposed to learn (failure-modes.md § 10).

And it receives that output **INCOMPLETE**: arguments STREAM, `partialJSONParse`
returns `{}` for the first frames of every call, so each field — required ones
included — is `undefined` in some of the renders it appears in. Never dereference
one bare (`orderIds.map(…)` is a TypeError inside React render; banking guards the
same shape with `columns ?? []` / `rows ?? []` at `banking/tools.tsx:793-794`) and
never format an absent one into a confident label. Draw a visible arriving card
instead — `ArrivingCard` / `arrivedText` in `src/skins/commerce/tools.tsx` — and
keep the confident branch for values that actually landed. See SKILL.md's
"EVERY argument is `undefined` mid-render" rule.

**3. Renders must be REPLAY-SAFE — key them off `result`, not `status`** (beat 2).
Reopening a thread replays recorded tool calls: you get the stored `result` and no
live status transition. A render keyed on `status` is perfect live and blank or
wrong on revisit — precisely when "reload and it's still there" is being demoed.
Banking, people and commerce are the only skins written this way — banking at
`tools.tsx:70-89`, `418-451`, `553-572`; people's `setBaseSalary` render at
`tools.tsx` recovers from an `answeredSalaryChanges` module map that holds the
person's NAME and nothing else, so a replayed card can rebuild itself without
the salary ever having been stored.

**4. Every write handler must END IN A RESULT on all three paths** — success,
refusal, AND a `fetch` that rejected. A handler that only checks `!res.ok` throws
straight out when the browser is offline or the dev server restarts mid-call, and
the agent then gets no result for that step at all: it cannot narrate it, and the
transcript has no record that it was attempted. On a chained beat that is a
half-mutated ledger with one visible receipt, one vanished write, and no error
anywhere. Route every handler through ONE wrapper rather than seven try/catches —
`narrateWrite` in `src/skins/commerce/settle.ts`, with rule 4 of the REST write-path
rules above for the full contract, and `write-failures.test.tsx` for the coverage
your own skin needs.

**5. Readables must make the agent PAGE-AWARE** (beat 3b). Global readables
(who the user is, the whole data set) are not enough: "what's on my screen?"
returns the same answer everywhere without a **route** readable in `layout.tsx`
plus **per-page** readables describing what is visibly rendered. Register the
on-screen ones inside the page components, close to the state they describe —
banking's richest is in `charges.tsx:139`, emitting the page name, active
filters, visible row count and the first 25 visible rows.

**5. A capped gen-UI list must SAY what it withheld.** Capping a chat list is
right — it keeps the transcript readable. Capping it silently is not: the list
renders as though it were the whole answer. The trap is worse than a missing row
whenever the list is GROUPED, because the cap then eats trailing GROUPS whole and
a group that vanished is indistinguishable from a group with nothing to report.
Commerce's `showMarginSummary` shipped `rows.slice(0, 12)` over a 14-SKU range
grouped by category and dropped both Outerwear SKUs, one of them below its margin
floor — an omission that read as an all-clear. Surface the withheld count, the
exceptions among them, and any group that disappeared, by name. Mirror
`src/skins/commerce/margin-summary.ts` (`selectSummaryRows`, pure and tested
apart from the component) plus `MarginSummaryList` in `src/skins/commerce/tools.tsx`.
Rank exceptions FIRST so the cap can only ever withhold clean rows.

```tsx
"use client";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { use<Id>Ledger } from "./ledger-context";

export function <Id>Tools() {
  // Read the SAME snapshot the pages and the canvas read, so the agent and the
  // screen can never describe two different worlds. That is the REST path every
  // shipped skin takes. If instead your skin sets `useData`, read it with
  // `useSkinData<<Id>Data>()` from "@/shell/skin-provider" — and never feed that
  // raw into useAgentContext, because it is `undefined` for every skin that omits
  // the field (i.e. all of them today).
  const data = use<Id>Ledger();

  useAgentContext({
    description: "<what the agent should know>",
    value: JSON.stringify(data ?? {}), // ?? {} — guard the not-yet-loaded case
  });

  // Gen-UI, NO parameters → render takes no schema arg.
  useComponent(
    {
      name: "showThing",
      description: "Display the current thing.",
      render: () => <div className="text-ink">{/* render from `data` */}</div>,
    },
    [data], // ← deps: re-register when data changes, or the closure captures stale data
  );

  // Gen-UI, PARAMETERIZED → render receives the schema output DIRECTLY, not { args }.
  useComponent(
    {
      name: "showThingById",
      description: "Display one thing by id.",
      parameters: z.object({ id: z.string().describe("The thing's id.") }),
      // `id` is `undefined` while the arguments stream — a required field is no
      // guarantee of a present one. Draw the arriving state, never a miss and
      // never a bare dereference.
      render: ({ id }) =>
        typeof id === "string" && id.trim() ? (
          <div className="text-ink">{/* look `id` up in `data` */}</div>
        ) : (
          <div className="text-ink-muted">Looking that up…</div>
        ),
    },
    [data],
  );

  // Frontend tool (a write) → render receives { name, toolCallId, args, status,
  // result } (a discriminated union; `result` is defined only when Complete).
  //
  // REPLAY-SAFE: key the finished state off `result`, NOT off `status` (beat 2).
  // On thread reopen you get the recorded result and no live status transition,
  // so a status-keyed render goes blank exactly when someone revisits the thread.
  useFrontendTool(
    {
      name: "doThing",
      description: "Do the thing.",
      parameters: z.object({ id: z.string() }),
      // Return everything the render needs to rebuild itself from history — but
      // NEVER a secret (beat 3a): whatever you return is stored in the thread.
      handler: async ({ id }) => `Did the thing to ${id}.`,
      render: ({ result, args }) =>
        result ? (
          // Give the audience something to SEE (beat presentation rule): a badge,
          // a forced emoji prefix, a highlight ring — not just the word "Done."
          <div className="text-ink">✅ {result}</div>
        ) : (
          // `args.id` streams too, so name it only once it is there — "Working on
          // …" with the id missing is the same absent-value formatting.
          <div className="text-ink-muted">
            {args?.id ? `Working on ${args.id}…` : "Working on it…"}
          </div>
        ),
    },
    [data], // ← deps here too
  );

  return null;
}
```

`ToolCallStatus` is still the right import when you genuinely need the in-flight
distinction (`InProgress` vs `Executing`); just don't make the **completed** state
depend on it.

## `catalog/index.tsx`

Minimal (no a2ui report surface): pass empty definitions/renderers. For a real
catalog with Zod definitions + React renderers, mirror
`src/skins/airline/catalog/index.tsx`.

```ts
import { createCatalog } from "@copilotkit/a2ui-renderer";

export const <id>Catalog = createCatalog(
  {}, // component definitions (Zod-schema props)
  {}, // renderers
  { catalogId: "<id>", includeBasicCatalog: false },
);
```

## `suggestions.ts` — ONE PILL PER BEAT, IN DEMO ORDER

The pills ARE the demo script. The presenter must never have to type: "make sure
that the bubbles are in there so I never have to type, I could just click." This
is also a correctness measure — free-typed phrasing routes to the wrong tool
(saying "spending **report**" instead of "trend" sends banking to the canvas
report tool instead of the in-chat chart). Keep the beat map from
[demo-beats.md](./demo-beats.md) in a comment at the top so the mapping can't rot.

**Derive the count from the beat map, never from a target number.** The arithmetic
is in [demo-beats.md](./demo-beats.md) § "Presentation requirements" — that is the
one authority; do not re-derive it here. `people` and `commerce` write the mapping
out in their `suggestions.ts` headers, so read one of those before writing yours,
and check what any skin actually ships with
`grep -c 'title:' src/skins/*/suggestions.ts`.

**Copy the coverage, never the count.** Every shipped skin is demo-complete and no
two agree on a number, so a count predicts nothing in either direction. The skin
with the MOST pills got there by keeping four identity pills that predate the beat
list, not by hitting more beats — its header shows the arithmetic. Do not calibrate
against any of them; calibrate against your own beat map.

```ts
import type { Suggestion } from "@/shell/skin-contract";

// Shared with `onSuggestionSelect` in skin.tsx so the match can never drift
// (beat 3d — the framework's suggestion path drops attachments, so the pill that
// carries a file has to be intercepted by exact message match).
export const <ID>_ATTACHMENT_MESSAGE =
  "<the prompt that must ride along with the staged file>";

// Beat map — keep in sync with the demo:
//   1  face          → pill 1
//   2  rich thread   → no pill (reload + reopen a thread)
//   3a drive the app → pill 2
//   3b sees screen   → pill 3 (click it on TWO different pages)
//   3c levers        → pill 4
//   3d multimodal    → pill 5 (intercepted, stages the file)
//   4  memory        → pill 6
//   5  stored skill  → pill 7
//   6  teach a skill → pill 8
//   (canvas)         → pill 9, ONLY if the brief needs its own ask. banking has
//                      a CanvasSurface and no such pill — its pill 5 files the
//                      brief as well. people and commerce do add pill 9.
export const <id>Suggestions: Suggestion[] = [
  // 1 — lead with generative UI, never a wall of text.
  { title: "<show the headline visual>", message: "<...>" },
  // 3a — a mutation whose secret never reaches the assistant.
  { title: "<change the sensitive thing>", message: "<...>" },
  // 3b — ask it on one page, navigate, ask it again.
  {
    title: "What's on my screen?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  // 3c — HITL confirm, then navigate + sort + filter, visibly highlighted.
  { title: "<the complicated maneuver>", message: "<...>" },
  // 3d — intercepted in skin.tsx; stages the bundled file.
  { title: "<produce the artifact>", message: <ID>_ATTACHMENT_MESSAGE },
  // 4 — recalls a seeded preference AND names it.
  { title: "<the format-sensitive question>", message: "<...>" },
  // 5 — one vague sentence replays a seeded procedure.
  { title: "<I don't recognize this — handle it>", message: "<...>" },
  // 6 — the gated action it does NOT know how to do yet.
  { title: "<the gated action>", message: "<...>" },
];
```

## `design-skill.ts`

```ts
export const <ID>_DESIGN_SKILL =
  "OGUI design brief: describe the visual language for generated UIs " +
  "(palette, shapes, tone). Injected as agent context.";
```

## `providers.tsx` — OPTIONAL (`Providers` / `RuntimeProviders` / `useRuntimeProperties`)

Only if your skin needs extra providers. Two distinct slots live here (mirror
`src/skins/banking/providers.tsx`):

- **`Providers`** mounts **below** `CopilotKitProvider` — for providers that
  _consume_ the CopilotKit context (e.g. tools registered from context).
- **`RuntimeProviders` + `useRuntimeProperties`** mount **above**
  `CopilotKitProvider` — the sanctioned way to contribute end-user identity /
  runtime `properties`. Use these ONLY if your skin scopes Intelligence runs or
  durable memory per end-user; a skin with its own auth needs them (there is no
  other correct place to source `properties` — a child racing `setProperties`
  after mount is exactly the bug they exist to prevent). Pair them with a
  server-safe `identifyUser` (below). Omit all three if you don't need them.

```tsx
"use client";
import { useMemo, type ReactNode } from "react";
// import { <Id>AuthProvider, use<Id>Auth } from "./components/auth-context";

// Below CopilotKitProvider — providers that consume the CopilotKit context.
export function <Id>Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// Above CopilotKitProvider — establishes the context useRuntimeProperties reads.
export function <Id>RuntimeProviders({ children }: { children: ReactNode }) {
  // return <<Id>AuthProvider>{children}</<Id>AuthProvider>;
  return <>{children}</>;
}

// Threaded into CopilotKitProvider's `properties` prop by the shell. Return a
// STABLE/memoized object; do NOT set `a2uiCatalogAvailable` (the shell adds it).
export function use<Id>RuntimeProperties(): Record<string, unknown> | undefined {
  // const { user } = use<Id>Auth();
  return useMemo(() => ({ /* userRole, userId */ }), [/* user?.role, user?.id */]);
}
```

## `intelligence/user-id.ts` — OPTIONAL, SERVER-ONLY identity resolver

Only if your skin scopes per-user memory. Reached through the **server-only**
`agent-registry.ts`, so it MUST be server-safe: **no `"use client"`, no JSX, no
`.tsx` imports.** Mirror `src/skins/banking/intelligence/user-id.ts`.

```ts
// server-safe: plain .ts, no "use client", no JSX
import type { IdentifyRunUser } from "@/shell/agent-registry";

export const <id>IdentifyUser: IdentifyRunUser = (properties) => {
  const userId = properties?.userId ?? "<id>-demo-user";
  return { id: userId, name: properties?.userRole ?? "<Brand> User" };
};
```

## `intelligence/seed-memories.ts` — REQUIRED for beats 4 and 5

"It already knows me" is a **file**, not emergent behaviour. Mirror any of the
ones already in the repo — `ls src/skins/*/intelligence/seed-memories.ts` names
them; `src/skins/commerce/intelligence/seed-memories.ts` is the newest and the
one with tests beside it. Every set of comments is worth reading in full, and
they do not all say the same thing: banking scopes its procedure `project` and
the later ones scope it `user`, for a reason each file states.
Server-safe plain `.ts`.
Called by your `dev/reset` route immediately after wiping memories, so the demo
is re-armed before the presenter says a word.

Three design rules, each learned the hard way:

- **Seed a standing PREFERENCE, not a fact** (beat 4). "Alex's favourite food"
  proves storage; "group spend by team, over-limit first, rounded to whole
  dollars" proves _applied_ learning, because recall visibly changes the answer to
  a question the user never re-explained.
- **The procedure must run FULLY AUTOMATICALLY — no confirmation gate** (beat 5).
  Banking's note step used to open an approval card; if the presenter moved on
  without answering it, that tool call sat unresolved and the **next message
  failed the whole thread** with `Tool result is missing for tool call ...`. A
  procedure with no half-finished state has nothing to leave behind. Put "run all
  of them immediately, in order, without asking for confirmation" in the memory
  text itself.
- **Keep beat 5's procedure and beat 6's DISJOINT, and never seed beat 6's.**
  Seeding the teachable one means the agent already knows the answer and never
  offers to record — the entire teach arc vanishes.

```ts
// server-safe: plain .ts, no "use client", no JSX
export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
  /** Per-request timeout. NOT optional in spirit — see the note below. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

interface SeedMemory {
  kind: "topical" | "episodic" | "operational";
  scope: "user" | "project";
  content: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    // BEAT 4 — a standing preference, so recall CHANGES the answer.
    kind: "topical",
    scope: "user",
    content:
      "<Name> prefers <the format/ordering/rounding preference>, so answers " +
      "should apply it without being asked.",
  },
  {
    // BEAT 5 — a PROCEDURE, so recall produces visible ACTION (several tool
    // calls in a row) rather than a reformatted answer. Disjoint from beat 6's.
    kind: "operational",
    scope: "project",
    content:
      "Procedure for <the beat-5 situation> (NOT for <the beat-6 situation>): " +
      "(1) <first tool>, (2) <second tool>, (3) <third tool, with the visible " +
      "affordance — e.g. prefix the note with 🚨 so it stands out>. Run all " +
      "three immediately, in order, without asking for confirmation, then " +
      "confirm what was done in one short sentence.",
  },
  // DO NOT seed beat 6's procedure. That one is taught live on stage.
];

/**
 * Write the seed memories for one identity; returns how many were STORED.
 * Never throws — a booth reset must still restore the data store even if the
 * memory backend is unhappy, so failures are counted, not propagated.
 *
 * ⚠ Because it never throws, a `try`/`catch` in your reset route learns NOTHING
 * from it. The returned count is the only signal, so the CALLER must compare it
 * against the expected total — see "⚠ Check the seeded count" below.
 */
export async function seedMemories(
  params: SeedMemoriesParams,
): Promise<number> {
  const { apiUrl, apiKey, userId, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
  const base = apiUrl.replace(/\/$/, "");
  let stored = 0;

  for (const memory of SEED_MEMORIES) {
    try {
      const res = await fetch(`${base}/api/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Cpki-User-Id": userId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(memory),
        // BOUND EVERY MEMORY FETCH. A reset sweeps and re-seeds several buckets
        // serially inside ONE request; one wedged POST with no signal leaves the
        // presenter's Reset button spinning with no way out.
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) stored += 1;
      else console.error(`[seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
```

Seed the memories against the **same identity your `identifyUser` asserts** for
the default demo user, or the agent's own `recall_memory` will not find them.
Banking pairs this with `intelligence/forget-memories.ts` so `dev/reset` can wipe
learned memories and then re-seed these — see SKILL.md § "The meta-utility strip"
and demo-beats.md § "Presentation requirements".

### ⚠ Copy `forget-memories.ts` from COMMERCE, not from banking or people

Several skins have one (`ls src/skins/*/intelligence/forget-memories.ts`), but they
are NOT interchangeable: only `src/skins/commerce/intelligence/forget-memories.ts`
and the `logistics` copy taken from it stop the clear from reporting success it has
not earned. The banking/people copies still do all four of the following, and every
one of them fails SILENTLY behind an `ok: true` reset:

- **They throw on the first non-ok DELETE, including a 404.** A 404 only means the
  row is already gone — the end state you wanted — yet it abandons the current
  bucket AND every bucket after it.
- **They treat one bare `GET /api/memories` as exhaustive.** The list envelope has
  no cursor and the path rejects query strings, so pagination cannot be probed:
  verify instead — list → delete → **list again**, and only claim success when a
  pass comes back with nothing deletable.
- **They cast the envelope (`as MemoriesListResponse`).** When the shape changes,
  the failure surfaces as `Cannot read properties of undefined (reading 'filter')`
  — a message that names no layer at all. Validate and throw with your own prefix.
- **No `AbortSignal` on any memory fetch.** Same reason as the seed template above.

Return enough for the caller to tell COMPLETE from PARTIAL (commerce returns
`{ forgot, alreadyGone, skippedProjectScoped, failed[], passes, complete,
incompleteReason? }`) and make your `dev/reset` route report `ok: false` when the
sweep says `complete: false`. A reset that says it cleared memory and did not is
the one bug that makes beats 4–6 prove nothing while looking perfect.

### ⚠ Do NOT hardcode the bucket list in your `dev/reset` route

Your reset forgets and re-seeds a SET of user ids. Write that set down anywhere
other than `user-id.ts` and it will disagree with what `resolveUserId` actually
returns — and **every way it can disagree is silent**: the reset returns
`ok: true` with a plausible `forgot` count, recall reads an empty bucket, and a
procedure taught in beat 6 survives into the next run.

Two ways it drifts, both of which shipped in commerce before being fixed:

- **A pinned `INTELLIGENCE_USER_ID` wins inside `resolveUserId`**, and
  `playwright.config.ts` pins it (to banking's `jordan-beamson`). So under e2e
  your runs read and write BANKING's bucket while your reset scrubs your own
  `<brand>-*` buckets — beats 4/5 recall nothing and beat 6 starts out taught.
- **An operator in your roster but absent from your identity map** resolves to a
  `<brand>-<role>` slug that a hand-written list does not contain.

Have the reset ASK your identity module instead. Commerce is the worked example
(`src/skins/commerce/intelligence/user-id.ts`): `memoryScopeUserIds()` and
`memorySeedTargetUserIds()` build their sets by calling `resolveUserId` over every
identity input the runtime can present (derived from the operator roster in
`data/seed.ts`), so a pin collapses both onto the pinned bucket automatically.
Both are FUNCTIONS, not module constants — a constant would freeze whatever the
env was at import time, which is how the pinned case got missed. Guard it with a
drift test that asserts the reset's set equals what `resolveUserId` can produce
INCLUDING the pinned case: `src/skins/commerce/intelligence/user-id.test.ts`.

### ⚠ Check the seeded count in your `dev/reset` route

`seedMemories` above **never throws**: it counts stored rows and logs the rest. So
a reset route that wraps it in `try`/`catch` and then returns
`{ ok: true, reset: ["store", "memory"] }` reports success **on a backend that
rejected every single POST** — `seeded: 0` sits in the body, unread, and the
presenter walks on stage believing beats 4/5 are armed. This shipped in commerce.

The expected count is KNOWABLE, so compare against it rather than reporting
whatever happened:

```ts
const expectedSeeds = seedTargets.length * SEED_MEMORIES.length;
// "seeded" only when every memory landed in every bucket; otherwise
// "partial" / "failed" — and NOT `reset: ["store", "memory"]`, because a wipe
// with no re-seed leaves the demo unarmed.
```

Return a non-2xx (commerce uses **502** — the upstream memory API is the failing
dependency) for **both** partial and total shortfalls. The degree belongs in the
body (`memory`, `seeded`, `expectedSeeds`), not the status line, because the only
caller — your sidebar Reset button — branches solely on `res.ok`, and a partial
seed must alert exactly as loudly as a total one: a shortfall does not say WHICH
memory is missing, and beat 4's preference and beat 5's procedure are independent.

**Keep every Intelligence SECRET out of every response body.** Log them — commerce
`console.warn`s the backend and the exact bucket ids before mutating anything, so
a human debugging a reset can see which of this repo's several vendored stacks was
about to be touched — but do NOT echo them back to the caller. Commerce used to
return the address as `apiUrl` in every response, success and failure alike, and
this route is gated only by `PRESENTER_RESET_ENABLED` / `NODE_ENV`: a demo
convenience, not an authorization boundary, so a booth deployment handed its
internal backend address to anyone who could reach the box. Nothing consumed it —
the sidebar button branches on `res.ok` alone.

Dropping the field is only half of it: two body fields carry text your route did
not compose (an `Error.message` in your `catch`, and the wipe's
`incompleteReason`, which quotes the backend's own response body — and a 401
payload is exactly the response that echoes the key it rejected). Scrub those on
the way out with **`redactSecrets` from `src/lib/redact-secrets.ts`**, which
derives its needle set FROM THE ENVIRONMENT and takes the text alone:

```ts
import { redactSecrets } from "@/lib/redact-secrets";

memoryError: redactSecrets(detail),
forgetShortfalls: forgetShortfalls.map((s) => redactSecrets(s)),
```

Do NOT write your own, and do NOT reintroduce the shape commerce's first attempt
had — `redactBackend(text, apiUrl)`, a redactor handed the ONE value to scrub. It
was correct about the address and silent about the API KEY, which was never passed
to it, so a 401 body echoing the credential travelled to the caller through a
field that was being sanitized. It also missed `URL.hostname` (the PORTLESS host,
which `getaddrinfo ENOTFOUND …` names and which is a substring of neither the raw
URL nor `URL.host`). A secret the redactor was never handed is a secret it cannot
remove; add yours to `ENV_SECRETS` in that module instead, and every existing
caller is covered at once.

The presenter still needs to know memory failed and roughly why — `memory`,
`memoryError`, the counters — never where the backend lives or what opens it. Each
placeholder names its secret (`<intelligence-backend>`, `<intelligence-api-key>`),
so a redacted reason still diagnoses.

**Hold the `catch` path to the same standard**, because it is the one path nobody
exercises until it fires on stage. Keep every accumulator (`forgot`, `seeded`,
per-bucket loop counters, wipe shortfalls) declared OUTSIDE the `try` and report
them, rather than inferring memory state from one number: commerce's catch used to
answer `reset: forgot > 0 ? ["store","memory"] : ["store"]`, which told the "memory
is armed" lie whenever the wipe ran and the seed loop did not — and, with
`forgot === 0` (a bucket that was legitimately EMPTY, i.e. the second reset in a
row), read as "memory untouched". A throw can never earn `"memory"` in `reset`:
memory counts as reset only when it was wiped AND fully re-seeded. Count the
buckets each loop got through, since `forgot`/`seeded` are 0 both when a loop never
ran and when it ran over empty buckets.

Worked example plus its red-green coverage:
`src/app/api/commerce/v1/dev/reset/route.ts` and `route.test.ts`.

### ⚠ Make your identity map a `Map`, not a plain object

The same prototype-chain hazard as the `PAGES` table above applies to the
operator→identity map inside `user-id.ts`, and it bites harder here. Its key is
`properties.userId`, forwarded by the client and therefore untrusted. With a plain
object, `operatorId && IDENTITY[operatorId]` resolves TRUTHY for `"toString"`,
`"constructor"`, `"valueOf"`, `"__proto__"`, … — and `.userId` / `.userName` on the
inherited member is then `undefined`, so `identifyUser` hands Intelligence an
`undefined` memory bucket. Silently: writes and recall both go somewhere nobody
intended, and beats 4/5/6 are exactly the beats that depend on that scope being
right. `Record<string, …>` does not catch it; the annotation is a lie about a plain
object. Use `new Map(...)` + `.get()` and cover it with a prototype-chain test:
`src/skins/commerce/intelligence/user-id.ts` and its `user-id.test.ts`.

Banking and people still carry the older hardcoded-list shape; copy commerce's,
not theirs.

## `agent.ts` — SERVER-ONLY (no "use client", no JSX)

Mirror `src/skins/logistics/agent.ts` (the shortest of the six) or any other —
`wc -l src/skins/*/agent.ts` shows the real spread, and none of them is "minimal"
any more, because this file is where most beats are actually enforced (screen
awareness, recall-first, the beat-5/beat-6 separation, the withheld gate
vocabulary). Imported ONLY by `src/shell/agent-registry.ts`; the client skin never
imports it.

```ts
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export const <id>Agent = () =>
  new BuiltInAgent({
    model: "openai/gpt-5.4", // the alias used across this repo
    prompt: <ID>_PROMPT,
    // tools: [...]       // optional server-side agent tools (defineTool)
    temperature: 0, // banking pins 0 — a demo has to behave the same every run
  });
```

### The prompt is where the beats are enforced

Most beats fail in the **prompt**, not in the wiring: the tools exist, the agent
just doesn't use them the way the demo needs. Banking's prompt is one long string
of named clauses (`src/skins/banking/agent.ts`) — copy the clause set, not the
banking specifics. The clauses that carry beats:

| Clause                        | Beat            | What it must say                                                                                                                                                                                                                                |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHART / COMPONENT ANSWER RULE | 1               | Render the visual **and** answer in one or two sentences. Never one without the other.                                                                                                                                                          |
| NEVER WRITE A MARKDOWN TABLE  | 1, presentation | If a gen-UI component exists for that data, route to it instead of emitting a table.                                                                                                                                                            |
| SCREEN AWARENESS              | 3b              | "The context you are given IS your view of what the user is looking at." Name the current page, summarize the key elements, cite the actual figures, and **never** say you cannot see/inspect/read the screen.                                  |
| SECRETS                       | 3a              | Never ask for the sensitive value, never repeat it, and don't ask which record first — fire the tool immediately.                                                                                                                               |
| UPLOADED DOCUMENTS            | 3d              | Read the attachment, and merge its values into the artifact tool's payload (banking passes them through `createReport`'s `additions` array).                                                                                                    |
| RECALL FIRST                  | 4               | Before answering this class of question, call `recall_memory`, then pass what you recalled into the component **and name the preference you applied**. Speak like a person who remembers.                                                       |
| SAVED PROCEDURE               | 5               | Recall, then EXECUTE step by step without asking for confirmation. Resolve the named entity to its id from context. State plainly that this is a DIFFERENT procedure from beat 6's — "do not confuse the two, do not offer to record anything." |
| FINDING IS NOT DOING          | 5               | Locating the record is not handling it. Carry the procedure through.                                                                                                                                                                            |
| ACTION DISCIPLINE             | 6               | When there is no saved procedure, decline and offer to record — never improvise or bluff a fix.                                                                                                                                                 |
| TEACH & RECALL                | 6               | The record → save → replay chain, and "save this procedure AT MOST ONCE".                                                                                                                                                                       |
| PROSE STYLE                   | presentation    | Short answers, **bold** the key figures, no walls of text.                                                                                                                                                                                      |

Also keep the **tool descriptions** doing routing work: banking puts a shared
`CHART_ANSWER_RULE` in each chart tool's description and states which question
shape each tool owns, which is what keeps "show me the trend" off the canvas
report path.

**If your skin has a `CanvasSurface`, emit its a2ui operations from a SERVER tool
here — never from a client `useFrontendTool`.** The a2ui middleware only converts
the `{ [A2UI_OPERATIONS_KEY]: buildOps(spec) }` payload into an `a2ui-surface`
activity when it observes it in an in-stream `TOOL_CALL_RESULT` event, which a
client frontend-tool result does NOT produce — do it client-side and the canvas
stays permanently blank. Both banking (`render_report`) and logistics
(`renderBrief`) do it server-side. Register the tool on the `BuiltInAgent` with
`defineTool` (read `src/skins/logistics/agent.ts` for the full worked pattern —
the tool takes agent-chosen selections + LABEL-only text and deterministically
expands them into ops, so numbers bind to live client data, never the model):

```ts
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
// build-*-ops.ts is server-safe (plain Zod + string constants — no React/.tsx):
import { renderReportParams, buildReportOps, A2UI_OPERATIONS_KEY } from "./build-report-ops";

const renderReportTool = defineTool({
  name: "renderReport",
  description: "Build the report on the canvas. Supply selections + LABEL-ONLY text — never numbers.",
  parameters: renderReportParams,
  execute: async (spec) => ({ [A2UI_OPERATIONS_KEY]: buildReportOps(spec) }),
});

export const <id>Agent = () =>
  new BuiltInAgent({
    model: "openai/gpt-5.4",
    prompt: "You are the <Brand> agent. ...",
    tools: [renderReportTool],
  });
```

**De-duplicate every array selection at the top of your op-builder.** zod arrays
do not deduplicate, and the spec comes from the MODEL: `kpis:["valueAtRisk",
"valueAtRisk"]` is an ordinary generation, not an edge case. Because op-builders
derive each component id from its selection value (`` `kpi-${metric}` ``), a
repeat emits two components with the SAME id — and a2ui's per-surface
`componentsModel` is a MAP keyed by id, so the second silently overwrites the
first (one card renders where two were asked for) while the layout renderer's
`children.map((id) => <Slot key={id} …>)` trips a React duplicate-key warning.
Dedupe rather than throw: a repeat has an unambiguous intent, and throwing blanks
the canvas mid-demo. `[...new Set(...)]` keeps first-occurrence order, so the
builder's deterministic ordering survives. Then derive the grid's `columns` and
every `children` array from the DE-DUPED list, not from `spec.*`:

```ts
const kpis = [...new Set(spec.kpis)];
const lists = [...new Set(spec.lists ?? [])];
// …then use `kpis` / `lists` everywhere below, including Math.min(kpis.length, 4).
```

Worked references with tests: `src/skins/commerce/build-brief-ops.ts` +
`build-brief-ops.test.ts`, and `src/skins/keel/ops-report.ts` + `ops-report.test.ts`.

## `skin.tsx` — assembles the contract (NEVER imports agent.ts)

```tsx
"use client";
import type { ComponentType } from "react";
import type { Skin } from "@/shell/skin-contract";
import { <id>Identity } from "./identity";
import { <Id>Layout } from "./layout";
import { <Id>HomePage } from "./pages/home";
import { <Id>Tools } from "./tools";
import { <id>Catalog } from "./catalog";
import { <id>Suggestions } from "./suggestions";
import { <ID>_DESIGN_SKILL } from "./design-skill";
import { use<Id>Data } from "./data/use-data"; // REST-backed skin (i.e. every shipped one): delete this import AND the `useData` field below
// import { <Id>Providers, <Id>RuntimeProviders, use<Id>RuntimeProperties } from "./providers";

// A `Map`, NOT a plain object — load-bearing for security. `segments` is the URL
// path after `/<id>`, i.e. untrusted caller input. A plain-object lookup
// (`PAGES[key]`) walks the prototype chain, so "toString", "constructor",
// "valueOf", "__proto__", … all resolve TRUTHY and slip past the `?? null` 404
// guard, handing the shell a `Function` where a `ComponentType` is declared —
// `/<id>/toString` then 500s instead of 404ing. `Map.get` only sees own entries.
// `Record<string, ComponentType>` cannot catch this; the annotation is a lie
// about a plain object. See `src/skins/keel/skin.tsx` and
// `src/skins/commerce/skin.tsx`, and cover it with a prototype-chain test like
// `src/skins/commerce/skin.test.tsx`.
const PAGES: Map<string, ComponentType> = new Map([
  ["", <Id>HomePage],
  // ["reports", <Id>ReportsPage],
]);

const <id>: Skin = {
  id: "<id>",
  identity: <id>Identity,
  themeClass: "theme-<id>",
  Layout: <Id>Layout,
  nav: [{ segment: "", label: "Home" }],
  resolvePage: (segments) => PAGES.get(segments.length === 0 ? "" : segments.join("/")) ?? null,
  Tools: <Id>Tools,
  catalog: <id>Catalog,
  suggestions: <id>Suggestions,
  designSkill: <ID>_DESIGN_SKILL,

  // ── Optional slots ──
  // "Optional" per the CONTRACT; a demo-complete skin sets nearly all of them.
  // Across the six shipped skins there are exactly two real omissions — airline's
  // `sandboxFunctions` and `RuntimeProviders`, each for a stated reason — plus
  // `useData`, which nothing sets. So do NOT read a skin's omission as a model;
  // derive what the tree does:
  //   grep -nE '^\s+(Providers|CanvasSurface|sandboxFunctions|toolLabels|chatHeaderActions|onSuggestionSelect|RuntimeProviders|useRuntimeProperties|useData)[,:]' src/skins/*/skin.tsx
  // `toolLabels` in particular is optional in name only: it is what makes activity
  // chips read as human phrases ("Pulling up your flight") instead of raw tool
  // names (`showFlight`). Any skin with named frontend tools wants it.
  useData: use<Id>Data, // () => unknown — DELETE THIS LINE unless your skin has
                        //   genuinely client-owned, shell-managed state. No
                        //   shipped skin sets it; every one reads a REST ledger
                        //   through its own context. Omitted → useSkinData<T>()
                        //   returns undefined.
  // Providers,           // ComponentType<{ children: ReactNode }> — stack BELOW CopilotKitProvider
  // CanvasSurface,       // ComponentType — full-region a2ui report surface
  // sandboxFunctions,    // SandboxFunction[] — exposed inside OGUI iframes
  // toolLabels: {        // Record<string, string> — activity-chip labels for your tools
  //   showThing: "Pulling up the thing",
  // },
  // BEAT 3d — the attachment path. The framework's suggestion path DROPS
  // attachments, so a pill that must carry a file has to be intercepted here:
  // stage the file into the composer's hidden input[type=file], then drive the
  // real composer textarea + send button. Match on the message CONSTANT shared
  // with suggestions.ts so it can never drift. Ship the paperclip too, so the
  // presenter can stage the file by hand if the pill path misbehaves on stage.
  //
  // ⚠️ DO NOT IMPLEMENT THE CHAIN. It is shell-owned — `@/shell/attach` — and it
  // is ~660 lines of framework-specific detection you would otherwise get wrong.
  // Your skin's whole attachment file is this (see `src/skins/*/attach-*.ts`):
  //
  //   // Two lines, not one with an inline `type`: the commit hook's
  //   // `oxlint --fix` (consistent-type-imports) rewrites the inline form.
  //   import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
  //   import type { AttachmentDocument } from "@/shell/attach";
  //   import { <ID>_ATTACHMENT_MESSAGE } from "./suggestions";
  //
  //   const DOC: AttachmentDocument = { url: "…", filename: "…" };
  //   export const attach<Id>ByHand = (): Promise<boolean> => attachByHand(DOC);
  //   export const send<Id>WithAttachment = (): Promise<boolean> =>
  //     sendMessageWithAttachment(DOC, <ID>_ATTACHMENT_MESSAGE);
  //
  // Keep the message constant in `suggestions.ts` beside the pill that carries
  // it, and import it here — one value, so the pill and the send cannot drift
  // into a prompt that goes out WITHOUT the file.
  //
  // ⚠️ FAIL LOUD, OR DO NOT SHIP THIS BEAT. If any failure lets the prompt go out
  // anyway, the model invents the document's contents, the artifact is still
  // filed, and it reads plausibly: the beat proves the exact opposite of its claim
  // and nobody in the room can tell. The shell chain is what enforces that; the
  // rules below are WHY it is shaped as it is, so you can recognize a change that
  // breaks one — not a to-do list. (Banking and people each hand-rolled a sender
  // in their OWN skin.tsx where the staging result gated a 500 ms sleep and
  // nothing else, so a failed stage still sent the prompt. Both looked fine.)
  //   - The prompt is never sent unless the file is VERIFIED attached — three
  //     separate observations, not one dispatched event:
  //       (a) the composer ACCEPTED it — a chip appeared in
  //           `[data-testid="copilot-attachment-queue"]`. `processFiles` drops
  //           anything failing `accept`/`maxSize` and calls an `onUploadFailed`
  //           this app never wires, so a rejection is otherwise INVISIBLE.
  //       (b) it finished base64 ENCODING — the chip prints its filename.
  //           `consumeAttachments` hands over only `ready` files, and
  //           `onSubmitInput` refuses to send while anything is `uploading`.
  //       (c) the send button is in SEND state — the SAME button is the STOP
  //           button mid-run, and a click then CANCELS the run and sends nothing.
  //   - Waits are on a CONDITION with a bounded budget, never a fixed
  //     `setTimeout`: a sleep that races an async encode is the defect, not its
  //     duration. An expired budget is a failure, not a green light. The budgets
  //     are injectable (`Beat3dTimings`) so the SHELL's tests can force an expiry
  //     without sleeping; your wrapper should not re-expose them.
  //   - The CLICK is confirmed too — the attachment leaving the queue is the only
  //     proof that `consumeAttachments` ran and the file rode the message out.
  //   - The document's BYTES are checked (`%PDF`), not just the status: a route
  //     that throws can answer 200 with an HTML error page, and forcing
  //     `type: "application/pdf"` onto the File would smuggle it past `accept`.
  //   - The composer is located BEFORE staging, so a rename aborts while the beat
  //     is still a no-op instead of stranding an attachment you cannot submit.
  //   - Failures carry a machine-readable CAUSE (fifteen of them), each with its
  //     own sentence: "retry the pill", "press send by hand" and "restart the dev
  //     server" are different instructions. The cause is tagged into the log line
  //     as `[attach:<cause>]`, which is LOAD-BEARING — the entry points return
  //     bare booleans, so that tag is the only place a send-path cause is
  //     observable, and the shell's tests parse it by regex.
  //   - Every failure surfaces where a presenter will see it: `console.error` for
  //     the log AND `window.alert` for the stage (the same pattern the reset
  //     button uses in `layout.tsx`).
  //   - Both entry points are wholly inside their own `try` and report cause
  //     "unexpected" before resolving `false`, so NEITHER CAN REJECT — a bare
  //     `void` at the call site drops nothing. Commerce shipped a catching
  //     `launchBeat3d` wrapper for this and it was deleted as redundant; do not
  //     re-add a per-skin catch.
  // (Shell implementation + all fifteen causes red-greened:
  // `src/shell/attach/stage-attachment.ts` + `stage-attachment.test.ts`. A skin's
  // own wrapper needs no test of the chain; commerce keeps a small one only to pin
  // ITS three values — `src/skins/commerce/attach-price-sheet.test.ts`, which
  // imports composer selectors from `@/shell/attach/stage-attachment`, since the
  // barrel deliberately exports only the entry points and their types.)
  // chatHeaderActions: [ // ChatHeaderAction[] — buttons in the shared chat header
  //   {
  //     icon: Paperclip,
  //     label: "Attach the <artifact>",
  //     // The paperclip is the FALLBACK, so it must be the loudest link: if it
  //     // fails quietly too, the presenter has nothing left to try. It has
  //     // already reported by the time it resolves `false`.
  //     onClick: () => void attach<Id>ByHand(),
  //   },
  // ],
  // onSuggestionSelect: (suggestion) => {
  //   if (suggestion.message !== <ID>_ATTACHMENT_MESSAGE) return false;
  //   // `true` means "the shell must NOT run its default send" — unconditionally
  //   // right here, because that default path drops the attachment. Claiming the
  //   // click is only honest if the handler guarantees two outcomes: sent WITH
  //   // the file, or aborted AND the presenter told why. Never `true` + silence.
  //   void send<Id>WithAttachment();
  //   return true;
  // },

  // ── End-user identity (any skin with memory beats needs this) ──
  // Mount above CopilotKitProvider + contribute its `properties`; pair with a
  // server-safe `identifyUser` in agent-registry.ts. Banking uses all three;
  // every shipped skin ships `useRuntimeProperties` + `identifyUser`, and airline
  // ships those two and NOT `RuntimeProviders` — the provider exists so the hook
  // can read CONTEXT, and airline's has none to read (one account holder, no
  // switcher), so it returns a frozen module constant instead. Do not mount an
  // empty provider for symmetry. See "Contributing end-user identity" in SKILL.md.
  // RuntimeProviders: <Id>RuntimeProviders,         // ComponentType<{ children: ReactNode }>
  // useRuntimeProperties: use<Id>RuntimeProperties, // () => Record<string, unknown> | undefined
};

export default <id>;
```

## Multi-page `nav` + `resolvePage`

Extra segments are extra `Map` entries — the resolver itself does not change. Keep
it a `Map`, never a plain object indexed by the key, for the reason spelled out on
the `PAGES` scaffold above (`segments` is untrusted, so `/<id>/toString` 500s
instead of 404ing).

```tsx
const PAGES: Map<string, ComponentType> = new Map([
  ["", <Id>HomePage],
  ["reports", <Id>ReportsPage],
]);

// …then in the Skin object:
nav: [
  { segment: "", label: "Home" },
  { segment: "reports", label: "Reports" },
],
// a miss → null → 404
resolvePage: (segments) => PAGES.get(segments.length === 0 ? "" : segments.join("/")) ?? null,
```
