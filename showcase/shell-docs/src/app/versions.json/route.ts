import { DOCS_VERSIONS } from "@/lib/docs-versions.mjs";

/**
 * The docs versions, for every version's picker. Pickers fetch it from the
 * stable docs at the root (/versions.json), so a version that is no longer
 * built still lists the newer ones.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    DOCS_VERSIONS.map(({ id, label, note, path }) => ({
      id,
      label,
      note,
      path,
    })),
  );
}
