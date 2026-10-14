const supportedFrameworks = new Set(["mastra", "strands-typescript"]);

/** Inspect every requested row before provisioning; missing code stays evidence. */
export async function preflight({
  frameworks,
  rowIds,
  load = (path) => import(path),
}) {
  const checks = [];
  const rows = [];
  const factories = [];
  for (const framework of frameworks) {
    checks.push({
      name: `framework:${framework}`,
      status: supportedFrameworks.has(framework) ? "passed" : "unvalidated",
      detail: supportedFrameworks.has(framework)
        ? "Concrete common browser path available"
        : "Concrete common browser path is not implemented",
    });
  }
  for (const id of rowIds) {
    if (String(id) !== "1") {
      checks.push({
        name: `row:${id}`,
        status: "blocked",
        detail:
          "Only bounded row1 is included; other rows are preserved for follow-up PRs",
      });
      continue;
    }
    const paths = ["./rows/row1.mjs", "./row1/services.mjs"];
    try {
      const row = (await load(paths[0])).row;
      const factory = (await load(paths[1])).createServices;
      if (
        !row ||
        typeof row.run !== "function" ||
        typeof factory !== "function"
      )
        throw new TypeError("Invalid row exports");
      rows.push(row);
      factories.push(factory);
      checks.push({
        name: `row:${id}`,
        status: "passed",
        detail: "Row and service factory load; live execution still required",
      });
    } catch (error) {
      checks.push({
        name: `row:${id}`,
        status: "blocked",
        detail:
          error.code === "ERR_MODULE_NOT_FOUND"
            ? "Required row/service module is missing"
            : "Row/service module could not load",
        modules: paths,
      });
    }
  }
  if (
    !rowIds.length ||
    new Set(rowIds.map(String)).size !== rowIds.length ||
    !frameworks.length ||
    new Set(frameworks).size !== frameworks.length
  )
    checks.push({
      name: "selection",
      status: "blocked",
      detail: "Select nonempty unique framework and row lists",
    });
  return {
    checks,
    rows,
    factories,
    ready:
      checks.length > 0 && checks.every((check) => check.status === "passed"),
  };
}
