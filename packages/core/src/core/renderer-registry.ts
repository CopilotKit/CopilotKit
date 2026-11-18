/**
 * The renderer lists a framework provider keeps: tool-call renderers,
 * activity message renderers, and custom message renderers.
 *
 * Core never calls a renderer, so the entry types are generic. React, Vue,
 * and Angular each store their own renderer shape here and project the lists
 * into their own reactivity.
 */

/** Which renderer list changed. */
export type ɵRendererKind = "toolCalls" | "activity" | "custom";

/** The initial lists for {@link ɵRendererRegistry}. */
export interface ɵRendererRegistryInit<TTool, TActivity, TCustom> {
  toolCalls?: readonly TTool[];
  activity?: readonly TActivity[];
  custom?: readonly TCustom[];
}

function toolCallKey(entry: { name: string; agentId?: string }) {
  return `${entry.agentId ?? ""}:${entry.name}`;
}

/**
 * Holds the renderers of one provider and tells subscribers when a list
 * changes.
 *
 * Tool-call renderers come from three places. Prop renderers are the list the
 * provider was given (`setPropToolCalls`). Hook renderers are added one at a
 * time (`addHookToolCall`), for example by `useRenderTool`. Built-in
 * renderers are added by CopilotKit features such as generative UI
 * (`addBuiltInToolCall`). Each renderer has a key made of its `agentId` and
 * `name`. A hook renderer replaces a prop renderer with the same key, and a
 * later hook renderer replaces an earlier one with the same key, so the
 * latest registration wins. A built-in renderer shows only when no prop or
 * hook renderer has its key, so an app can always replace it.
 *
 * Fields are TypeScript `private`, not `#private`, so the registry keeps
 * working behind a Vue reactive proxy.
 *
 * Every list is copied when it is set, so a caller that later changes its own
 * array does not change the registry. Each getter returns the same array
 * until that list changes, so callers can compare snapshots by identity
 * (`useSyncExternalStore`, a Vue `shallowRef`, an Angular `signal`).
 *
 * @example
 * ```ts
 * const registry = new ɵRendererRegistry<ToolRenderer, ActivityRenderer, CustomRenderer>({
 *   toolCalls: config.renderToolCalls,
 * });
 * const stop = registry.subscribe((kind) => {
 *   if (kind === "toolCalls") redraw(registry.toolCalls);
 * });
 * registry.addHookToolCall({ name: "search", render: SearchCard });
 * ```
 */
export class ɵRendererRegistry<
  TTool extends { name: string; agentId?: string },
  TActivity,
  TCustom,
> {
  private _propToolCalls: readonly TTool[];
  private _hookToolCalls = new Map<string, TTool>();
  private _builtInToolCalls = new Map<string, TTool>();
  private _mergedToolCalls: readonly TTool[] | null = null;
  private _activity: readonly TActivity[];
  private _custom: readonly TCustom[];
  private _listeners = new Set<(kind: ɵRendererKind) => void>();

  constructor(init: ɵRendererRegistryInit<TTool, TActivity, TCustom> = {}) {
    this._propToolCalls = [...(init.toolCalls ?? [])];
    this._activity = [...(init.activity ?? [])];
    this._custom = [...(init.custom ?? [])];
  }

  /** The prop renderers, as last set. */
  get propToolCalls() {
    return this._propToolCalls;
  }

  /**
   * Every tool-call renderer: prop renderers, then hook renderers, then
   * built-in renderers, with one entry per `agentId` + `name` key. A prop
   * renderer that a hook renderer replaces keeps its position in the list. A
   * built-in renderer is left out when a prop or hook renderer has its key.
   */
  get toolCalls() {
    if (this._hookToolCalls.size === 0 && this._builtInToolCalls.size === 0) {
      return this._propToolCalls;
    }
    if (this._mergedToolCalls) return this._mergedToolCalls;

    const merged = new Map<string, TTool>();
    for (const entry of this._propToolCalls) {
      merged.set(toolCallKey(entry), entry);
    }
    for (const [key, entry] of this._hookToolCalls) {
      merged.set(key, entry);
    }
    for (const [key, entry] of this._builtInToolCalls) {
      if (!merged.has(key)) merged.set(key, entry);
    }
    this._mergedToolCalls = [...merged.values()];
    return this._mergedToolCalls;
  }

  get activity() {
    return this._activity;
  }

  get custom() {
    return this._custom;
  }

  /**
   * Replace the prop renderers.
   *
   * @param renderers - The provider's renderers. The registry keeps a copy.
   */
  setPropToolCalls(renderers: readonly TTool[]) {
    this._propToolCalls = [...renderers];
    this._mergedToolCalls = null;
    this.emit("toolCalls");
  }

  /**
   * Add a hook renderer. It replaces any hook or prop renderer with the same
   * `agentId` and `name`.
   *
   * @param entry - The renderer to add.
   * @returns A function that removes this renderer, if it is still the one
   *   registered for its key. Calling it more than once does nothing.
   */
  addHookToolCall(entry: TTool) {
    const key = toolCallKey(entry);
    this._hookToolCalls.set(key, entry);
    this._mergedToolCalls = null;
    this.emit("toolCalls");

    return () => {
      if (this._hookToolCalls.get(key) !== entry) return;
      this.removeHookToolCall(entry.name, entry.agentId);
    };
  }

  /**
   * Remove the hook renderer for `name` and `agentId`. A prop renderer with
   * the same key shows again. Does nothing when no hook renderer has that key.
   *
   * @param name - The tool name.
   * @param agentId - The agent the renderer belongs to. Omit it for a
   *   renderer with no `agentId`.
   */
  removeHookToolCall(name: string, agentId?: string) {
    if (!this._hookToolCalls.delete(toolCallKey({ name, agentId }))) return;
    this._mergedToolCalls = null;
    this.emit("toolCalls");
  }

  /**
   * Remove the prop and hook renderers for `name` and `agentId`. Built-in
   * renderers stay. Does nothing when no such renderer exists.
   *
   * @param name - The tool name.
   * @param agentId - The agent the renderers belong to. Omit it for
   *   renderers with no `agentId`.
   */
  removeToolCall(name: string, agentId?: string) {
    const key = toolCallKey({ name, agentId });
    const props = this._propToolCalls.filter(
      (entry) => toolCallKey(entry) !== key,
    );
    const removedHook = this._hookToolCalls.delete(key);
    if (!removedHook && props.length === this._propToolCalls.length) return;
    this._propToolCalls = props;
    this._mergedToolCalls = null;
    this.emit("toolCalls");
  }

  /**
   * Add a built-in renderer, for a tool that a CopilotKit feature owns (for
   * example the generative UI render tool). Prop and hook renderers with the same
   * `agentId` and `name` win over it, and setting the prop renderers never
   * removes it.
   *
   * @param entry - The renderer to add. It replaces an earlier built-in
   *   renderer with the same key.
   * @returns A function that removes this renderer, if it is still the
   *   built-in renderer for its key. Calling it more than once does nothing.
   *
   * @example
   * ```ts
   * const remove = registry.addBuiltInToolCall({ name: "render_ui", render: Nothing });
   * // when the feature turns off
   * remove();
   * ```
   */
  addBuiltInToolCall(entry: TTool) {
    const key = toolCallKey(entry);
    this._builtInToolCalls.set(key, entry);
    this._mergedToolCalls = null;
    this.emit("toolCalls");

    return () => {
      if (this._builtInToolCalls.get(key) !== entry) return;
      this._builtInToolCalls.delete(key);
      this._mergedToolCalls = null;
      this.emit("toolCalls");
    };
  }

  /**
   * Replace the activity message renderers.
   *
   * @param renderers - The renderers. The registry keeps a copy.
   */
  setActivity(renderers: readonly TActivity[]) {
    this._activity = [...renderers];
    this.emit("activity");
  }

  /**
   * Replace the custom message renderers.
   *
   * @param renderers - The renderers. The registry keeps a copy.
   */
  setCustom(renderers: readonly TCustom[]) {
    this._custom = [...renderers];
    this.emit("custom");
  }

  /**
   * Call `listener` after a list is set or a hook renderer is added or
   * removed.
   *
   * @param listener - Receives which list changed.
   * @returns A function that stops the calls.
   */
  subscribe(listener: (kind: ɵRendererKind) => void) {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private emit(kind: ɵRendererKind) {
    const listeners = [...this._listeners];
    for (const listener of listeners) listener(kind);
  }
}
