// Minimal, spec-faithful shim of the WebMCP `document.modelContext` surface.
// Mirrors https://webmachinelearning.github.io/webmcp/ (CG draft, 26 Aug 2026):
//   - registerTool(tool, {signal, exposedTo}) -> Promise<undefined>
//   - getTools({fromOrigins}) -> Promise<RegisteredTool[]>
//   - executeTool(tool, inputObject, {signal}) -> Promise<DOMString>  (STRINGIFIED)
//   - ontoolchange / "toolchange" event
// Unregistration is ONLY via the registration AbortSignal - there is no
// unregisterTool() in the IDL.
const NAME_RE = /^[A-Za-z0-9_.\-]{1,128}$/;

function domException(message, name) {
  const e = new Error(message);
  e.name = name;
  return e;
}

export class ModelContextShim extends EventTarget {
  #tools = new Map();

  async registerTool(tool, options = {}) {
    const { signal } = options;
    if (signal?.aborted) throw signal.reason;
    if (!tool?.name || !NAME_RE.test(tool.name)) {
      throw domException(`Invalid tool name: ${JSON.stringify(tool?.name)}`, "InvalidStateError");
    }
    if (!tool.description) {
      throw domException("description must be a non-empty string", "InvalidStateError");
    }
    if (this.#tools.has(tool.name)) {
      // NOTE: spec REJECTS on duplicate. useFrontendTool OVERRIDES. See strategy doc.
      throw domException(`Tool already registered: ${tool.name}`, "InvalidStateError");
    }
    let stringifiedInputSchema = "";
    if (tool.inputSchema !== undefined) {
      stringifiedInputSchema = JSON.stringify(tool.inputSchema); // throws on cycles
      if (stringifiedInputSchema === undefined) throw new TypeError("inputSchema not serializable");
    }
    this.#tools.set(tool.name, { ...tool, stringifiedInputSchema });
    if (signal) {
      signal.addEventListener("abort", () => {
        this.#tools.delete(tool.name);
        this.dispatchEvent(new Event("toolchange"));
      }, { once: true });
    }
    this.dispatchEvent(new Event("toolchange"));
  }

  async getTools() {
    return [...this.#tools.values()].map((t) => ({
      name: t.name, title: t.title, description: t.description,
      inputSchema: t.inputSchema, annotations: t.annotations,
      window: globalThis, origin: "https://example.test",
    }));
  }

  // Returns the STRINGIFIED result. A rejected execute() surfaces as a plain
  // failure - the spec drops the rejection reason (completionSteps(null,false)).
  async executeTool(tool, inputObject = {}, options = {}) {
    const entry = this.#tools.get(tool.name);
    if (!entry) throw domException(`No such tool: ${tool.name}`, "NotFoundError");
    const controller = new AbortController();
    options.signal?.addEventListener("abort", () => controller.abort(options.signal.reason), { once: true });
    let value;
    try {
      value = await entry.execute(inputObject, { signal: controller.signal });
    } catch {
      throw domException("Tool execution failed", "OperationError"); // reason is DROPPED
    }
    return JSON.stringify(value);
  }
}

export function installModelContextShim(doc = globalThis.document) {
  const mc = new ModelContextShim();
  Object.defineProperty(doc, "modelContext", { value: mc, configurable: true });
  return mc;
}
