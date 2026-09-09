"use client";

import { z } from "zod";
import type {
  CatalogDefinitions,
  RendererProps,
} from "@copilotkit/a2ui-renderer";
import { formatDate } from "@/skins/keel/pages/format-date";
import type { BriefCitationRow } from "./impact-brief-ops";

/**
 * BEAT 3d — how a filed Impact Brief looks on the shared canvas.
 *
 * The definitions and renderers live here rather than inline in
 * `canvas-surface.tsx` for one reason that is not tidiness: the catalog objects
 * `createCatalog` produces are opaque, so a test that mounts the surface can
 * only ever assert that SOMETHING rendered. Exporting the renderers lets
 * `impact-brief-components.test.tsx` mount the actual citation table and assert
 * the row that carries the beat's proof — the policy the bulletin named that the
 * register does not hold — is drawn as uncarried.
 *
 * `canvas-surface.tsx` merges both exports into keel's ONE report catalog
 * ("keel-report"), which the ops report already renders through. Additive: the
 * ops report's own components are untouched, and the two surfaces are told apart
 * by `surfaceId`, not by catalog.
 */

/**
 * Kept in step with `BriefCitationRow` in `impact-brief-ops.ts`. Written out as
 * a schema rather than derived from the interface because the catalog is what
 * the a2ui runtime validates against, and `satisfies CatalogDefinitions` is what
 * makes a drifted field a type error at the renderer instead of a blank cell.
 */
const citationRowSchema = z.object({
  ref: z.string(),
  title: z.string(),
  currentRevision: z.string().optional(),
  requiredAction: z.string(),
  carried: z.boolean(),
});

export const impactBriefDefinitions = {
  BriefMeta: {
    description:
      "Provenance of a filed impact brief: issuing body, scope, effective date and who filed it.",
    props: z.object({
      source: z.string(),
      space: z.string(),
      effective: z.string(),
      filedBy: z.string(),
      role: z.string(),
      filedAt: z.string(),
    }),
  },
  BriefCitations: {
    description:
      "Every policy the ingested bulletin touches, with the register's answer for each.",
    props: z.object({ rows: z.array(citationRowSchema) }),
  },
  BriefImpacts: {
    description: "The consequences the desk should act on, at most three.",
    props: z.object({ items: z.array(z.string()) }),
  },
} satisfies CatalogDefinitions;

const SPACE_LABELS: Record<string, string> = {
  privacy: "Privacy",
  clinical: "Clinical",
  vendor: "Vendor",
};

/** A space the corpus no longer has still prints, rather than printing blank. */
const spaceLabel = (space: string) => SPACE_LABELS[space] ?? space;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

export const BriefMeta = ({
  props,
}: RendererProps<{
  source: string;
  space: string;
  effective: string;
  filedBy: string;
  role: string;
  filedAt: string;
}>) => (
  <dl
    className="grid grid-cols-2 gap-4 rounded-md border border-hairline bg-surface p-4 shadow-soft md:grid-cols-3"
    data-testid="brief-meta"
  >
    <Field label="Issued by" value={props.source} />
    <Field label="Knowledge space" value={spaceLabel(props.space)} />
    {/* The document's own words, unreformatted — see the note in the builder. */}
    <Field label="Requirements effective" value={props.effective} />
    <Field label="Filed by" value={props.filedBy} />
    <Field label="Role" value={props.role} />
    <Field label="Filed" value={formatDate(props.filedAt)} />
  </dl>
);

/**
 * What the "In force" column says, which is three different facts and not two.
 *
 * A ref the register does not carry has no revision because there is no
 * document; a document the register carries but has NEVER released has no
 * revision because the workforce has never been given one (POL-311). Collapsing
 * both to an em dash would hide the second, and the second is the case
 * `POST /briefs` goes out of its way not to `??`-merge.
 */
const inForce = (row: BriefCitationRow): string => {
  if (!row.carried) return "Not in the library";
  return row.currentRevision ?? "Never released";
};

export const BriefCitations = ({
  props,
}: RendererProps<{ rows: BriefCitationRow[] }>) => {
  const rows = props.rows ?? [];
  if (!rows.length) {
    return (
      <div className="rounded-md border border-hairline bg-surface p-4 text-sm text-ink-muted">
        The bulletin named no policies.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
      <table className="w-full text-sm" data-testid="brief-citations">
        <thead>
          <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-4 py-2 font-medium">Ref</th>
            <th className="px-4 py-2 font-medium">Document</th>
            <th className="px-4 py-2 font-medium">In force</th>
            <th className="px-4 py-2 font-medium">
              What the bulletin requires
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.ref}
              data-testid="brief-citation-row"
              data-ref={row.ref}
              data-carried={String(row.carried)}
              className={`border-b border-hairline last:border-0 ${
                row.carried ? "" : "bg-negative-soft"
              }`}
            >
              <td className="px-4 py-2 font-mono text-xs text-ink">
                {row.ref}
              </td>
              <td className="px-4 py-2 text-ink">{row.title}</td>
              <td className="px-4 py-2">
                {row.carried ? (
                  <span className="text-ink-muted">{inForce(row)}</span>
                ) : (
                  // The row the beat rests on. It is the one thing on this
                  // canvas that could not have been assembled out of
                  // `GET /ledger`, so it is drawn as a finding rather than as a
                  // missing value.
                  <span
                    className="inline-flex rounded-sm bg-surface px-2 py-0.5 text-xs font-medium text-negative"
                    data-testid="brief-uncarried-badge"
                  >
                    {inForce(row)}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-ink-muted">{row.requiredAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const BriefImpacts = ({ props }: RendererProps<{ items: string[] }>) => {
  const items = props.items ?? [];
  if (!items.length) return null;
  return (
    <div
      className="rounded-md border border-hairline bg-surface p-4 shadow-soft"
      data-testid="brief-impacts"
    >
      <div className="text-xs uppercase tracking-wide text-ink-muted">
        What this means for the desk
      </div>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </div>
  );
};

/** Renderer map, keyed to match `impactBriefDefinitions` exactly. */
export const impactBriefRenderers = {
  BriefMeta,
  BriefCitations,
  BriefImpacts,
};
