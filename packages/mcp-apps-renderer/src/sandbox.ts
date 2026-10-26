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
 * The flags used before the safe default, kept only for
 * `allowSameOriginFallback`. Unsafe with a `srcdoc` proxy: the widget runs
 * with the host origin.
 */
const SAME_ORIGIN_SANDBOX_FLAGS = "allow-scripts allow-same-origin allow-forms";

/**
 * The `sandbox` attribute for the proxy and widget frames.
 *
 * @param allowSameOriginFallback Restore `allow-same-origin`. Unsafe: the
 *   widget then runs with the host's origin. See `McpAppSessionOptions`.
 */
export function ɵmcpAppSandboxFlags(allowSameOriginFallback = false): string {
  return allowSameOriginFallback ? SAME_ORIGIN_SANDBOX_FLAGS : SANDBOX_FLAGS;
}

/**
 * Build the sandbox-proxy HTML document loaded into the outer iframe.
 *
 * The proxy relays postMessage between the host and the inner sandboxed widget
 * and announces `ui/notifications/sandbox-proxy-ready` once ready. The host
 * sets the widget frame's sandbox flags in `sandbox-resource-ready`; the
 * template default is the safe one. Messages from the widget whose method
 * starts with `ui/notifications/sandbox-` are reserved for the proxy (spec
 * item 6) and are not relayed, so a widget cannot forge the handshake. `extraCspDomains`
 * (from the resource's `_meta.ui.csp`) are appended to the `script-src`/`frame-src`
 * CSP directives so a widget can load its own approved origins.
 *
 * @param extraCspDomains Optional additional origins allowed by the sandbox CSP.
 * @returns The complete sandbox-proxy HTML document as a string.
 */
export function buildSandboxHTML(extraCspDomains?: string[]): string {
  const baseScriptSrc =
    "'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*";
  const baseFrameSrc = "* blob: data: http://localhost:* https://localhost:*";
  const extra = extraCspDomains?.length ? " " + extraCspDomains.join(" ") : "";
  const scriptSrc = baseScriptSrc + extra;
  const frameSrc = baseFrameSrc + extra;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src ${scriptSrc}; style-src * blob: data: 'unsafe-inline'; connect-src *; frame-src ${frameSrc}; base-uri 'self';" />
<style>html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden}*{box-sizing:border-box}iframe{background-color:transparent;border:none;padding:0;overflow:hidden;width:100%;height:100%}</style>
</head>
<body>
<script>
if(window.self===window.top){throw new Error("This file must be used in an iframe.")}
const inner=document.createElement("iframe");
inner.style="width:100%;height:100%;border:none;";
inner.setAttribute("sandbox","${SANDBOX_FLAGS}");
document.body.appendChild(inner);
window.addEventListener("message",async(event)=>{
if(event.source===window.parent){
if(event.data&&event.data.method==="ui/notifications/sandbox-resource-ready"){
const{html,sandbox}=event.data.params;
if(typeof sandbox==="string")inner.setAttribute("sandbox",sandbox);
if(typeof html==="string")inner.srcdoc=html;
}else if(inner&&inner.contentWindow){
inner.contentWindow.postMessage(event.data,"*");
}
}else if(event.source===inner.contentWindow){
if(event.data&&typeof event.data.method==="string"&&event.data.method.startsWith("ui/notifications/sandbox-"))return;
window.parent.postMessage(event.data,"*");
}
});
window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}},"*");
</script>
</body>
</html>`;
}
