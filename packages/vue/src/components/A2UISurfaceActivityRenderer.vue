<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import type { A2UITheme } from "../types";
import type { A2UIOperation } from "./a2ui";
import { getOperationSurfaceId } from "./a2ui";
import { useCopilotKit } from "../providers";

const props = defineProps<{
  activityType: string;
  content: { operations: A2UIOperation[] };
  message: ActivityMessage;
  agent?: object;
  theme?: A2UITheme;
  catalog?: any;
}>();

type ReactModule = any;
type A2UIModule = any;

let a2uiInitialized = false;

const hostRef = ref<HTMLElement | null>(null);
const reactRootRef = ref<any>(null);
const reactRuntimeRef = ref<{
  React: ReactModule;
  A2UI: A2UIModule;
} | null>(null);

const { copilotkit } = useCopilotKit();

async function ensureReactRuntime() {
  if (reactRuntimeRef.value) return reactRuntimeRef.value;
  const [React, ReactDOMClient, A2UI] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("@copilotkit/a2ui-renderer"),
  ]);
  if (!a2uiInitialized) {
    A2UI.initializeDefaultCatalog();
    A2UI.injectStyles();
    a2uiInitialized = true;
  }
  if (!reactRootRef.value && hostRef.value) {
    reactRootRef.value = ReactDOMClient.createRoot(hostRef.value);
  }
  reactRuntimeRef.value = { React, A2UI };
  return reactRuntimeRef.value;
}

function createReactTree(
  React: ReactModule,
  A2UI: A2UIModule,
  operations: A2UIOperation[],
) {
  const {
    A2UIProvider,
    A2UIRenderer,
    useA2UIActions,
    useA2UIError,
    DEFAULT_SURFACE_ID,
  } = A2UI;

  const SurfaceOrError = ({ surfaceId }: { surfaceId: string }) => {
    const error = useA2UIError();
    if (error) {
      return React.createElement(
        "div",
        {
          className:
            "cpk:rounded-lg cpk:border cpk:border-red-200 cpk:bg-red-50 cpk:p-3 cpk:text-sm cpk:text-red-700",
        },
        `A2UI render error: ${error}`,
      );
    }
    return React.createElement(A2UIRenderer, {
      surfaceId,
      className: "cpk:flex cpk:flex-1",
    });
  };

  const SurfaceMessageProcessor = ({
    surfaceId,
    ops,
  }: {
    surfaceId: string;
    ops: A2UIOperation[];
  }) => {
    const { processMessages, getSurface } = useA2UIActions();
    const lastHashRef = React.useRef("");
    React.useEffect(() => {
      const hash = JSON.stringify(ops);
      if (hash === lastHashRef.current) return;
      lastHashRef.current = hash;

      const existing = getSurface(surfaceId);
      const filtered = existing
        ? ops.filter((op) => !(op as any)?.createSurface)
        : ops;
      processMessages(filtered as any);
    }, [processMessages, getSurface, surfaceId, ops]);
    return null;
  };

  const SurfaceHost = ({
    surfaceId,
    ops,
  }: {
    surfaceId: string;
    ops: A2UIOperation[];
  }) => {
    const handleAction = async (message: unknown) => {
      if (!props.agent) return;
      try {
        copilotkit.value.setProperties({
          ...(copilotkit.value.properties ?? {}),
          a2uiAction: message,
        });
        await copilotkit.value.runAgent({ agent: props.agent as any });
      } finally {
        const { a2uiAction, ...rest } = copilotkit.value.properties ?? {};
        copilotkit.value.setProperties(rest);
      }
    };

    return React.createElement(
      "div",
      {
        className: "cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4",
        "data-surface-id": surfaceId,
      },
      React.createElement(
        A2UIProvider,
        {
          onAction: handleAction,
          theme: (props.theme ?? {}) as any,
          catalog: props.catalog,
        },
        React.createElement(SurfaceMessageProcessor, { surfaceId, ops }),
        React.createElement(SurfaceOrError, { surfaceId }),
      ),
    );
  };

  const grouped = new Map<string, A2UIOperation[]>();
  for (const op of operations) {
    const surfaceId = getOperationSurfaceId(op) ?? DEFAULT_SURFACE_ID;
    if (!grouped.has(surfaceId)) grouped.set(surfaceId, []);
    grouped.get(surfaceId)!.push(op);
  }

  return React.createElement(
    "div",
    {
      className:
        "cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-6 cpk:overflow-auto cpk:py-6",
      "data-testid": "a2ui-activity-renderer",
    },
    Array.from(grouped.entries()).map(([surfaceId, ops]) =>
      React.createElement(SurfaceHost, { key: surfaceId, surfaceId, ops }),
    ),
  );
}

async function renderReactSurface() {
  if (!hostRef.value || !props.content.operations?.length) return;
  const runtime = await ensureReactRuntime();
  if (!runtime || !reactRootRef.value) return;
  reactRootRef.value.render(
    createReactTree(runtime.React, runtime.A2UI, props.content.operations),
  );
}

watch(
  () => [props.content.operations, props.theme, props.catalog, props.agent],
  () => {
    void renderReactSurface();
  },
  { deep: true },
);

onMounted(() => {
  void renderReactSurface();
});

onBeforeUnmount(() => {
  if (reactRootRef.value) {
    reactRootRef.value.unmount();
    reactRootRef.value = null;
  }
});

const hasOperations = computed(
  () => (props.content.operations ?? []).length > 0,
);
</script>

<template>
  <div
    v-if="hasOperations"
    ref="hostRef"
    data-copilotkit
    :data-activity-type="activityType"
    :data-message-id="message.id"
  />
</template>
