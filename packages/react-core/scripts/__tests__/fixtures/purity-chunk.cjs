// The CommonJS half of the graph fixtures. Exists because every other fixture is
// `.mjs`, which left the script's `format: "cjs"` branch — and the `require()`
// loader shape it is meant to cover — completely unexercised.
// `zod` stands in for a forbidden dep (a real dependency of this package, so it
// resolves through node_modules exactly as shiki/streamdown would).
const { z } = require("zod");

module.exports = { schema: z.string() };
