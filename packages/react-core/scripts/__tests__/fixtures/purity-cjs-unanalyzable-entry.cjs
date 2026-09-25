// CJS fail-loud fixture. Two shapes in one file, both of which the pre-tokenizer
// detector called clean:
//   • `__require(name)` — rolldown's CJS-interop shim, which a `\brequire`
//     word-boundary pattern cannot match (there is no boundary inside `__require`).
//   • `require("zo" + name)` — a concatenation that merely STARTS with a quote,
//     which the old "first character after the paren" test read as a static literal.
// The innocent counter-examples on either side must stay silent.
const staticOk = require("./purity-chunk.cjs");
const message = "call require(path) with a literal";

module.exports = {
  staticOk,
  message,
  rolldown: (name) => __require(name),
  concatenated: (name) => require("zo" + name),
};
