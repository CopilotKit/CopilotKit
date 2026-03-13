module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [0],
    // GitHub merge commits append " (#NNNN)" which eats 8+ chars.
    // With scoped conventional prefixes like "fix(runtime): ...",
    // 100 chars is too tight. 120 gives enough room.
    "header-max-length": [2, "always", 120],
  },
};
