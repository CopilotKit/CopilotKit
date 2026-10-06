// Diagnostic capture proxy: listens on $1 (default 4412), forwards every
// request byte-for-byte (method, path, headers, body) to AIMock on
// 127.0.0.1:4410, and appends one JSON line per request to $2 with the FULL
// request body (AIMock's journal caps bodies at 64 KB) and the response status.
// usage: node lgts-capture-proxy-20261006.mjs <port> <out.jsonl>
import http from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 4412);
const out = process.argv[3];
http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: 4410,
          method: req.method,
          path: req.url,
          headers: req.headers,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
          let parsed = null;
          try {
            parsed = JSON.parse(body.toString("utf8"));
          } catch {
            parsed = body.toString("utf8");
          }
          appendFileSync(
            out,
            JSON.stringify({
              ts: new Date().toISOString(),
              method: req.method,
              path: req.url,
              headers: req.headers,
              status: up.statusCode,
              body: parsed,
            }) + "\n",
          );
        },
      );
      upstream.on("error", (e) => {
        res.writeHead(502);
        res.end(String(e));
      });
      upstream.end(body);
    });
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`capture proxy :${port} -> 127.0.0.1:4410, writing ${out}`),
  );
