import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const quickstart = readFileSync(
  new URL(
    "../../content/docs/integrations/claude-sdk-typescript/quickstart.mdx",
    import.meta.url,
  ),
  "utf8",
);

test("documents loopback forwarding for SSH CLI authentication", () => {
  expect(quickstart).toContain(
    "ssh -L <callback-port>:localhost:<callback-port> <user>@<remote-host>",
  );
  expect(quickstart).toContain(
    "callback=http://127.0.0.1:<callback-port>/callback",
  );
  expect(quickstart).toContain("without sending the JWT through the SSH terminal input");
});
