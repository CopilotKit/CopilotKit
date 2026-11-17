import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `next start` serves static files from public/ in its working directory, so
// the runner stage must copy public/ next to .next. Without it the demos'
// logo and the multimodal sample files answer 404 from the container.
const dockerfile = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "Dockerfile"),
  "utf8",
);

function runnerStage() {
  const start = dockerfile.search(/^FROM .* AS runner$/m);
  return start === -1 ? "" : dockerfile.slice(start);
}

describe("Dockerfile runner stage", () => {
  it("copies the files next start serves", () => {
    const copies = runnerStage()
      .split("\n")
      .filter((line) => line.startsWith("COPY --from=builder"));

    for (const entry of ["/.next ", "/public "]) {
      expect(
        copies.some((line) =>
          line.includes(`/showcase/frontends/nextjs${entry}`),
        ),
        `runner stage copies ${entry.trim()}`,
      ).toBe(true);
    }
  });
});
