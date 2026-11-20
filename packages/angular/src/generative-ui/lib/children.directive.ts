import {
  DestroyRef,
  Directive,
  Injector,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { joinPath, resolvePath } from "@copilotkit/core/generative-ui";
import { isTemplateChildren } from "./children";
import type { GenerativeUIChildren } from "./children";
import { GenerativeUINodeRenderer } from "./node";
import { GENERATIVE_UI_RUNTIME } from "./runtime";

/** One child to render: its key in the container, and where it renders. */
interface ChildEntry {
  key: string;
  componentId: string;
  basePath: string | undefined;
}

interface RenderedChild {
  key: string;
  renderer: GenerativeUINodeRenderer;
}

/**
 * Experimental. Renders the children of a slot, or of a `child()` or
 * `childList()` prop, where it stands:
 *
 * ```html
 * <ng-container *copilotGenerativeUIChildren="children()" />
 * ```
 *
 * One id renders that component. A list renders each id once, keyed, so an
 * update does not remount the components that stay. A template renders its
 * component once per item of the list at its path, with the item as the
 * base of relative bindings. It renders nothing for a handle that is unset.
 */
@Directive({ selector: "[copilotGenerativeUIChildren]" })
export class CopilotGenerativeUIChildren {
  readonly copilotGenerativeUIChildren = input<
    GenerativeUIChildren | null | undefined
  >();

  readonly #host = inject(ViewContainerRef);
  readonly #runtime = inject(GENERATIVE_UI_RUNTIME);
  readonly #injector = inject(Injector);
  /** Changes when the list of a template changes. */
  readonly #listVersion = signal(0);
  #children: RenderedChild[] = [];

  readonly #entries = computed<ChildEntry[]>(() => {
    const handle = this.copilotGenerativeUIChildren();
    if (!handle) return [];
    const { value, basePath } = handle;
    if (typeof value === "string") {
      return [{ key: value, componentId: value, basePath }];
    }
    if (isTemplateChildren(value)) {
      this.#listVersion();
      const listPath = resolvePath(value.path, basePath);
      const list = handle.surface.model.dataModel.get(listPath);
      const count = Array.isArray(list) ? list.length : 0;
      return Array.from({ length: count }, (_, index) => ({
        key: `#${index}`,
        componentId: value.componentId,
        basePath: joinPath(listPath, String(index)),
      }));
    }
    return value.map((id) => ({ key: id, componentId: id, basePath }));
  });

  constructor() {
    effect((onCleanup) => {
      const handle = this.copilotGenerativeUIChildren();
      if (!handle || !isTemplateChildren(handle.value)) return;
      const listPath = resolvePath(handle.value.path, handle.basePath);
      const subscription = handle.surface.model.dataModel.subscribe(
        listPath,
        () => this.#listVersion.update((n) => n + 1),
      );
      onCleanup(() => subscription.unsubscribe());
    });
    effect(() => {
      const handle = this.copilotGenerativeUIChildren();
      const entries = this.#entries();
      untracked(() => this.#reconcile(handle, entries));
    });
    inject(DestroyRef).onDestroy(() => {
      for (const child of this.#children) child.renderer.destroy();
      this.#children = [];
    });
  }

  /** Keeps one renderer per key; a key whose place changes is recreated. */
  #reconcile(
    handle: GenerativeUIChildren | null | undefined,
    entries: ChildEntry[],
  ) {
    const byKey = new Map(this.#children.map((child) => [child.key, child]));
    const next: RenderedChild[] = [];
    for (const entry of entries) {
      let child = byKey.get(entry.key);
      if (child) {
        byKey.delete(entry.key);
        const { node } = child.renderer;
        const isSame =
          node.componentId === entry.componentId &&
          node.basePath === entry.basePath &&
          node.surface === handle?.surface;
        if (!isSame) {
          child.renderer.destroy();
          child = undefined;
        }
      }
      if (!child && handle) {
        const { key } = entry;
        child = {
          key,
          renderer: new GenerativeUINodeRenderer(
            this.#host,
            this.#runtime,
            this.#injector,
            {
              surface: handle.surface,
              componentId: entry.componentId,
              basePath: entry.basePath,
              ancestors: handle.ancestors,
            },
            () => this.#indexBefore(key),
          ),
        };
      }
      if (child) next.push(child);
    }
    for (const stale of byKey.values()) stale.renderer.destroy();
    this.#children = next;
    this.#syncOrder();
  }

  /** The container index for a new view of the child with `key`. */
  #indexBefore(key: string) {
    let index = 0;
    for (const child of this.#children) {
      if (child.key === key) break;
      if (child.renderer.view) index++;
    }
    return index;
  }

  /** Puts the views of the children in the order of the children. */
  #syncOrder() {
    let index = 0;
    for (const child of this.#children) {
      const view = child.renderer.view;
      if (!view) continue;
      if (this.#host.indexOf(view) !== index) this.#host.move(view, index);
      index++;
    }
  }
}
