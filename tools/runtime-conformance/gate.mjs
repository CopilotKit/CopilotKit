import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Identify changes that can alter the runtime or its conformance contract. */
export function requiresConformance(paths) {
  return paths.some((path) =>
    /^(?:packages\/(?:runtime(?:-(?:python|go|ruby|dotnet))?|core|shared|aimock)\/|tools\/runtime-conformance\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|nx\.json$|tsconfig[^/]*\.json$|\.github\/(?:CODEOWNERS$|workflows\/intelligence-runtimes\.yml$))/.test(
      path,
    ),
  );
}

/** Accept only a complete matrix or a confirmed unrelated change. */
export function gatePassed(scope, required, matrix) {
  return (
    scope === "success" &&
    ((required === "true" && matrix === "success") ||
      (required === "false" && matrix === "skipped"))
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "scope") {
    const base = process.env.BASE_SHA;
    if (!base || /^0+$/.test(base)) {
      console.log("required=true");
    } else {
      if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Invalid base commit");
      const paths = execFileSync(
        "git",
        ["diff", "--no-renames", "--name-only", "-z", base, "HEAD"],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      )
        .split("\0")
        .filter(Boolean);
      console.log(`required=${requiresConformance(paths)}`);
    }
  } else if (process.argv[2] === "check") {
    const { SCOPE_RESULT, CONFORMANCE_REQUIRED, MATRIX_RESULT } = process.env;
    if (!gatePassed(SCOPE_RESULT, CONFORMANCE_REQUIRED, MATRIX_RESULT)) {
      console.error(
        `Conformance gate failed: scope=${SCOPE_RESULT}, required=${CONFORMANCE_REQUIRED}, matrix=${MATRIX_RESULT}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        CONFORMANCE_REQUIRED === "true"
          ? "All runtime conformance jobs passed."
          : "No runtime changes require conformance.",
      );
    }
  } else {
    throw new Error("Expected scope or check command");
  }
}
