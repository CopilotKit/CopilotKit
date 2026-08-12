# Public skill evaluations

This workspace is the repository-native foundation for evaluating public
CopilotKit product skills against the current package surface. It combines two
checks that catch different failure modes:

- TypeScript compiles skill-owned source assets against package artifacts built
  from this checkout.
- Manifest validation rejects missing package entrypoints and APIs that still
  compile only because a deprecated compatibility export remains available.

Run the focused suite through Nx:

```sh
pnpm nx run public-skill-evals:test
pnpm nx run public-skill-evals:check
```

`check` builds its workspace package dependencies first, then prints a result
for each scenario and a summary with pass rate, median attempts, and median
time-to-green. Diagnostics include the scenario source location, category, and
the replacement recorded in `scripts/release/public-api/manifest.v1.json` when
one exists.

This first slice covers the setup skill's maintained Next.js/Hono, React, and
Express assets. Add scenarios here as the remaining public skill evals migrate
away from shell grep and LLM-only grading. Internal and contributor skills do
not belong in this suite.
