import type { DemoSupport } from "@/lib/integration-support";

type UnavailableSupport = Exclude<DemoSupport, { kind: "supported" }>;

/**
 * The frontend twin of `showcase/shell/src/components/frontend-cell-status.tsx`
 * — same layout, so a stop state reads the same whether the shell renders it or
 * this app does. It is a twin, NOT a copy; the differences below are real and
 * intended, so do not "restore parity" by importing one into the other.
 *
 *   - TITLES OVERLAP ON TWO KINDS ONLY. Both files title `malformed` "Invalid
 *     Showcase route" and `not-supported` "Not supported". The shell adds four
 *     this app never produces (`docs-only`, `not-applicable`, `quarantined`,
 *     `backend-unavailable`) because it resolves a `ShowcaseCellResolution`
 *     from the cell registry; this app adds `informational`, which the shell
 *     has no counterpart for. The two `kind` unions are different types.
 *   - THE FACT LIST DIFFERS BY TWO ROWS. Shared: Cell, Backend, Feature. The
 *     shell also shows `Frontend` (it knows which frontend was selected; this
 *     app IS the frontend, so the row would be a constant). This file also
 *     shows `Run` for an `informational` cell, whose whole content is a
 *     copy-paste command.
 *   - THE ROLE IS NOT ALWAYS `alert`, unlike the shell's. See below.
 *
 * Token names differ too, because this app uses the integration palette
 * (`--card`, `--foreground`, `--muted-foreground`) rather than the shell's.
 */
/**
 * `informational` is NOT a failure, and its title must not read like one.
 *
 * A `demos[]` row with no `route` and no `agent` — `cli-start` is the whole
 * population — is a copy-paste command cell. It has no page BY DESIGN, so
 * "Not supported" (a gap in this backend) and "…does not carry the demo page
 * yet" (a gap in this frontend) are both false claims about a complete
 * feature. It reaches this component only because someone opened its URL
 * directly; the honest answer is what the cell IS, plus the command itself.
 */
const TITLES: Record<UnavailableSupport["kind"], string> = {
  malformed: "Invalid Showcase route",
  "not-supported": "Not supported",
  informational: "Nothing to run — this is a command",
};

export function CellUnavailable({ support }: { support: UnavailableSupport }) {
  /**
   * THE SEMANTICS MUST AGREE WITH THE TITLE. `informational` is not a failure,
   * so announcing it assertively contradicts the very title chosen above: a
   * screen reader would interrupt the user to report `cli-start` — a complete,
   * working feature — as if something broke.
   *
   *   - `informational`  -> role="status"  + aria-live="polite"  (announced
   *     when the user is idle; the implicit live region of `status` is spelled
   *     out because assistive tech support for the implicit value is uneven).
   *   - `malformed`      -> role="alert" (a broken URL or a failed manifest
   *     load — a real fault the operator must see now).
   *   - `not-supported`  -> role="alert" (the backend cannot drive this cell;
   *     the page the user asked for is not there).
   *
   * `layout.test.tsx` and `[demo]/page.test.tsx` both assert `role="alert"` on
   * the not-supported path, so downgrading that one goes red.
   */
  const informational = support.kind === "informational";

  return (
    <section
      role={informational ? "status" : "alert"}
      aria-live={informational ? "polite" : undefined}
      className="mx-auto mt-16 max-w-xl rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 text-[var(--foreground)]"
    >
      <h1 className="text-lg font-semibold">{TITLES[support.kind]}</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {support.reason}
      </p>
      {support.kind !== "malformed" ? (
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-[var(--muted-foreground)]">Cell</dt>
          <dd className="break-all font-mono">
            {support.slug}/{support.demoId}
          </dd>
          <dt className="text-[var(--muted-foreground)]">Backend</dt>
          <dd>{support.integrationName}</dd>
          <dt className="text-[var(--muted-foreground)]">Feature</dt>
          <dd>{support.demoName}</dd>
          {support.kind === "informational" && support.command ? (
            <>
              {/* The whole content of the cell. Rendered here rather than
                  described in prose so the reader can copy it. */}
              <dt className="text-[var(--muted-foreground)]">Run</dt>
              <dd className="break-all font-mono">{support.command}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
