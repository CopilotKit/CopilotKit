import { defineComponent, h, onErrorCaptured, shallowRef, watch } from "vue";
import type { PropType } from "vue";
import {
  reportErrorSafely,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";

const FALLBACK_STYLE = {
  border: "1px solid #fca5a5",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "13px",
};

const RETRY_STYLE = { marginLeft: "8px", textDecoration: "underline" };

/** A thrown value as an `Error`. A thrown string becomes its message. */
function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause));
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
 * The error boundary of one generated component. A render error of the
 * component shows the `errorBoundary.fallback` component of the provider,
 * or the default fallback, and is reported with the kind "render". The
 * boundary resets on retry or on a new agent revision of the component, not
 * on a data change.
 *
 * An error of the fallback itself goes on to the boundary above, as in
 * React. The surface boundary stops it.
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
    // True while the last render showed the fallback. An error then comes
    // from the fallback, because the failed component is gone.
    let isShowingFallback = false;
    watch(
      () => props.revision,
      () => {
        error.value = null;
      },
    );
    onErrorCaptured((cause) => {
      if (isShowingFallback) return;
      const failure = toError(cause);
      error.value = failure;
      reportErrorSafely(runtime.value, {
        kind: "render",
        surfaceId: props.surfaceId,
        componentId: props.componentId,
        error: failure,
      });
      return false;
    });
    const retry = () => {
      error.value = null;
    };
    return () => {
      const current = error.value;
      isShowingFallback = current !== null;
      if (!current) return slots.default?.();
      const { surfaceId, componentId } = props;
      const fallback = runtime.value.errorFallback;
      return fallback
        ? h(fallback, { error: current, retry, surfaceId, componentId })
        : h(DefaultNodeFallback, {
            message: current.message,
            componentId,
            retry,
          });
    };
  },
});

/**
 * The outer boundary of a surface: a failure inside it never reaches the
 * chat or the host page. It reports the error with the kind "render" and
 * shows the default fallback for the whole surface.
 */
export const SurfaceBoundary = defineComponent({
  name: "GenerativeUISurfaceBoundary",
  props: {
    surfaceId: { type: String, required: true },
  },
  setup(props, { slots }) {
    const runtime = useRequiredGenerativeUIRuntime();
    const error = shallowRef<Error | null>(null);
    onErrorCaptured((cause) => {
      const failure = toError(cause);
      if (!error.value) {
        error.value = failure;
        reportErrorSafely(runtime.value, {
          kind: "render",
          surfaceId: props.surfaceId,
          error: failure,
        });
      }
      return false;
    });
    return () =>
      error.value
        ? h(DefaultNodeFallback, {
            message: "this generated UI failed to render",
            componentId: "surface",
          })
        : slots.default?.();
  },
});
