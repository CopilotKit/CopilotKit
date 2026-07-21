import { copyFile, mkdir } from "node:fs/promises";
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
