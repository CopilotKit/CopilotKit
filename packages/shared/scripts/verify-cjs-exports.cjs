(async () => {
  const { pathToFileURL } = require("node:url");

  // Verify telemetry subpath exports (lambdaClient is now in /telemetry, not main export)
  const cjsTelemetry = require("../dist/telemetry-server.cjs");

  if (typeof cjsTelemetry.lambdaClient?.send !== "function") {
    throw new Error(
      "Expected CommonJS telemetry export lambdaClient.send to be a function",
    );
  }

  const esmTelemetry = await import(
    pathToFileURL(require.resolve("../dist/telemetry-server.mjs"))
  );
  if (typeof esmTelemetry.lambdaClient?.send !== "function") {
    throw new Error(
      "Expected ESM telemetry export lambdaClient.send to be a function",
    );
  }
})();
