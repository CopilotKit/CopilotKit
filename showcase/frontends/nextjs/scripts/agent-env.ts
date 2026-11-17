// Prints the address variables of one integration, one line for each entry of
// src/integrations/<slug>/env.ts:
//
//   NAME=http://<host>:<port><path>
//
// docker compose and CI use the lines to point the app at the integration's
// container. An integration that runs in process has no env.ts, so it prints
// nothing. An unknown slug exits with 1, and a missing argument with 2.
//
// Usage (from showcase/frontends/nextjs): npx tsx scripts/agent-env.ts <slug> <host>
//
//   $ npx tsx scripts/agent-env.ts strands showcase-strands
//   AGENT_URL_STRANDS=http://showcase-strands:8000
import { loadIntegrationEnv } from "../src/lib/agents";

async function main() {
  const [slug, host] = process.argv.slice(2);
  if (slug === undefined || host === undefined) {
    console.error("Usage: tsx scripts/agent-env.ts <slug> <host>");
    return 2;
  }
  const env = await loadIntegrationEnv(slug);
  if (env === undefined) {
    console.error(`Unknown integration "${slug}": no manifest has this slug.`);
    return 1;
  }
  const addresses = Object.entries(env);
  for (const [name, { port, path = "" }] of addresses) {
    console.log(`${name}=http://${host}:${port}${path}`);
  }
  return 0;
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
