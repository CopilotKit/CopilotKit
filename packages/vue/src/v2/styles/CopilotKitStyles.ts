import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  onActivated,
  onDeactivated,
  onUnmounted,
  shallowRef,
} from "vue";
import type { AppContext, ShallowRef } from "vue";
import { stylesheet } from "@copilotkit/core/styles";
import { CopilotStyleOptionsKey } from "../providers/keys";
import type { CopilotStyleOptions } from "../providers/keys";

interface StylesInstance {
  enabled: () => boolean;
}

// The mounted instances of each app, in setup order. Keyed by app, so on the
// server each request's app has its own list.
const instancesByApp = new WeakMap<
  AppContext,
  ShallowRef<readonly StylesInstance[]>
>();

/**
 * Renders the CSS for CopilotKit's UI, so apps never import a stylesheet.
 * `CopilotChat` (and so `CopilotPopup` and `CopilotSidebar`) renders it for
 * you. Render it yourself only when you build a layout from the chat parts
 * without `CopilotChat`.
 *
 * The `<style>` tag renders in place, so it is in the server HTML and the page
 * is styled before it hydrates. Only the first instance in the app renders the
 * tag, so a page with many chats has one copy. When that instance unmounts, the
 * next one renders the tag in the same update. The server and the client set
 * up instances in the same order, so hydration matches.
 *
 * Renders nothing when `CopilotKitProvider` has `:inject-styles="false"`.
 */
export const CopilotKitStyles = defineComponent({
  name: "CopilotKitStyles",
  setup() {
    const options = inject(
      CopilotStyleOptionsKey,
      () => computed<CopilotStyleOptions>(() => ({ inject: true })),
      true,
    );
    const appContext = getCurrentInstance()!.appContext;
    let instances = instancesByApp.get(appContext);
    if (!instances) {
      instances = shallowRef([]);
      instancesByApp.set(appContext, instances);
    }
    const list = instances;
    const self: StylesInstance = { enabled: () => options.value.inject };

    const add = () => {
      if (!list.value.includes(self)) {
        list.value = [...list.value, self];
      }
    };
    const remove = () => {
      list.value = list.value.filter((instance) => instance !== self);
    };
    add();
    onUnmounted(remove);
    // A deactivated <KeepAlive> child is out of the document, so it can't
    // hold the tag.
    onDeactivated(remove);
    onActivated(add);

    const rendersTag = computed(
      () => list.value.find((instance) => instance.enabled()) === self,
    );

    return () => {
      if (!rendersTag.value) {
        return null;
      }
      const { nonce } = options.value;
      return h("style", {
        "data-copilotkit-styles": "",
        nonce,
        // Browsers hide a nonce from the DOM, so hydration would see a
        // mismatch that isn't one.
        "data-allow-mismatch": nonce ? "attribute" : undefined,
        // innerHTML, not a text child: the server would escape `>` in a text
        // child, and inside <style> that breaks the CSS.
        innerHTML: stylesheet,
      });
    };
  },
});
