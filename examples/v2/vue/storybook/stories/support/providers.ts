import { provide, ref } from "vue";
import type { Decorator } from "@storybook/vue3-vite";
import { LicenseContextKey, useDefaultRenderTool } from "@copilotkit/vue";
import type { LicenseContextValue } from "@copilotkit/vue";

/** Registers CopilotKit's built-in wildcard tool card (`useDefaultRenderTool`). */
export const withDefaultToolRenderer: Decorator = (story) => ({
  components: { story },
  setup() {
    useDefaultRenderTool();
  },
  template: `<story />`,
});

/**
 * Pins the license status the runtime would normally report via `/info`, so
 * license-gated UI (e.g. the threads drawer) can be reviewed offline.
 */
export const withLicense =
  (status: LicenseContextValue["status"]): Decorator =>
  (story) => ({
    components: { story },
    setup() {
      provide(
        LicenseContextKey,
        ref<LicenseContextValue>({
          status,
          license: null,
          checkFeature: () => status === "valid" || status === "expiring",
          getLimit: () => null,
        }),
      );
    },
    template: `<story />`,
  });
