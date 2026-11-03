import { readFileSync } from "node:fs";
import { danger, fail, schedule } from "danger";
import {
  MIGRATION_PATH_PREFIXES,
  PUBLIC_API_MANIFEST_PATH,
  evaluateBreakingChangeGate,
  findPublicApiBreaks,
  isReleaseLineBranch,
} from "./scripts/release/lib/breaking-change-gate";

// PRs into a release line (e.g. `2.0.0`) that break an API must ship a
// codemod or a migration-guide entry with the break.
async function checkBreakingChanges() {
  const pr = danger.github.pr;
  if (!isReleaseLineBranch(pr.base.ref)) return;

  const allChangedFiles = [
    ...danger.git.modified_files,
    ...danger.git.created_files,
    ...danger.git.deleted_files,
  ];

  let apiBreaks: string[] = [];
  if (allChangedFiles.includes(PUBLIC_API_MANIFEST_PATH)) {
    // The base manifest comes from the API; the checkout holds the PR's.
    const baseManifest = await danger.github.utils.fileContents(
      PUBLIC_API_MANIFEST_PATH,
      pr.base.repo.full_name,
      pr.base.sha,
    );
    if (baseManifest) {
      apiBreaks = findPublicApiBreaks(
        JSON.parse(baseManifest),
        JSON.parse(readFileSync(PUBLIC_API_MANIFEST_PATH, "utf8")),
      );
    }
  }

  const { reasons, migrationFiles } = evaluateBreakingChangeGate({
    title: pr.title,
    body: pr.body ?? "",
    commitMessages: danger.git.commits.map((commit) => commit.message),
    changedFiles: allChangedFiles,
    apiBreaks,
  });
  if (reasons.length === 0 || migrationFiles.length > 0) return;

  fail(
    [
      `This PR into \`${pr.base.ref}\` breaks an API, but it adds no codemod and no migration-guide entry.`,
      "",
      ...reasons.map((reason) => `- ${reason}`),
      "",
      `Add a codemod under \`${MIGRATION_PATH_PREFIXES[0]}\`, or document the break under \`${MIGRATION_PATH_PREFIXES[1]}\`.`,
    ].join("\n"),
  );
}

schedule(checkBreakingChanges());
