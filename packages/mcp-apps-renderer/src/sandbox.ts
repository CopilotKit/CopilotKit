/**
 * Sandbox flags for both the proxy frame and the widget frame.
 *
 * SEP-1865 grants `allow-same-origin` only together with a Sandbox that has a
 * different origin from the Host. The proxy is loaded via `srcdoc`, which
 * inherits the host origin, so granting `allow-same-origin` here would give
 * the widget the host's cookies, storage and DOM. Without it the widget gets
 * an opaque origin and the postMessage relay still works.
 */
const SANDBOX_FLAGS = "allow-scripts allow-forms";

/**
 * The flags with `allow-same-origin`. Safe only when the proxy is served from
 * a separate origin (`sandboxOrigin`); with a `srcdoc` proxy
 * (`allowSameOriginFallback`) the widget runs with the host origin.
 */
const SAME_ORIGIN_SANDBOX_FLAGS = "allow-scripts allow-same-origin allow-forms";

/**
 * The `sandbox` attribute for the proxy and widget frames.
 *
 * @param allowSameOrigin Grant `allow-same-origin`. Safe only when the proxy
 *   is served from a separate origin. See `McpAppSessionOptions`.
 */
export function ɵmcpAppSandboxFlags(allowSameOrigin = false): string {
  return allowSameOrigin ? SAME_ORIGIN_SANDBOX_FLAGS : SANDBOX_FLAGS;
}

/**
 * A CSP host source: optional scheme, host (a leading `*.` allowed), optional
 * port and path. The domains come from the MCP server, so anything else (a
 * space, quote, `;`, `,`, `&` or `<`) could end the policy or the `<meta>` tag
 * early. The path allows CSP's own path characters, such as `+` and `@`.
 */
const CSP_HOST_SOURCE =
  /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::(?:\d+|\*))?(?:\/[\w.~%/!$()*+=:@-]*)?$/i;

/**
 * The widget CSP. `{extra}` is replaced with the resource's approved
 * `resourceDomains`: in TypeScript for the inline proxy, and in the proxy
 * script for a served one, so both modes enforce the same policy.
 */
const CSP_TEMPLATE =
  "default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*{extra}; style-src * blob: data: 'unsafe-inline'; connect-src *; frame-src * blob: data: http://localhost:* https://localhost:*{extra}; base-uri 'self';";

/** The served proxy's file name, in the package and on the sandbox origin. */
export const MCP_APPS_SANDBOX_PROXY_FILE = "mcp-apps-sandbox-proxy.html";

/**
 * The proxy document, with an optional baked-in CSP `<meta>` tag.
 *
 * The proxy relays postMessage between the host and the inner sandboxed widget
 * and announces `ui/notifications/sandbox-proxy-ready` once ready. On
 * `sandbox-resource-ready` it applies the host's sandbox flags (the template
 * default is the safe one). When the host also sends the resource's `csp`, the
 * proxy adds the widget CSP to its own document before loading the widget, and
 * the widget's `srcdoc` document inherits it. The widget frame is created only
 * then: WebKit takes the policy from when a frame was created, not from when
 * it was loaded, so a frame made at boot would miss it. Messages from the widget whose
 * method starts with `ui/notifications/sandbox-` are reserved for the proxy
 * (spec item 6) and are not relayed, so a widget cannot forge the handshake.
 */
function proxyDocument(cspMeta: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${cspMeta}<style>html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden}*{box-sizing:border-box}iframe{background-color:transparent;border:none;padding:0;overflow:hidden;width:100%;height:100%}</style>
</head>
<body>
<script>
if(window.self===window.top){throw new Error("This file must be used in an iframe.")}
const CSP_HOST_SOURCE=${CSP_HOST_SOURCE};
const CSP_TEMPLATE=${JSON.stringify(CSP_TEMPLATE)};
let inner=null;
window.addEventListener("message",async(event)=>{
if(event.source===window.parent){
if(event.data&&event.data.method==="ui/notifications/sandbox-resource-ready"){
const{html,sandbox,csp}=event.data.params;
if(csp&&typeof csp==="object"){
const domains=(Array.isArray(csp.resourceDomains)?csp.resourceDomains:[]).filter((d)=>typeof d==="string"&&CSP_HOST_SOURCE.test(d));
const meta=document.createElement("meta");
meta.setAttribute("http-equiv","Content-Security-Policy");
meta.setAttribute("content",CSP_TEMPLATE.split("{extra}").join(domains.length?" "+domains.join(" "):""));
document.head.appendChild(meta);
}
if(inner)inner.remove();
inner=document.createElement("iframe");
inner.style="width:100%;height:100%;border:none;";
inner.setAttribute("sandbox",typeof sandbox==="string"?sandbox:"${SANDBOX_FLAGS}");
if(typeof html==="string")inner.srcdoc=html;
document.body.appendChild(inner);
}else if(inner&&inner.contentWindow){
inner.contentWindow.postMessage(event.data,"*");
}
}else if(inner&&event.source===inner.contentWindow){
if(event.data&&typeof event.data.method==="string"&&event.data.method.startsWith("ui/notifications/sandbox-"))return;
window.parent.postMessage(event.data,"*");
}
});
window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}},"*");
</script>
</body>
</html>`;
}

/**
 * Build the sandbox-proxy HTML document loaded into the outer iframe via
 * `srcdoc`. `extraCspDomains` (from the resource's `_meta.ui.csp`) are
 * appended to the `script-src`/`frame-src` CSP directives so a widget can load
 * its own approved origins.
 *
 * @param extraCspDomains Optional additional origins allowed by the sandbox CSP.
 * @returns The complete sandbox-proxy HTML document as a string.
 */
export function buildSandboxHTML(extraCspDomains?: string[]): string {
  const domains = (extraCspDomains ?? []).filter(
    (domain) => typeof domain === "string" && CSP_HOST_SOURCE.test(domain),
  );
  const policy = CSP_TEMPLATE.split("{extra}").join(
    domains.length ? " " + domains.join(" ") : "",
  );
  return proxyDocument(
    `<meta http-equiv="Content-Security-Policy" content="${policy}" />\n`,
  );
}

/**
 * The static sandbox-proxy document for `sandboxOrigin`, shipped in the package
 * as `mcp-apps-sandbox-proxy.html`. It has no CSP of its own: a `srcdoc`
 * widget inherits its parent's policy, so a baked-in one would bind every
 * widget. The host sends each resource's `csp` instead, and the proxy applies
 * it before loading the widget.
 */
export function buildSandboxProxyHTML(): string {
  return proxyDocument("");
}
