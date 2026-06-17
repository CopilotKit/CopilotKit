import path from "path";
import { REFERENCE_DOCS } from "./lib/files";
import { ReferenceDoc } from "./lib/reference-doc";

// Resolve all source/destination paths relative to the repo root so the
// pipeline behaves the same regardless of where it's invoked from.
const repoRoot = path.resolve(__dirname, "..", "..");
process.chdir(repoRoot);

// allSettled so one missing source (e.g. an SDK file that was renamed
// upstream) doesn't abort the entire pipeline — we still want every other
// reference page to land in shell-docs.
Promise.allSettled(
  REFERENCE_DOCS.map(async (referenceDoc) => {
    const doc = new ReferenceDoc(referenceDoc);
    await doc.generate();
  }),
).then((results) => {
  const failures = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "rejected");
  for (const { r, i } of failures) {
    const reason = (r as PromiseRejectedResult).reason;
    console.error(
      `[gen] Failed: ${REFERENCE_DOCS[i].destinationPath}: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    );
  }
  console.log(
    `All reference docs processed (${results.length - failures.length}/${results.length} succeeded)`,
  );
});
