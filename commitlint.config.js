module.exports = {
  extends: ["@commitlint/config-conventional"],
  // Skip standard git merge commits (e.g. "Merge pull request #N",
  // "Merge branch '...'"). The push-path workflow additionally guards
  // `--last` with a parent-count check so GitHub "Create a merge commit"
  // style merges (which take their message from the PR body and can
  // therefore contain markdown lists that parse as empty subjects) are
  // skipped before commitlint even runs.
  ignores: [(message) => /^Merge /.test(message)],
  rules: {
    "subject-case": [0],
    // GitHub merge commits append " (#NNNN)" which eats 8+ chars.
    // With scoped conventional prefixes like "fix(runtime): ...",
    // 100 chars is too tight. 120 gives enough room.
    "header-max-length": [2, "always", 120],
  },
};
