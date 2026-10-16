import assert from "node:assert/strict";
import { bindBootstrap } from "./bootstrap.mjs";
/** Resolve recorded ownership names, or the stable ordinal for a planned service. */
export function railwayServiceName(key, specs, journal) {
  const index = specs.findIndex((service) => service.key === key);
  assert.ok(index >= 0, "Unknown private service binding");
  return (
    journal.services.find((service) => service.key === key)?.name ??
    `${journal.environmentName}-${index.toString(36)}`
  );
}
export function bindServiceVariables(value, specs, journal) {
  return bindBootstrap(String(value), journal.bootstrap)
    .replace(/\{\{service:([a-z0-9-]+):host\}\}/g, (_match, key) => {
      return `${railwayServiceName(key, specs, journal)}.railway.internal`;
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
