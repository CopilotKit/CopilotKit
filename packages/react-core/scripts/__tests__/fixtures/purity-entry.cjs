// CJS mirror of purity-entry.mjs: an entry that names no dependency and reaches
// one only through a relative `require()` edge, bundled through the script's
// `format: "cjs"` branch.
module.exports = require("./purity-chunk.cjs");
