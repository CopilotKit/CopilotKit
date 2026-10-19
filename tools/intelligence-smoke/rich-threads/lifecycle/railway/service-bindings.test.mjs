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

test("private bindings use recorded names and planned ordinals for forward and self references", () => {
  const specs = [
    { key: "postgres" },
    { key: "runtime" },
    { key: "application" },
  ];
  const journal = {
    environmentName: "rich-0123456789abcdef012",
    services: [{ key: "postgres", name: "retained-postgres" }],
  };
  assert.equal(
    bindServiceVariables(
      "{{service:postgres:host}} {{service:runtime:host}} {{service:application:host}}",
      specs,
      journal,
    ),
    "retained-postgres.railway.internal rich-0123456789abcdef012-1.railway.internal rich-0123456789abcdef012-2.railway.internal",
  );
  assert.throws(
    () => bindServiceVariables("{{service:unknown:host}}", specs, journal),
    /Unknown private service binding/,
  );
});
