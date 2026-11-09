import {
  defineComponent,
  h,
  onErrorCaptured,
  onMounted,
  onUpdated,
  shallowRef,
  watch,
} from "vue";
import type { PropType, VNodeChild } from "vue";
import { toError, withCause } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIErrorInfo } from "@copilotkit/shared/generative-ui";
import {
  reportErrorSafely,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";

const FALLBACK_STYLE = {
  border: "1px solid #fca5a5",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "13px",
};

const RETRY_STYLE = { marginLeft: "8px", textDecoration: "underline" };

/**
 * What one place (a boundary or a fallback guard) has reported, so that a
 * failure is reported once until the place renders without one. A failure
 * that comes back the same (a new revision that throws the same error, a
 * retry that fails again) is not reported again. A different one is.
 */
function createFailureMemory() {
  let last: string | undefined;
  return {
    report(
      runtime: GenerativeUIRuntime,
      info: GenerativeUIErrorInfo,
      /** What the failure happened for, such as the message a fallback showed. */
      context = "",
    ) {
      const signature = [
        info.kind,
        info.error.name,
        info.error.message,
        context,
      ].join("\n");
      if (last === signature) return;
      last = signature;
      reportErrorSafely(runtime, info);
    },
    /** The place rendered without a failure. */
    clear() {
      last = undefined;
    },
  };
}

/**
 * Clears `memory` after each render of the calling component that ended
 * without a failure. A child that throws while the component patches sets
 * `failed` before these hooks run, so a failure is never cleared.
 */
function clearAfterCleanRenders(
  memory: ReturnType<typeof createFailureMemory>,
  failed: () => boolean,
) {
  const clear = () => {
    if (!failed()) memory.clear();
  };
  onMounted(clear);
  onUpdated(clear);
}

/**
 * The error that a fallback threw, told apart from the error of the
 * component it stood in for. The fallback's own error is the `cause`.
 */
function fallbackError(error: Error, componentId: string) {
  return withCause(
    new Error(`The error fallback of ${componentId} threw: ${error.message}`),
    error,
  );
}

function sameKeys(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/**
 * The default fallback of a part of generated UI that cannot render. With
 * `retry`, it shows a Retry button that renders the part again.
 */
export const DefaultNodeFallback = defineComponent({
  name: "GenerativeUIDefaultNodeFallback",
  props: {
    message: { type: String, required: true },
    componentId: { type: String, required: true },
    retry: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    return () =>
      h(
        "div",
        {
          role: "alert",
          "data-generative-ui-error": props.componentId,
          style: FALLBACK_STYLE,
        },
        [
          `Couldn’t display this part: ${props.message}`,
          props.retry
            ? h(
                "button",
                { type: "button", onClick: props.retry, style: RETRY_STYLE },
                "Retry",
              )
            : null,
        ],
      );
  },
});

/**
 * Wraps the app's `errorBoundary.fallback`. The fallback may throw too; then
 * this renders `replacement` and reports the fallback's error, so that the
 * failure stays inside the node instead of reaching the surface boundary.
 * It renders no element, so a working fallback looks the same.
 *
 * A failed fallback gets another chance when one of `resetKeys` changes. A
 * fallback that throws the same error again for the same `context` is not
 * reported again.
 */
const FallbackGuard = defineComponent({
  name: "GenerativeUIFallbackGuard",
  props: {
    surfaceId: { type: String, required: true },
    componentId: { type: String, required: true },
    /** What the fallback stands in for, so a new one is a new failure. */
    context: { type: String, required: true },
    resetKeys: {
      type: Array as PropType<readonly unknown[]>,
      required: true,
    },
    /** Rendered instead when the fallback throws. Must not throw itself. */
    replacement: {
      type: Function as PropType<() => VNodeChild>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const runtime = useRequiredGenerativeUIRuntime();
    const failed = shallowRef(false);
    const memory = createFailureMemory();
    watch(
      () => props.resetKeys,
      (next, previous) => {
        if (!sameKeys(next, previous)) failed.value = false;
      },
    );
    onErrorCaptured((thrown) => {
      failed.value = true;
      memory.report(
        runtime.value,
        {
          kind: "render",
          surfaceId: props.surfaceId,
          componentId: props.componentId,
          error: fallbackError(toError(thrown), props.componentId),
        },
        props.context,
      );
      return false;
    });
    clearAfterCleanRenders(memory, () => failed.value);
    return () => (failed.value ? props.replacement() : slots.default?.());
  },
});

/**
 * The error boundary of one generated component. A render error of the
 * component shows the `errorBoundary.fallback` component of the provider,
 * or the default fallback, and is reported with the kind "render". The
 * boundary resets on retry or on a new agent revision of the component, not
 * on a data change. A failure that stays the same across revisions and
 * retries is reported once.
 *
 * When the app's fallback throws, the default fallback stands in for it,
 * with Retry, and the fallback's error is reported. The failure stays in
 * this node.
 */
export const NodeBoundary = defineComponent({
  name: "GenerativeUINodeBoundary",
  props: {
    surfaceId: { type: String, required: true },
    componentId: { type: String, required: true },
    /** The wire props of the node. A new object is a new agent revision. */
    revision: {
      type: Object as PropType<Record<string, unknown>>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const runtime = useRequiredGenerativeUIRuntime();
    const error = shallowRef<Error | null>(null);
    const memory = createFailureMemory();
    watch(
      () => props.revision,
      () => {
        error.value = null;
      },
    );
    onErrorCaptured((thrown) => {
      const failure = toError(thrown);
      error.value = failure;
      memory.report(runtime.value, {
        kind: "render",
        surfaceId: props.surfaceId,
        componentId: props.componentId,
        error: failure,
      });
      return false;
    });
    clearAfterCleanRenders(memory, () => error.value !== null);
    const retry = () => {
      error.value = null;
    };
    return () => {
      const current = error.value;
      if (!current) return slots.default?.();
      const { surfaceId, componentId } = props;
      const defaultFallback = () =>
        h(DefaultNodeFallback, {
          message: current.message,
          componentId,
          retry,
        });
      const fallback = runtime.value.errorFallback;
      if (!fallback) return defaultFallback();
      return h(
        FallbackGuard,
        {
          surfaceId,
          componentId,
          context: current.message,
          resetKeys: [current],
          replacement: defaultFallback,
        },
        {
          default: () =>
            h(fallback, { error: current, retry, surfaceId, componentId }),
        },
      );
    };
  },
});

/**
 * The boundary of a surface: a failure inside it never reaches the chat or
 * the host page. It reports the error with the kind "render" and shows the
 * default fallback for the whole surface. It resets when `revision`
 * changes, that is when new content of the surface arrives. A failure that
 * stays the same across revisions is reported once.
 *
 * It offers no Retry: it catches only failures of the surface's own
 * rendering of its root node, which come back the same until the content
 * changes.
 */
export const SurfaceBoundary = defineComponent({
  name: "GenerativeUISurfaceBoundary",
  props: {
    surfaceId: { type: String, required: true },
    /**
     * Changes with each new content of the surface (new operations applied),
     * and not when the same content is delivered again. Resets a failure.
     */
    revision: { type: Number, required: true },
  },
  setup(props, { slots }) {
    const runtime = useRequiredGenerativeUIRuntime();
    const error = shallowRef<Error | null>(null);
    const memory = createFailureMemory();
    watch(
      () => props.revision,
      () => {
        error.value = null;
      },
    );
    onErrorCaptured((thrown) => {
      const failure = toError(thrown);
      error.value = failure;
      memory.report(runtime.value, {
        kind: "render",
        surfaceId: props.surfaceId,
        error: failure,
      });
      return false;
    });
    clearAfterCleanRenders(memory, () => error.value !== null);
    return () =>
      error.value
        ? h(DefaultNodeFallback, {
            message: "this generated UI failed to render",
            componentId: "surface",
          })
        : slots.default?.();
  },
});
