import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(
  new URL(
    "../../integrations/langgraph-python/public/demo-files/",
    import.meta.url,
  ),
);
const destinationRoot = fileURLToPath(
  new URL("../public/demo-files/", import.meta.url),
);
const filenames = ["sample.png", "sample.pdf"];

await mkdir(destinationRoot, { recursive: true });
await Promise.all(
  filenames.map((filename) =>
    copyFile(`${sourceRoot}/${filename}`, `${destinationRoot}/${filename}`),
  ),
);

const sandboxProxyCandidates = [
  new URL(
    "../node_modules/@copilotkit/angular/mcp-apps/sandbox-proxy.html",
    import.meta.url,
  ),
  new URL(
    "../../../packages/angular/src/mcp-apps/sandbox-proxy.html",
    import.meta.url,
  ),
];
let sandboxProxySource;
for (const candidate of sandboxProxyCandidates) {
  const candidateFile = fileURLToPath(candidate);
  try {
    await access(candidateFile);
    sandboxProxySource = candidateFile;
    break;
  } catch {
    // Clean consumers use the packed asset; workspace builds use the source.
  }
}
if (!sandboxProxySource) {
  throw new Error(
    "Could not find the packed or workspace MCP Apps sandbox proxy asset.",
  );
}
const sandboxProxyDestination = fileURLToPath(
  new URL("../public/mcp-apps-sandbox.html", import.meta.url),
);
await copyFile(sandboxProxySource, sandboxProxyDestination);
