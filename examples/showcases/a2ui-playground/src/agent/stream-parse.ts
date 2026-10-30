/**
 * Incremental extraction of complete component objects from a streaming
 * `render_a2ui` argument string such as
 *   {"surfaceId":"trip","components":[{"id":"root",...},{"id":"t1",...
 *
 * The A2UI middleware only paints once the whole `components` array has
 * closed. Pulling each finished component out as it lands lets us paint the
 * surface top-down while the model is still writing the rest of it.
 */
export class ComponentStreamParser {
  private text = "";
  private arrayStart = -1;
  private cursor = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private objStart = -1;
  private closed = false;
  readonly components: Array<Record<string, unknown>> = [];
  /** Header (id + component type) of the object currently streaming, once both are readable. */
  open: { id: string; component: string; start: number } | null = null;

  push(delta: string): Array<Record<string, unknown>> {
    this.text += delta;
    const found: Array<Record<string, unknown>> = [];
    if (this.closed) return found;
    if (this.arrayStart < 0) {
      const m = /"components"\s*:\s*\[/.exec(this.text);
      if (!m) return found;
      this.arrayStart = m.index + m[0].length;
      this.cursor = this.arrayStart;
    }
    const t = this.text;
    for (let i = this.cursor; i < t.length; i++) {
      const c = t[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') {
        this.inString = true;
      } else if (c === "{") {
        if (this.depth === 0) {
          this.objStart = i;
          this.open = null;
        }
        this.depth++;
      } else if (c === "}") {
        this.depth--;
        if (this.depth === 0 && this.objStart >= 0) {
          try {
            const obj = JSON.parse(t.slice(this.objStart, i + 1));
            if (
              obj &&
              typeof obj === "object" &&
              typeof obj.id === "string" &&
              typeof obj.component === "string"
            ) {
              this.components.push(obj);
              found.push(obj);
            }
          } catch {
            /* malformed object: skip it, final validation reports it */
          }
          this.objStart = -1;
          this.open = null;
        }
      } else if (c === "]" && this.depth === 0) {
        this.closed = true;
        this.cursor = i + 1;
        return found;
      }
    }
    this.cursor = t.length;
    this.readHeader();
    return found;
  }

  /** The id and type of a component are usually its first two keys: read them before the object closes. */
  private readHeader() {
    if (this.objStart < 0 || this.open) return;
    const head = this.text.slice(this.objStart, this.objStart + 400);
    const id = /"id"\s*:\s*"([^"]+)"/.exec(head)?.[1];
    const component = /"component"\s*:\s*"([^"]+)"/.exec(head)?.[1];
    if (id && component) this.open = { id, component, start: this.objStart };
  }

  /** Characters of the currently open component object streamed so far. */
  get openChars() {
    return this.objStart >= 0 ? this.text.length - this.objStart : 0;
  }

  get done() {
    return this.closed;
  }

  get raw() {
    return this.text;
  }

  surfaceId(): string | null {
    const m = /"surfaceId"\s*:\s*"([^"]+)"/.exec(this.text);
    return m ? m[1] : null;
  }
}
