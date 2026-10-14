import assert from "node:assert/strict";
import { bindBootstrap } from "./bootstrap.mjs";
export function bindServiceVariables(value, specs, journal) {
  return bindBootstrap(String(value), journal.bootstrap)
    .replace(/\{\{service:([a-z0-9-]+):host\}\}/g, (_match, key) => {
      assert.ok(
        specs.some((s) => s.key === key),
        "Unknown private service binding",
      );
      return `${journal.environmentName}-${key}.railway.internal`;
    })
    .replace(
      /\{\{service:([a-z0-9-]+):url:([a-z-]+)\}\}/g,
      (_match, key, role) => {
        const service = journal.services.find((s) => s.key === key);
        assert.ok(
          service?.ready,
          "Public endpoint binding requires ready owned service",
        );
        const endpoint = service.endpoints.find((e) => e.role === role);
        assert.ok(endpoint, "Unknown owned public endpoint");
        const url = new URL(endpoint.url);
        assert.equal(url.protocol, "https:");
        return url.origin;
      },
    );
}
