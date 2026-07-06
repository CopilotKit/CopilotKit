import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { setWriter, clearWriter, wasClientToolCalled, clearClientToolCalled, clearClientToolNames, } from "./tool-store.js";
import { aguiChannelPlugin } from "./channel.js";
import { resolveGatewaySecret } from "./gateway-secret.js";
// ---------------------------------------------------------------------------
// Lightweight HTTP helpers (no internal imports needed)
// ---------------------------------------------------------------------------
function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}
function sendMethodNotAllowed(res) {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
}
function sendUnauthorized(res) {
    sendJson(res, 401, { error: { message: "Authentication required", type: "unauthorized" } });
}
function readJsonBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
            }
            catch {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}
function getBearerToken(req) {
    const raw = req.headers.authorization?.trim() ?? "";
    if (!raw.toLowerCase().startsWith("bearer ")) {
        return undefined;
    }
    return raw.slice(7).trim() || undefined;
}
// ---------------------------------------------------------------------------
// Session-key header validation
// ---------------------------------------------------------------------------
/**
 * Validate an `X-OpenClaw-Session-Key` header value.
 *
 * Returns the trimmed value if valid, or `null` if it must be rejected.
 * The header is intended to be set by a trusted reverse proxy that has
 * already authenticated the user — we still validate defensively so a
 * misconfigured proxy or a bypass cannot introduce path-traversal or
 * oversized keys into the session store.
 */
function validateSessionKeyHeader(raw) {
    const v = raw.trim();
    if (!v || v.length > 256)
        return null;
    if (v.includes("..") || /[/\\\0]/.test(v))
        return null;
    if (!/^[A-Za-z0-9._@:-]+$/.test(v))
        return null;
    return v;
}
// ---------------------------------------------------------------------------
// HMAC-signed device token utilities
// ---------------------------------------------------------------------------
function createDeviceToken(secret, deviceId) {
    const encodedId = Buffer.from(deviceId).toString("base64url");
    const signature = createHmac("sha256", secret).update(deviceId).digest("hex").slice(0, 32);
    return `${encodedId}.${signature}`;
}
function verifyDeviceToken(token, secret) {
    const dotIndex = token.indexOf(".");
    if (dotIndex <= 0 || dotIndex >= token.length - 1) {
        return null;
    }
    const encodedId = token.slice(0, dotIndex);
    const providedSig = token.slice(dotIndex + 1);
    try {
        const deviceId = Buffer.from(encodedId, "base64url").toString("utf-8");
        // Validate it looks like a UUID
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
            return null;
        }
        const expectedSig = createHmac("sha256", secret).update(deviceId).digest("hex").slice(0, 32);
        // Constant-time comparison
        if (providedSig.length !== expectedSig.length) {
            return null;
        }
        const providedBuf = Buffer.from(providedSig);
        const expectedBuf = Buffer.from(expectedSig);
        if (!timingSafeEqual(providedBuf, expectedBuf)) {
            return null;
        }
        return deviceId;
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Extract text from AG-UI messages
// ---------------------------------------------------------------------------
function extractTextContent(msg) {
    const content = msg.content;
    if (typeof content === "string") {
        return content;
    }
    // Multimodal messages carry an array of typed blocks; collapse the text
    // blocks to a plain string (image blocks are handled by
    // extractImagesFromMessages). Mirrors the ACP/Hermes text-only extraction.
    if (Array.isArray(content)) {
        const parts = [];
        for (const block of content) {
            if (!block || typeof block !== "object")
                continue;
            const text = block.text;
            if (typeof text === "string" && text)
                parts.push(text);
        }
        return parts.join("");
    }
    return "";
}
// ---------------------------------------------------------------------------
// Build MsgContext-compatible body from AG-UI messages
// ---------------------------------------------------------------------------
function buildBodyFromMessages(messages) {
    const systemParts = [];
    const parts = [];
    let lastUserBody = "";
    let lastToolBody = "";
    for (const msg of messages) {
        const role = msg.role?.trim() ?? "";
        const content = extractTextContent(msg).trim();
        // Allow messages with no content (e.g., assistant with only toolCalls)
        if (!role) {
            continue;
        }
        if (role === "system") {
            if (content)
                systemParts.push(content);
            continue;
        }
        if (role === "user") {
            lastUserBody = content;
            if (content)
                parts.push(`User: ${content}`);
        }
        else if (role === "assistant") {
            if (content)
                parts.push(`Assistant: ${content}`);
        }
        else if (role === "tool") {
            lastToolBody = content;
            if (content)
                parts.push(`Tool result: ${content}`);
        }
    }
    // If there's only a single user message, use it directly (no envelope needed)
    // If there's only a tool result (resuming after client tool), use it directly
    const userMessages = messages.filter((m) => m.role === "user");
    const toolMessages = messages.filter((m) => m.role === "tool");
    let body;
    if (userMessages.length === 1 && parts.length === 1) {
        body = lastUserBody;
    }
    else if (userMessages.length === 0 && toolMessages.length > 0 && parts.length === toolMessages.length) {
        // Tool-result-only submission: format as tool result for agent context
        body = `Tool result: ${lastToolBody}`;
    }
    else {
        body = parts.join("\n");
    }
    return {
        body,
        systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    };
}
// ---------------------------------------------------------------------------
// Build a full-history prompt for client-tool (frontend-tool) runs
// ---------------------------------------------------------------------------
/**
 * Render the entire AG-UI conversation into a single prompt for a stateless
 * `runEmbeddedAgent` turn.
 *
 * Frontend-tool runs go through OpenClaw's caller-provided `clientTools` path
 * (not the channel reply pipeline), and CopilotKit re-sends the complete
 * message history on every request — including the assistant's prior tool
 * calls and their results. We run each such turn against a fresh ephemeral
 * session, so continuity must live in the prompt rather than a server-side
 * transcript. That means we have to render assistant `toolCalls` and `tool`
 * results explicitly: after the browser executes a client tool and re-submits,
 * the model needs to see "I called change_background({...}) → result X" to
 * continue coherently instead of just an orphaned "Tool result:" line.
 */
function buildToolRunHistory(messages) {
    const systemParts = [];
    const lines = [];
    // Map toolCallId → toolName so tool-result messages can be labeled with the
    // tool they answer (the tool message itself only carries the call id).
    const toolNameById = new Map();
    for (const msg of messages) {
        const toolCalls = msg.toolCalls;
        if (Array.isArray(toolCalls)) {
            for (const call of toolCalls) {
                if (call?.id)
                    toolNameById.set(call.id, call.function?.name ?? "tool");
            }
        }
    }
    for (const msg of messages) {
        const role = msg.role?.trim() ?? "";
        const content = extractTextContent(msg).trim();
        if (role === "system") {
            if (content)
                systemParts.push(content);
            continue;
        }
        if (role === "user") {
            if (content)
                lines.push(`User: ${content}`);
            continue;
        }
        if (role === "assistant") {
            if (content)
                lines.push(`Assistant: ${content}`);
            const toolCalls = msg.toolCalls;
            if (Array.isArray(toolCalls)) {
                for (const call of toolCalls) {
                    const name = call.function?.name ?? "tool";
                    const args = call.function?.arguments ?? "";
                    lines.push(`Assistant called tool ${name}(${args})`);
                }
            }
            continue;
        }
        if (role === "tool") {
            const toolCallId = msg.toolCallId;
            const name = toolCallId ? toolNameById.get(toolCallId) ?? "tool" : "tool";
            lines.push(`Tool ${name} returned: ${content}`);
            continue;
        }
    }
    return {
        prompt: lines.join("\n"),
        systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    };
}
// ---------------------------------------------------------------------------
// Format AG-UI context entries for the LLM prompt
// ---------------------------------------------------------------------------
function formatContextEntries(context) {
    const entries = context.filter((c) => c.description || c.value);
    if (entries.length === 0)
        return undefined;
    const parts = entries.map((c) => `### ${c.description}\n${c.value}`);
    return `\n\n## Context provided by the UI\n\n${parts.join("\n\n")}`;
}
// ---------------------------------------------------------------------------
// Bidirectional shared state (AG-UI STATE_SNAPSHOT)
// ---------------------------------------------------------------------------
/**
 * State-writer tools follow the fleet convention (claude-sdk, langgraph, the
 * Hermes AG-UI adapter): the frontend DECLARES which tools write which piece of
 * shared state via `RunAgentInput.forwardedProps.stateWriterTools`, and the
 * adapter turns each call into a STATE_SNAPSHOT. On OpenClaw the declared tools
 * are injected into the model's `clientTools` list (the only tool list that
 * reaches the model) and intercepted server-side, so the frontend needs only
 * the declaration — no per-tool handler and no browser round-trip.
 *
 * Declaration shape (per entry):
 *   { name, stateKey?, arg?, mode?: "replace"|"append", description?, parameters? }
 * - stateKey: the top-level state key the tool writes (omit -> merge the whole
 *   args object into the top-level state).
 * - arg: which tool argument carries the value (omit -> the whole args object).
 * - mode: "replace" (default) sets state[stateKey] = value; "append" pushes the
 *   value onto state[stateKey] as a list.
 */
const STATE_WRITER_PROPS_KEY = "stateWriterTools";
function isSharedState(state) {
    return (!!state &&
        typeof state === "object" &&
        !Array.isArray(state) &&
        Object.keys(state).length > 0);
}
/**
 * Parse `forwardedProps.stateWriterTools` into (specs, schemas). Accepts a list
 * of decl objects (each carrying its own `name`) or a name->decl map. Returns
 * empty when nothing is declared.
 */
function parseStateWriterTools(forwardedProps) {
    const specs = new Map();
    const schemas = [];
    const props = forwardedProps && typeof forwardedProps === "object"
        ? forwardedProps
        : undefined;
    const raw = props?.[STATE_WRITER_PROPS_KEY];
    if (!raw)
        return { specs, schemas };
    const decls = [];
    if (Array.isArray(raw)) {
        for (const d of raw)
            if (d && typeof d === "object")
                decls.push(d);
    }
    else if (typeof raw === "object") {
        for (const [name, d] of Object.entries(raw)) {
            const entry = (d && typeof d === "object" ? { ...d } : {});
            if (entry.name == null)
                entry.name = name;
            decls.push(entry);
        }
    }
    for (const decl of decls) {
        const name = typeof decl.name === "string" ? decl.name : undefined;
        if (!name)
            continue;
        specs.set(name, {
            stateKey: typeof decl.stateKey === "string" ? decl.stateKey : "",
            arg: typeof decl.arg === "string" ? decl.arg : undefined,
            mode: decl.mode === "append" ? "append" : "replace",
        });
        schemas.push({
            type: "function",
            function: {
                name,
                description: typeof decl.description === "string"
                    ? decl.description
                    : "Update shared UI state.",
                parameters: decl.parameters && typeof decl.parameters === "object"
                    ? decl.parameters
                    : { type: "object", properties: {} },
            },
        });
    }
    return { specs, schemas };
}
/** Merge a state-writer call's args into `state` per its spec (mutates state). */
function applyStateWriter(state, spec, args) {
    const value = spec.arg === undefined ? args : args[spec.arg];
    if (spec.stateKey) {
        if (spec.mode === "append") {
            const current = state[spec.stateKey];
            const list = Array.isArray(current) ? [...current] : [];
            list.push(value);
            state[spec.stateKey] = list;
        }
        else {
            state[spec.stateKey] = value;
        }
    }
    else if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(state, value);
    }
}
/**
 * Render `RunAgentInput.state` into a prompt block so the model can read the
 * UI's live state, listing the declared writer tools it can call to change it.
 */
function formatSharedState(state, writerNames) {
    if (!isSharedState(state))
        return undefined;
    let json;
    try {
        json = JSON.stringify(state, null, 2);
    }
    catch {
        return undefined;
    }
    const howToChange = writerNames.length
        ? `\n\nTo change it, call the appropriate tool (${writerNames
            .map((n) => `\`${n}\``)
            .join(", ")}).`
        : "";
    return (`\n\n## Shared application state\n\n` +
        `The UI shares this live state with you (JSON):\n\n` +
        "```json\n" +
        `${json}\n` +
        "```" +
        howToChange);
}
function stripDataUriPrefix(value) {
    if (!value.startsWith("data:"))
        return value;
    const comma = value.indexOf(",");
    return comma >= 0 ? value.slice(comma + 1) : value;
}
function parseDataUri(value) {
    if (!value.startsWith("data:"))
        return null;
    const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(value);
    if (!match)
        return null;
    return { mimeType: match[1] || "image/png", data: match[2] };
}
/**
 * Turn one AG-UI content block into an OpenClaw image, or null if it is not an
 * image. Tolerates the shapes CopilotKit / AG-UI emit: an `image` block with a
 * `source` ({type:"data"|"url", value, mimeType}), an `image_url` block
 * ({url}|string), or a flat {data, mimeType}. `url` sources are only usable
 * when they are `data:` URIs (OpenClaw needs inline base64, not a remote fetch).
 */
function imageBlockToContent(block) {
    if (!block || typeof block !== "object")
        return null;
    const b = block;
    const btype = b.type;
    if (btype !== "image" && btype !== "image_url" && btype !== "input_image") {
        return null;
    }
    const source = b.source;
    if (source && typeof source === "object") {
        const value = typeof source.value === "string" ? source.value : undefined;
        const mime = (typeof source.mimeType === "string" && source.mimeType) ||
            (typeof source.mime_type === "string" && source.mime_type) ||
            undefined;
        if (value) {
            if (source.type === "data") {
                return { type: "image", data: stripDataUriPrefix(value), mimeType: mime || "image/png" };
            }
            const parsed = parseDataUri(value);
            if (parsed)
                return { type: "image", ...parsed };
        }
    }
    const imageUrl = b.image_url;
    const url = imageUrl && typeof imageUrl === "object"
        ? imageUrl.url
        : imageUrl;
    if (typeof url === "string") {
        const parsed = parseDataUri(url);
        if (parsed)
            return { type: "image", ...parsed };
    }
    if (typeof b.data === "string" && b.data) {
        const mime = (typeof b.mimeType === "string" && b.mimeType) ||
            (typeof b.mime_type === "string" && b.mime_type) ||
            "image/png";
        return { type: "image", data: stripDataUriPrefix(b.data), mimeType: mime };
    }
    return null;
}
/** Collect every image block across the AG-UI messages, in order. */
function extractImagesFromMessages(messages) {
    const images = [];
    for (const msg of messages) {
        const content = msg.content;
        if (!Array.isArray(content))
            continue;
        for (const block of content) {
            const img = imageBlockToContent(block);
            if (img)
                images.push(img);
        }
    }
    return images;
}
// ---------------------------------------------------------------------------
// HTTP handler factory
// ---------------------------------------------------------------------------
export function createAguiHttpHandler(api) {
    const runtime = api.runtime;
    // Resolve once at init so the per-request handler never touches env vars.
    const gatewaySecret = resolveGatewaySecret(api);
    return async function handleAguiRequest(req, res) {
        // Cross-origin callers (for example a clawpilotkit standalone launcher
        // running on a separate port) need CORS response headers — both on the
        // OPTIONS preflight and on the eventual POST. Bearer auth + JSON body
        // forces a preflight, so we have to answer 204 here. The route's
        // gateway-side auth still requires a valid pairing token on the actual
        // POST: CORS only governs which origins can read the response.
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "86400");
        if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
        }
        // POST-only
        if (req.method !== "POST") {
            sendMethodNotAllowed(res);
            return;
        }
        // Verify gateway secret was resolved at startup
        if (!gatewaySecret) {
            sendJson(res, 500, {
                error: { message: "Gateway not configured", type: "server_error" },
            });
            return;
        }
        // ---------------------------------------------------------------------------
        // Authentication: No auth (pairing initiation) or Device token
        // ---------------------------------------------------------------------------
        let deviceId;
        const bearerToken = getBearerToken(req);
        if (!bearerToken) {
            // No auth header: initiate pairing
            // Generate new device ID
            deviceId = randomUUID();
            // Add to pending via OpenClaw pairing API - returns a pairing code for approval
            const { code: pairingCode } = await runtime.channel.pairing.upsertPairingRequest({
                channel: "clawg-ui",
                accountId: "default",
                id: deviceId,
                pairingAdapter: aguiChannelPlugin.pairing,
            });
            // Rate limit reached - max pending requests exceeded
            if (!pairingCode) {
                sendJson(res, 429, {
                    error: {
                        type: "rate_limit",
                        message: "Too many pending pairing requests. Please wait for existing requests to expire (10 minutes) or ask the owner to approve/reject them.",
                    },
                });
                return;
            }
            // Generate signed device token
            const deviceToken = createDeviceToken(gatewaySecret, deviceId);
            // Return pairing pending response with device token and pairing code
            sendJson(res, 403, {
                pairing_code: pairingCode,
                bearer_token: deviceToken,
                error: {
                    type: "pairing_pending",
                    message: "Device pending approval",
                    pairing: {
                        pairingCode,
                        token: deviceToken,
                        instructions: `Save this token for use as a Bearer token and ask the owner to approve: openclaw pairing approve clawg-ui ${pairingCode}`,
                    },
                },
            });
            return;
        }
        // Device token flow: verify HMAC signature, extract device ID
        const extractedDeviceId = verifyDeviceToken(bearerToken, gatewaySecret);
        if (!extractedDeviceId) {
            sendUnauthorized(res);
            return;
        }
        deviceId = extractedDeviceId;
        // ---------------------------------------------------------------------------
        // Pairing check: verify device is approved
        // ---------------------------------------------------------------------------
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types lag behind runtime; object form required in 2026.3.7+
        const storeAllowFrom = await runtime.channel.pairing.readAllowFromStore({ channel: "clawg-ui" })
            .catch(() => []);
        const normalizedAllowFrom = storeAllowFrom.map((e) => e.replace(/^clawg-ui:/i, "").toLowerCase());
        const allowed = normalizedAllowFrom.includes(deviceId.toLowerCase());
        if (!allowed) {
            sendJson(res, 403, {
                error: {
                    type: "pairing_pending",
                    message: "Device pending approval. Ask the owner to approve using the pairing code from your initial pairing response.",
                },
            });
            return;
        }
        // ---------------------------------------------------------------------------
        // Device approved - proceed with request
        // ---------------------------------------------------------------------------
        await dispatchAuthenticatedAguiRequest(req, res, runtime, {
            id: deviceId,
            fromLabel: `clawg-ui:${deviceId}`,
        });
    };
}
/**
 * Factory for the operator-auth AG-UI route.
 *
 * Mounted at a separate path (e.g. `/v1/clawg-ui/operator`) with
 * `auth: "gateway"` — the OpenClaw gateway validates the caller's operator
 * scopes before we see the request, so we skip the device-pairing dance. The
 * AG-UI dispatch logic itself is identical to the device-token path.
 *
 * Intended for operator-UI-embedded consumers (plugin-contributed UI slots)
 * that already hold an OpenClaw gateway token via `ExtensionTabContext` and
 * should not need a second pairing flow.
 */
export function createOperatorAguiHttpHandler(api) {
    const runtime = api.runtime;
    return async function handleOperatorAguiRequest(req, res) {
        // This route is reached from the OpenClaw operator console's
        // `chat.surface` slot, which runs inside a sandboxed iframe without
        // `allow-same-origin` — the iframe's document origin is opaque ("null").
        // Any fetch from that context is treated by the browser as cross-origin
        // and requires CORS response headers; an `Authorization` request header
        // forces a preflight OPTIONS we also have to satisfy. `*` is safe here
        // because the route still requires the gateway operator token, which the
        // browser's SOP prevents a third-party origin from minting.
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "86400");
        if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
        }
        if (req.method !== "POST") {
            sendMethodNotAllowed(res);
            return;
        }
        await dispatchAuthenticatedAguiRequest(req, res, runtime, {
            id: OPERATOR_CALLER_ID,
            fromLabel: "clawg-ui:operator",
        });
    };
}
// ---------------------------------------------------------------------------
// Post-authentication AG-UI dispatch (shared by pairing + operator routes)
// ---------------------------------------------------------------------------
const OPERATOR_CALLER_ID = "openclaw-operator";
async function dispatchAuthenticatedAguiRequest(req, res, runtime, caller) {
    // Parse body
    let body;
    try {
        body = await readJsonBody(req, 1024 * 1024);
    }
    catch (err) {
        sendJson(res, 400, {
            error: { message: String(err), type: "invalid_request_error" },
        });
        return;
    }
    const input = body;
    const threadId = input.threadId || `clawg-ui-${randomUUID()}`;
    const runId = input.runId || `clawg-ui-run-${randomUUID()}`;
    // Validate messages
    const messages = Array.isArray(input.messages)
        ? input.messages
        : [];
    const hasUserMessage = messages.some((m) => m.role === "user");
    const hasToolMessage = messages.some((m) => m.role === "tool");
    if (!hasUserMessage && !hasToolMessage) {
        // AG-UI protocol allows empty messages (used for session init/sync).
        // Return a valid empty run instead of 400.
        const accept = typeof req.headers.accept === "string"
            ? req.headers.accept
            : "text/event-stream";
        const encoder = new EventEncoder({ accept });
        res.statusCode = 200;
        res.setHeader("Content-Type", encoder.getContentType());
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
        res.write(encoder.encode({ type: EventType.RUN_STARTED, threadId, runId }));
        res.write(encoder.encode({ type: EventType.RUN_FINISHED, threadId, runId }));
        res.end();
        return;
    }
    // Build body from messages
    const { body: messageBody } = buildBodyFromMessages(messages);
    // Format AG-UI context entries (if any) for injection into the agent prompt
    const contextSuffix = Array.isArray(input.context) && input.context.length > 0
        ? formatContextEntries(input.context)
        : undefined;
    // Bidirectional shared state: the frontend declares its state-writer tools
    // via forwardedProps.stateWriterTools; we inject them into clientTools below
    // and intercept the calls into STATE_SNAPSHOTs. Inbound state is rendered
    // into the prompt so the model can read (and knows how to change) it.
    const { specs: stateWriterSpecs, schemas: stateWriterSchemas } = parseStateWriterTools(input.forwardedProps);
    const stateWriterNames = [...stateWriterSpecs.keys()];
    const sharedStateSuffix = formatSharedState(input.state, stateWriterNames);
    const hasSharedState = sharedStateSuffix !== undefined;
    const hasStateWriters = stateWriterSpecs.size > 0;
    // Run-scoped shared-state store, seeded from inbound state so snapshots
    // carry UI-set keys (e.g. preferences) alongside agent-written keys.
    const runSharedState = isSharedState(input.state)
        ? { ...input.state }
        : {};
    // Multimodal: pull image content blocks out of the messages so they can be
    // sent to the model (they are dropped from the text-only prompt). Requires
    // an image-capable model config (see gateway setup); otherwise the OpenClaw
    // provider ignores them.
    const promptImages = extractImagesFromMessages(messages);
    const hasImages = promptImages.length > 0;
    if (!messageBody.trim()) {
        console.log(`[clawg-ui] 400: empty extracted body, roles=[${messages.map((m) => m.role).join(",")}], contents=[${messages.map((m) => JSON.stringify(m.content)).join(",")}]`);
        sendJson(res, 400, {
            error: {
                message: "Could not extract a prompt from `messages`.",
                type: "invalid_request_error",
            },
        });
        return;
    }
    // Resolve agent route
    const cfg = runtime.config.loadConfig();
    const agentIdHeader = typeof req.headers["x-openclaw-agent-id"] === "string"
        ? req.headers["x-openclaw-agent-id"]
        : undefined;
    // Support custom session key via header for per-user isolation.
    // Treated as a trusted-proxy-only concern (see README "Session isolation"):
    // the value only *scopes* route.sessionKey — it never replaces it.
    const sessionKeyHeader = typeof req.headers["x-openclaw-session-key"] === "string"
        ? req.headers["x-openclaw-session-key"]
        : undefined;
    let userKey;
    if (sessionKeyHeader !== undefined) {
        const validated = validateSessionKeyHeader(sessionKeyHeader);
        if (!validated) {
            sendJson(res, 400, {
                error: {
                    message: "Invalid X-OpenClaw-Session-Key header.",
                    type: "invalid_request_error",
                },
            });
            return;
        }
        userKey = validated;
    }
    const route = runtime.channel.routing.resolveAgentRoute({
        cfg,
        channel: "clawg-ui",
        peer: { kind: "direct", id: caller.id },
        accountId: agentIdHeader,
    });
    // Set up SSE via EventEncoder
    const accept = typeof req.headers.accept === "string"
        ? req.headers.accept
        : "text/event-stream";
    const encoder = new EventEncoder({ accept });
    res.statusCode = 200;
    res.setHeader("Content-Type", encoder.getContentType());
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    let closed = false;
    let currentMessageId = `msg-${randomUUID()}`;
    let messageStarted = false;
    let currentRunId = runId;
    // True once assistant text has been streamed token-by-token via
    // onPartialReply, so the block/final callbacks don't re-emit the same text.
    let streamedText = false;
    // Length of assistant text already streamed. OpenClaw's onPartialReply
    // delivers CUMULATIVE text snapshots (not deltas), so we track how much
    // we've forwarded and emit only the newly-appended suffix each time.
    let streamedTextLen = 0;
    // Reasoning & step reporting config (default on, opt-out via channel defaults)
    const channelDefaults = cfg.channels;
    const clawgDefaults = channelDefaults?.["clawg-ui"]?.defaults ?? {};
    const surfaceReasoning = clawgDefaults.surfaceReasoning !== false;
    const surfaceSteps = clawgDefaults.surfaceSteps !== false;
    // Reasoning state
    let reasoningMessageId = null;
    let reasoningStarted = false;
    // OpenClaw delivers CUMULATIVE reasoning snapshots (each callback carries the
    // full thinking text so far — see btw.ts `reasoningText += delta`). Track how
    // much we've already forwarded so we emit only the newly-appended suffix as a
    // REASONING_MESSAGE_CONTENT delta, exactly like the assistant-text path.
    // Without this the frontend stacks every snapshot into an exploding wall of
    // repeated text. Reset to 0 whenever a reasoning block closes.
    let streamedReasoningLen = 0;
    // Step reporting state
    const activeSteps = new Set();
    // Close any open reasoning block (called before RUN_FINISHED)
    const closeReasoningIfOpen = () => {
        if (reasoningStarted && reasoningMessageId) {
            writeEvent({
                type: EventType.REASONING_MESSAGE_END,
                messageId: reasoningMessageId,
            });
            writeEvent({
                type: EventType.REASONING_END,
                messageId: reasoningMessageId,
            });
            reasoningStarted = false;
            reasoningMessageId = null;
            streamedReasoningLen = 0;
        }
    };
    const writeEvent = (event) => {
        if (closed) {
            return;
        }
        try {
            res.write(encoder.encode(event));
        }
        catch {
            // Client may have disconnected
            closed = true;
        }
    };
    // Handle client disconnect
    req.on("close", () => {
        closed = true;
    });
    // Emit RUN_STARTED
    writeEvent({
        type: EventType.RUN_STARTED,
        threadId,
        runId,
    });
    // Build inbound context using the plugin runtime (same pattern as msteams).
    // Compose session scopes under route.sessionKey — the :user: suffix (from
    // the validated header) and the :thread: suffix both subdivide the route
    // scope and never replace it.
    let sessionKey = route.sessionKey;
    if (userKey)
        sessionKey += `:user:${userKey}`;
    if (threadId)
        sessionKey += `:thread:${threadId.toLowerCase()}`;
    const hasClientTools = (Array.isArray(input.tools) && input.tools.length > 0) ||
        hasSharedState ||
        hasStateWriters ||
        hasImages;
    // Register the SSE writer so the plugin's before/after_tool_call hooks can
    // render SERVER-side tool calls as AG-UI events. Client/frontend-tool runs
    // are driven directly via runEmbeddedAgent below and emit their own
    // TOOL_CALL_* events from the run's pendingToolCalls — registering the
    // writer for those would make the hooks emit a second, duplicate tool-call
    // sequence for the same call, so we skip it here.
    if (!hasClientTools) {
        setWriter(sessionKey, writeEvent, currentMessageId);
    }
    const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
        agentId: route.agentId,
    });
    const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
        storePath,
        sessionKey,
    });
    const envelopedBody = runtime.channel.reply.formatAgentEnvelope({
        channel: "AG-UI",
        from: "User",
        timestamp: new Date(),
        previousTimestamp,
        envelope: envelopeOptions,
        body: messageBody,
    });
    const ctxPayload = runtime.channel.reply.finalizeInboundContext({
        Body: envelopedBody,
        BodyForAgent: contextSuffix ? envelopedBody + contextSuffix : undefined,
        RawBody: messageBody,
        CommandBody: messageBody,
        From: caller.fromLabel,
        To: "clawg-ui",
        SessionKey: sessionKey,
        ChatType: "direct",
        ConversationLabel: "AG-UI",
        SenderName: "AG-UI Client",
        SenderId: caller.id,
        Provider: "clawg-ui",
        Surface: "clawg-ui",
        MessageSid: runId,
        Timestamp: Date.now(),
        WasMentioned: true,
        CommandAuthorized: true,
        OriginatingChannel: "clawg-ui",
    });
    // Record inbound session
    await runtime.channel.session.recordInboundSession({
        storePath,
        sessionKey,
        ctx: ctxPayload,
        onRecordError: () => { },
    });
    // Create reply dispatcher — translates reply payloads into AG-UI SSE events
    const abortController = new AbortController();
    req.on("close", () => {
        abortController.abort();
    });
    // Streaming + reasoning callbacks shared by both run paths: the channel
    // reply pipeline (tool-less turns) and runEmbeddedAgent (client-tool
    // turns). runEmbeddedAgent exposes the exact same callback surface, so the
    // AG-UI event mapping lives in one place.
    // No eager assistant-message-start hook. OpenClaw fires onAssistantMessageStart
    // at TURN START — before any reasoning streams — so opening the TEXT message
    // there would register it ahead of the reasoning message, and CopilotKit
    // (which lays messages out in announce order) would render the reasoning panel
    // BELOW the answer. Instead the text message opens lazily on the first actual
    // text delta (handlePartialReply / sendBlockReply / emitFallbackText), which
    // arrives AFTER reasoning closes — so reasoning renders above the answer, as in
    // the reference integrations. An answer with no text emits no empty bubble.
    // OpenClaw emits CUMULATIVE partial-reply snapshots (no delta field). We
    // forward only the newly-appended suffix as a TEXT_MESSAGE_CONTENT delta;
    // `replace` (a rare full rewrite) resets the cursor.
    const handlePartialReply = (payload) => {
        if (closed || wasClientToolCalled(sessionKey))
            return;
        const full = typeof payload.text === "string" ? payload.text : "";
        let delta;
        if (typeof payload.delta === "string" && payload.delta) {
            delta = payload.delta;
            streamedTextLen += delta.length;
        }
        else if (payload.replace) {
            delta = full;
            streamedTextLen = full.length;
        }
        else if (full.length > streamedTextLen) {
            delta = full.slice(streamedTextLen);
            streamedTextLen = full.length;
        }
        else {
            return; // nothing new
        }
        if (!delta)
            return;
        closeReasoningIfOpen();
        if (!messageStarted) {
            messageStarted = true;
            writeEvent({
                type: EventType.TEXT_MESSAGE_START,
                messageId: currentMessageId,
                runId: currentRunId,
                role: "assistant",
            });
        }
        streamedText = true;
        writeEvent({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: currentMessageId,
            runId: currentRunId,
            delta,
        });
    };
    const handleReasoningStream = (payload) => {
        if (closed)
            return;
        // OpenClaw sends cumulative reasoning snapshots (payload.text = the full
        // thinking so far). Forward only the newly-appended suffix as the delta —
        // the same treatment handlePartialReply gives assistant text — so the
        // frontend appends instead of stacking every growing snapshot.
        const full = typeof payload.text === "string" ? payload.text : "";
        let delta;
        if (typeof payload.delta === "string" && payload.delta) {
            delta = payload.delta;
            streamedReasoningLen += delta.length;
        }
        else if (full.length > streamedReasoningLen) {
            delta = full.slice(streamedReasoningLen);
            streamedReasoningLen = full.length;
        }
        else if (full && full.length < streamedReasoningLen) {
            // Snapshot shrank → a new reasoning block; reset and emit it whole.
            delta = full;
            streamedReasoningLen = full.length;
        }
        else {
            return; // nothing new
        }
        if (!delta)
            return;
        if (!reasoningStarted) {
            reasoningStarted = true;
            reasoningMessageId = `reason-${randomUUID()}`;
            writeEvent({
                type: EventType.REASONING_START,
                messageId: reasoningMessageId,
            });
            writeEvent({
                type: EventType.REASONING_MESSAGE_START,
                messageId: reasoningMessageId,
                role: "reasoning",
            });
        }
        writeEvent({
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: reasoningMessageId,
            delta,
        });
    };
    const handleReasoningEnd = () => {
        if (closed || !reasoningStarted)
            return;
        writeEvent({
            type: EventType.REASONING_MESSAGE_END,
            messageId: reasoningMessageId,
        });
        writeEvent({
            type: EventType.REASONING_END,
            messageId: reasoningMessageId,
        });
        reasoningStarted = false;
        reasoningMessageId = null;
        streamedReasoningLen = 0;
    };
    // Shared-state write: the model called a declared state-writer tool. Apply
    // its args to the run-scoped state per the tool's spec (stateKey / arg /
    // replace|append) and emit a full STATE_SNAPSHOT. No browser round-trip —
    // the state panel is the feedback, so the caller suppresses the TOOL_CALL_*
    // card for these tools.
    const emitStateWriterSnapshot = (name, rawArgs) => {
        const spec = stateWriterSpecs.get(name);
        if (!spec)
            return;
        let args = {};
        try {
            const parsed = JSON.parse(rawArgs || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                args = parsed;
            }
        }
        catch {
            // Malformed args — emit the current (unchanged) snapshot rather than throw.
        }
        applyStateWriter(runSharedState, spec, args);
        writeEvent({
            type: EventType.STATE_SNAPSHOT,
            snapshot: JSON.parse(JSON.stringify(runSharedState)),
        });
    };
    const dispatcher = {
        sendToolResult: (_payload) => {
            // Tool call events are emitted by before/after_tool_call hooks
            return !closed;
        },
        sendBlockReply: (payload) => {
            if (closed || wasClientToolCalled(sessionKey)) {
                return false;
            }
            const text = payload.text?.trim();
            if (!text) {
                return false;
            }
            // Token streaming (onPartialReply) already delivered this text
            // incrementally — don't re-emit the finalized block.
            if (streamedText) {
                return true;
            }
            if (!messageStarted) {
                messageStarted = true;
                writeEvent({
                    type: EventType.TEXT_MESSAGE_START,
                    messageId: currentMessageId,
                    runId: currentRunId,
                    role: "assistant",
                });
            }
            // Join chunks with \n\n (breakPreference: paragraph uses double-newline joiner)
            writeEvent({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: currentMessageId,
                runId: currentRunId,
                delta: text + "\n\n",
            });
            return true;
        },
        sendFinalReply: (payload) => {
            if (closed) {
                return false;
            }
            const text = wasClientToolCalled(sessionKey) ? "" : payload.text?.trim();
            if (text && !streamedText) {
                if (!messageStarted) {
                    messageStarted = true;
                    writeEvent({
                        type: EventType.TEXT_MESSAGE_START,
                        messageId: currentMessageId,
                        runId: currentRunId,
                        role: "assistant",
                    });
                }
                // Join chunks with \n\n (breakPreference: paragraph uses double-newline joiner)
                writeEvent({
                    type: EventType.TEXT_MESSAGE_CONTENT,
                    messageId: currentMessageId,
                    runId: currentRunId,
                    delta: text + "\n\n",
                });
            }
            // End the message and run
            closeReasoningIfOpen();
            if (messageStarted) {
                writeEvent({
                    type: EventType.TEXT_MESSAGE_END,
                    messageId: currentMessageId,
                    runId: currentRunId,
                });
            }
            writeEvent({
                type: EventType.RUN_FINISHED,
                threadId,
                runId: currentRunId,
            });
            closed = true;
            res.end();
            return true;
        },
        waitForIdle: () => Promise.resolve(),
        getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
        getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
        markComplete: () => { },
    };
    // Client/frontend-tool runs cannot go through the channel reply pipeline:
    // that path only exposes plugin-registered tools, gated by the static
    // `contracts.tools` manifest, so AG-UI's dynamically-named frontend tools
    // are always dropped. OpenClaw's caller-provided `clientTools` path
    // (runEmbeddedAgent) is the supported mechanism — the model sees the tools,
    // calls one, and the run stops with `pendingToolCalls` for the browser to
    // execute. We reuse the same streaming/reasoning callbacks as the reply
    // path and emit the pending calls as AG-UI TOOL_CALL_* events.
    const runWithClientTools = async () => {
        const agentId = route.agentId;
        const workspaceDir = runtime.agent.resolveAgentWorkspaceDir(cfg, agentId);
        const agentDir = runtime.agent.resolveAgentDir(cfg, agentId);
        const timeoutMs = runtime.agent.resolveAgentTimeoutMs({ cfg });
        await runtime.agent.ensureAgentWorkspace({ dir: workspaceDir });
        const clientTools = (input.tools ?? []).map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description ?? "",
                parameters: (t.parameters ?? {}),
            },
        }));
        // Inject the frontend-declared state-writer tools so the model can call
        // them; we intercept the calls (emitStateWriterSnapshot) rather than
        // round-tripping them, so the frontend needs only the declaration.
        for (const schema of stateWriterSchemas) {
            clientTools.push({
                type: "function",
                function: {
                    name: schema.function.name,
                    description: schema.function.description,
                    parameters: schema.function.parameters,
                },
            });
        }
        const promptSuffix = [contextSuffix, sharedStateSuffix]
            .filter(Boolean)
            .join("");
        const { prompt: historyPrompt, systemPrompt } = buildToolRunHistory(messages);
        // Server-side continuation transcript. After we handle a state-writer
        // call ourselves (apply + STATE_SNAPSHOT), we re-run the model with the
        // call and a synthetic result appended so it NARRATES a confirmation
        // instead of stopping silently — OpenClaw stops at a tool call rather than
        // executing our injected tool in-loop the way Hermes does. Bounded by
        // MAX_TURNS; real (browser) frontend tools end the run immediately.
        let continuation = "";
        const MAX_TURNS = 6;
        const closeRun = () => {
            closeReasoningIfOpen();
            if (messageStarted) {
                writeEvent({
                    type: EventType.TEXT_MESSAGE_END,
                    messageId: currentMessageId,
                    runId: currentRunId,
                });
            }
            writeEvent({ type: EventType.RUN_FINISHED, threadId, runId: currentRunId });
            closed = true;
            res.end();
        };
        for (let turn = 0; turn < MAX_TURNS; turn++) {
            // Fresh text/reasoning message lifecycle for this turn so a narration
            // turn streams as its own assistant message.
            messageStarted = false;
            currentMessageId = `msg-${randomUUID()}`;
            streamedText = false;
            streamedTextLen = 0;
            // Stateless per-request session: CopilotKit re-sends the full history
            // (rendered into `historyPrompt`); `continuation` carries any
            // state-writer results from earlier turns of THIS request.
            const prompt = historyPrompt + promptSuffix + continuation;
            const result = await runtime.agent.runEmbeddedAgent({
                sessionId: `clawg-ui-tools-${randomUUID()}`,
                sessionKey,
                agentId,
                workspaceDir,
                agentDir,
                config: cfg,
                prompt,
                ...(systemPrompt ? { extraSystemPrompt: systemPrompt } : {}),
                ...(hasImages
                    ? {
                        images: promptImages,
                        imageOrder: promptImages.map(() => "inline"),
                    }
                    : {}),
                clientTools,
                runId: currentRunId,
                timeoutMs,
                abortSignal: abortController.signal,
                messageChannel: "clawg-ui",
                chatType: "direct",
                trigger: "user",
                onPartialReply: handlePartialReply,
                ...(surfaceReasoning
                    ? {
                        onReasoningStream: handleReasoningStream,
                        onReasoningEnd: handleReasoningEnd,
                    }
                    : {}),
            });
            if (closed)
                return;
            const meta = result?.meta;
            const pending = meta?.pendingToolCalls ?? [];
            // If partial-reply streaming didn't fire (e.g. the model produced only a
            // tool call), surface any assistant text from the final payloads.
            const emitFallbackText = () => {
                if (streamedText)
                    return;
                const text = (result?.payloads ?? [])
                    .map((p) => (typeof p.text === "string" ? p.text : ""))
                    .filter(Boolean)
                    .join("\n\n")
                    .trim();
                if (!text)
                    return;
                if (!messageStarted) {
                    messageStarted = true;
                    writeEvent({
                        type: EventType.TEXT_MESSAGE_START,
                        messageId: currentMessageId,
                        runId: currentRunId,
                        role: "assistant",
                    });
                }
                writeEvent({
                    type: EventType.TEXT_MESSAGE_CONTENT,
                    messageId: currentMessageId,
                    runId: currentRunId,
                    delta: text,
                });
            };
            if (meta?.stopReason === "tool_calls" && pending.length > 0) {
                const writerCalls = pending.filter((c) => stateWriterSpecs.has(c.name));
                const otherCalls = pending.filter((c) => !stateWriterSpecs.has(c.name));
                // Flush any preamble text + close the message before snapshots/cards.
                emitFallbackText();
                closeReasoningIfOpen();
                if (messageStarted) {
                    writeEvent({
                        type: EventType.TEXT_MESSAGE_END,
                        messageId: currentMessageId,
                        runId: currentRunId,
                    });
                    messageStarted = false;
                }
                // State-writer calls: apply + emit STATE_SNAPSHOT, and record the call
                // + a synthetic result so the next turn's model narrates.
                for (const call of writerCalls) {
                    emitStateWriterSnapshot(call.name, call.arguments);
                    continuation +=
                        `\nAssistant called tool ${call.name}(${call.arguments ?? "{}"})` +
                            `\nTool ${call.name} returned: State updated.`;
                }
                // Real frontend tools must round-trip to the browser; emit them and
                // finish (we cannot continue the run server-side past a client tool).
                if (otherCalls.length > 0) {
                    for (const call of otherCalls) {
                        writeEvent({
                            type: EventType.TOOL_CALL_START,
                            toolCallId: call.id,
                            toolCallName: call.name,
                            parentMessageId: currentMessageId,
                        });
                        if (call.arguments) {
                            writeEvent({
                                type: EventType.TOOL_CALL_ARGS,
                                toolCallId: call.id,
                                delta: call.arguments,
                            });
                        }
                        writeEvent({ type: EventType.TOOL_CALL_END, toolCallId: call.id });
                    }
                    writeEvent({
                        type: EventType.RUN_FINISHED,
                        threadId,
                        runId: currentRunId,
                    });
                    closed = true;
                    res.end();
                    return;
                }
                // Only state-writers were called → loop so the model narrates.
                if (writerCalls.length > 0)
                    continue;
                // tool_calls but nothing matched (defensive) — finish.
                closeRun();
                return;
            }
            // No tool calls → the model produced its final text (an answer, or the
            // post-write narration). Emit any non-streamed fallback and finish.
            emitFallbackText();
            closeRun();
            return;
        }
        // Exhausted MAX_TURNS (model kept calling state-writers) — finish cleanly.
        closeRun();
    };
    // Dispatch the inbound message — this triggers the agent run
    try {
        if (hasClientTools) {
            await runWithClientTools();
        }
        else {
            await runtime.channel.reply.dispatchReplyFromConfig({
                ctx: ctxPayload,
                cfg,
                dispatcher,
                replyOptions: {
                    runId,
                    abortSignal: abortController.signal,
                    disableBlockStreaming: false,
                    ...(surfaceReasoning ? { streamReasoning: true } : {}),
                    onAgentRunStart: () => { },
                    onPartialReply: handlePartialReply,
                    ...(surfaceReasoning
                        ? {
                            onReasoningStream: handleReasoningStream,
                            onReasoningEnd: handleReasoningEnd,
                        }
                        : {}),
                    ...(surfaceSteps
                        ? {
                            onItemEvent: (item) => {
                                if (closed)
                                    return;
                                const itemId = item.itemId;
                                if (!itemId)
                                    return;
                                if (item.phase === "started" && !activeSteps.has(itemId)) {
                                    activeSteps.add(itemId);
                                    writeEvent({
                                        type: EventType.STEP_STARTED,
                                        stepName: item.title ?? itemId,
                                    });
                                }
                                else if ((item.phase === "completed" || item.phase === "failed") &&
                                    activeSteps.has(itemId)) {
                                    activeSteps.delete(itemId);
                                    writeEvent({
                                        type: EventType.STEP_FINISHED,
                                        stepName: item.title ?? itemId,
                                    });
                                }
                            },
                        }
                        : {}),
                },
            });
        }
        // If the dispatcher's final reply didn't close the stream, close it now
        if (!closed) {
            closeReasoningIfOpen();
            if (messageStarted) {
                writeEvent({
                    type: EventType.TEXT_MESSAGE_END,
                    messageId: currentMessageId,
                    runId: currentRunId,
                });
            }
            writeEvent({
                type: EventType.RUN_FINISHED,
                threadId,
                runId: currentRunId,
            });
            closed = true;
            res.end();
        }
    }
    catch (err) {
        if (!closed) {
            writeEvent({
                type: EventType.RUN_ERROR,
                message: String(err),
            });
            closed = true;
            res.end();
        }
    }
    finally {
        clearWriter(sessionKey);
        clearClientToolCalled(sessionKey);
        clearClientToolNames(sessionKey);
    }
}
