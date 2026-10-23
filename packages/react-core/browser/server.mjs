import { build } from "esbuild";
import { createServer } from "node:http";
const result = await build({
  entryPoints: ["browser/entry.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
});
createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "text/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? result.outputFiles[0].contents
      : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>',
  );
}).listen(15185, "127.0.0.1");
