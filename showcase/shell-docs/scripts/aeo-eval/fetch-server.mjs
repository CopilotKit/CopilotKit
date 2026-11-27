// A stdio MCP server with one tool, `fetch`, for the web mode of the AEO eval.
//
// The agent sees a plain web fetch. It works for every URL, and its name and
// description do not name any product. When DOCS_BASE_URL is set, a request
// for a docs.copilotkit.ai page is served from that docs build (a local branch
// build) instead of production, and the build's own origin in the page text is
// rewritten back to https://docs.copilotkit.ai. Every other URL is fetched live.
//
// Env:
//   DOCS_BASE_URL  optional, for example http://127.0.0.1:3003
//   FETCH_LOG      optional, a file that gets one JSON line per fetch
//
// The protocol is newline-delimited JSON-RPC 2.0 over stdin and stdout.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const DOCS_HOST = "docs.copilotkit.ai";
const DOCS_ORIGIN = `https://${DOCS_HOST}`;
const DOCS_BASE = process.env.DOCS_BASE_URL?.replace(/\/$/, "") || null;
const LOG = process.env.FETCH_LOG || null;
const MAX_CHARS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; docs-eval/1.0)";

const TOOL = {
  name: "fetch",
  description:
    "Fetch a web page by URL and return its readable text. Use it to read any page, including pages found with web search.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http or https URL" },
    },
    required: ["url"],
  },
};

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

// Crude HTML to text: keeps headings, list items, and link targets so the
// agent can navigate. Good enough to read docs, blogs, and READMEs.
function htmlToText(html, baseUrl) {
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(
    /<(script|style|noscript|svg|head|iframe|template)\b[\s\S]*?<\/\1>/gi,
    "",
  );
  s = s.replace(
    /<a\b[^>]*href=(?:["']([^"'#][^"']*)["']|([^\s"'>#][^\s>]*))[^>]*>([\s\S]*?)<\/a>/gi,
    (_, quoted, bare, inner) => {
      const href = quoted ?? bare;
      const label = inner.replace(/<[^>]+>/g, "").trim();
      let abs = href;
      try {
        abs = new URL(href, baseUrl).href;
      } catch {}
      return label ? `[${label}](${abs})` : "";
    },
  );
  s = s.replace(
    /<h([1-6])\b[^>]*>/gi,
    (_, n) => `\n\n${"#".repeat(Number(n))} `,
  );
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(
    /<(br|\/p|\/div|\/h[1-6]|\/tr|\/pre|\/section)\b[^>]*>/gi,
    "\n",
  );
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function branchUrl(url) {
  let path = url.pathname.replace(/\/$/, "") || "/";
  if (path !== "/" && !/\.[a-z]+$/i.test(path)) path += ".md";
  return `${DOCS_BASE}${path}${url.search}`;
}

// Follows redirects by hand, so a live URL that redirects to the docs host is
// also served from the branch build.
async function fetchPage(rawUrl) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 6; hop++) {
    const toBranch = DOCS_BASE !== null && url.hostname === DOCS_HOST;
    let target = toBranch ? branchUrl(url) : url.href;
    let res = await fetch(target, {
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,text/markdown,text/plain,*/*",
      },
      signal: AbortSignal.timeout(30_000),
    });
    // Not every docs route has a Markdown twin. Fall back to the HTML page.
    if (toBranch && res.status === 404 && target.endsWith(".md")) {
      target = `${DOCS_BASE}${url.pathname}${url.search}`;
      res = await fetch(target, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      // A branch redirect is relative to the branch build; map it back to the
      // public docs host before the next hop.
      const next = new URL(location, target);
      if (toBranch && next.origin === new URL(DOCS_BASE).origin) {
        // Drop the .md this server added, so the agent sees production's URL.
        const path = next.pathname.replace(/\.md$/, "");
        url = new URL(`${path}${next.search}`, DOCS_ORIGIN);
      } else {
        url = next;
      }
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    let text = await res.text();
    if (/html/i.test(type)) text = htmlToText(text, url.href);
    if (toBranch) text = text.split(DOCS_BASE).join(DOCS_ORIGIN);
    return {
      url: url.href,
      status: res.status,
      route: toBranch ? "branch" : "live",
      text,
    };
  }
  throw new Error("Too many redirects");
}

async function callFetch(args) {
  const requested = String(args?.url ?? "");
  let record = { url: requested };
  try {
    if (!/^https?:\/\//i.test(requested))
      throw new Error("URL must start with http:// or https://");
    const page = await fetchPage(requested);
    record = {
      ...record,
      finalUrl: page.url,
      route: page.route,
      status: page.status,
      chars: page.text.length,
    };
    const body =
      page.text.length > MAX_CHARS
        ? `${page.text.slice(0, MAX_CHARS)}\n\n[truncated]`
        : page.text;
    const ok = page.status >= 200 && page.status < 300;
    return {
      content: [
        {
          type: "text",
          text: `URL: ${page.url}\nStatus: ${page.status}\n\n${body || "(empty page)"}`,
        },
      ],
      isError: !ok,
    };
  } catch (e) {
    record = { ...record, error: e.message };
    return {
      content: [{ type: "text", text: `Fetch failed: ${e.message}` }],
      isError: true,
    };
  } finally {
    if (LOG) appendFileSync(LOG, JSON.stringify(record) + "\n");
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no reply
  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "web", version: "1.0.0" },
      },
    });
  } else if (method === "tools/list") {
    send({ id, result: { tools: [TOOL] } });
  } else if (method === "tools/call") {
    if (params?.name !== TOOL.name) {
      send({
        id,
        error: { code: -32602, message: `Unknown tool ${params?.name}` },
      });
      return;
    }
    send({ id, result: await callFetch(params.arguments) });
  } else if (method === "ping") {
    send({ id, result: {} });
  } else {
    send({
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
});
