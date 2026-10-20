import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Install published dependencies outside the monorepo so workspace aliases and
// overrides cannot hide a broken public package boundary.
if (Number(process.versions.node.split(".")[0]) < 22) {
  throw new Error("The Channels SDK smoke check requires Node.js 22 or later.");
}

const content = new URL("../src/content/", import.meta.url);
const installSource = readFileSync(
  new URL("snippets/shared/channels/install.mdx", content),
  "utf8",
);
const packages = installSource.match(
  /npm install --save-exact (@copilotkit\/channels@[\d.]+) (@copilotkit\/runtime@[\d.]+)/,
);
if (!packages)
  throw new Error("Missing exact Channels install recommendation.");

const directory = mkdtempSync(join(tmpdir(), "channels-sdk-smoke-"));

/** Run a fixture command and fail visibly without ignoring its exit status. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: directory, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
}

try {
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    packages[1],
    packages[2],
    "@ag-ui/client@0.0.59",
    "tsx@4.20.5",
    "typescript@5.9.2",
    "@types/node@22.18.6",
  ]);
  run("npm", [
    "ls",
    "@copilotkit/channels-core",
    "@copilotkit/runtime",
    "@ag-ui/client",
  ]);
  writeFileSync(
    join(directory, "agent.ts"),
    'import { HttpAgent } from "@ag-ui/client";\nexport const makeAgent = (threadId: string) => new HttpAgent({ url: "http://localhost:8000", threadId });\n',
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: ["node"],
      },
      include: ["*.ts"],
    }),
  );
  for (const provider of ["slack", "teams"]) {
    const guide = readFileSync(
      new URL(`docs/frontends/${provider}.mdx`, content),
      "utf8",
    );
    const source = guide.match(/```ts title="channel.ts"\n([\s\S]*?)```/)?.[1];
    if (!source) throw new Error(`Missing ${provider} runner example.`);
    const marker = 'from "./agent.js";';
    const boundary = source.indexOf(marker);
    if (boundary < 0) throw new Error(`Missing ${provider} agent import.`);
    const end = boundary + marker.length;
    // Typecheck the complete documented runner. Keep execution inside an
    // uncalled function so module loading never starts a managed connection.
    writeFileSync(
      join(directory, `${provider}.ts`),
      `${source.slice(0, end)}\nexport async function start() {\n${source.slice(end)}\n}\n`,
    );
  }
  run(process.execPath, ["node_modules/typescript/bin/tsc"]);
  writeFileSync(join(directory, ".env"), "");
  for (const provider of ["slack", "teams"]) {
    run(process.execPath, [
      "--env-file=.env",
      "--import",
      "tsx",
      `${provider}.ts`,
    ]);
  }
  console.log(`Channels SDK smoke passed: ${packages[1]} / ${packages[2]}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
