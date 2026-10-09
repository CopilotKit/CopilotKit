// Mirrors the 1.69.2 defect: every side-effect import tree-shaken away.
const require_streaming_fetch = require("./streaming-fetch.cjs");
require_streaming_fetch.installStreamingFetch();
