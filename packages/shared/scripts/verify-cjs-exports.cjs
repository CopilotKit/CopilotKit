(async () => {
  const { pathToFileURL } = require("node:url");

  const cjs = require("../dist/index.cjs");

  if (typeof cjs.lambdaClient?.send !== "function") {
    throw new Error(
      "Expected CommonJS export lambdaClient.send to be a function",
    );
  }

  const esm = await import(pathToFileURL(require.resolve("../dist/index.mjs")));
  if (typeof esm.lambdaClient?.send !== "function") {
    throw new Error("Expected ESM export lambdaClient.send to be a function");
  }
})();
