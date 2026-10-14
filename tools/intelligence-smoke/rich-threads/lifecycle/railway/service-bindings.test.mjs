import test from "node:test";
import assert from "node:assert/strict";
import { bindServiceVariables } from "./service-bindings.mjs";
test("public gateway binding uses only provider-returned ready owned endpoint", () => {
  const journal = {
    environmentName: "rich-example",
    services: [
      {
        key: "composite",
        ready: true,
        endpoints: [
          {
            role: "intelligence-gateway",
            url: "https://owned.up.railway.app/health",
          },
        ],
      },
    ],
  };
  assert.equal(
    bindServiceVariables(
      '{"gateway":"{{service:composite:url:intelligence-gateway}}"}',
      [],
      journal,
    ),
    '{"gateway":"https://owned.up.railway.app"}',
  );
  assert.throws(() =>
    bindServiceVariables(
      "{{service:unknown:url:intelligence-gateway}}",
      [],
      journal,
    ),
  );
  journal.services[0].ready = false;
  assert.throws(() =>
    bindServiceVariables(
      "{{service:composite:url:intelligence-gateway}}",
      [],
      journal,
    ),
  );
});
