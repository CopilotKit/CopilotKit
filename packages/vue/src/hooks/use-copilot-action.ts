/**
 * V1 compatibility wrapper for `useCopilotAction`.
 *
 * The classifier intentionally follows the React v1 property-presence
 * precedence. Vue callers keep the legacy `Parameter[]` API while the
 * registration is delegated to the v2 composables.
 *
 * @example
 * ```ts
 * useCopilotAction({
 *   name: "sayHello",
 *   parameters: [{ name: "name", type: "string" }],
 *   handler: ({ name }) => `Hello, ${name}`,
 * });
 * ```
 */
import { h, watch } from "vue";
import type {
  Component,
  ComponentOptions,
  VNodeChild,
  WatchSource,
} from "vue";
import type {
  Action,
  MappedParameterTypes,
  Parameter,
} from "@copilotkit/shared";
import { CopilotKitError, CopilotKitErrorCode } from "@copilotkit/shared";
import { getZodParameters, parseJson } from "@copilotkit/shared";
import { useHumanInTheLoop as useHumanInTheLoopV2 } from "../v2/hooks/use-human-in-the-loop";
import { useRenderTool as useRenderToolV2 } from "../v2/hooks/use-render-tool";
import { useFrontendTool as useFrontendToolV1 } from "./use-frontend-tool";
import type { VueToolCallRendererRenderProps } from "../v2/types";

export type FrontendActionRenderProps<T extends Parameter[] | [] = []> =
  | {
      args: Partial<MappedParameterTypes<T>>;
      status: "inProgress";
      result: undefined;
    }
  | {
      args: MappedParameterTypes<T>;
      status: "executing";
      result: undefined;
    }
  | {
      args: MappedParameterTypes<T>;
      status: "complete";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
      result: any;
    };

export type FrontendActionWaitRenderProps<T extends Parameter[] | [] = []> =
  | (Extract<FrontendActionRenderProps<T>, { status: "inProgress" }> & {
      /** @deprecated use respond instead */
      handler: undefined;
      respond: undefined;
    })
  | (Extract<FrontendActionRenderProps<T>, { status: "executing" }> & {
      /** @deprecated use respond instead */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
      handler: (result: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
      respond: (result: any) => void;
    })
  | (Extract<FrontendActionRenderProps<T>, { status: "complete" }> & {
      /** @deprecated use respond instead */
      handler: undefined;
      respond: undefined;
    });

type FrontendActionComponentProps<T extends Parameter[] | []> = {
  args: Partial<MappedParameterTypes<T>> | MappedParameterTypes<T>;
  status: "inProgress" | "executing" | "complete";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
  result?: any;
};

type FrontendActionWaitComponentProps<T extends Parameter[] | []> =
  FrontendActionComponentProps<T> & {
    /** @deprecated use respond instead */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
    handler?: (result: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
    respond?: (result: any) => void;
  };

type VueComponent<Props> =
  | ComponentOptions<Props>
  // Vue's public component constructor type is not exported from `vue`.
  | (new (...args: never[]) => { $props: Props });

type VueRenderFunction<Props> = (props: Props) => VNodeChild;

export type FrontendActionRender<T extends Parameter[] | [] = []> =
  | string
  | VueRenderFunction<FrontendActionRenderProps<T>>
  | VueComponent<FrontendActionComponentProps<T>>;

export type FrontendActionWaitRender<T extends Parameter[] | [] = []> =
  | VueRenderFunction<FrontendActionWaitRenderProps<T>>
  | VueComponent<FrontendActionWaitComponentProps<T>>;

export type CatchAllFrontendActionRenderProps =
  | {
      name: string;
      args: Partial<Record<string, unknown>>;
      status: "inProgress";
      result: undefined;
    }
  | {
      name: string;
      args: Record<string, unknown>;
      status: "executing";
      result: undefined;
    }
  | {
      name: string;
      args: Record<string, unknown>;
      status: "complete";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes `any` here.
      result: any;
    };

type FrontendActionBase<T extends Parameter[] | []> = Omit<
  Action<T>,
  "name" | "handler"
> & {
  name: string;
  /** @deprecated Use `available` instead. */
  disabled?: boolean;
  available?: "disabled" | "enabled" | "remote" | "frontend";
  pairedAction?: string;
  followUp?: boolean;
};

export type FrontendAction<T extends Parameter[] | [] = []> =
  | (FrontendActionBase<T> & {
      render?: FrontendActionRender<T>;
      /** @deprecated use renderAndWaitForResponse instead */
      renderAndWait?: never;
      renderAndWaitForResponse?: never;
      handler?: Action<T>["handler"];
    })
  | (FrontendActionBase<T> & {
      render?: never;
      /** @deprecated use renderAndWaitForResponse instead */
      renderAndWait?: FrontendActionWaitRender<T>;
      renderAndWaitForResponse?: FrontendActionWaitRender<T>;
      handler?: never;
    });

type LegacyFrontendAction<T extends Parameter[] | []> =
  FrontendActionBase<T> & {
    render: (
      props: VueToolCallRendererRenderProps<MappedParameterTypes<T>>,
    ) => VNodeChild;
    /** @deprecated use renderAndWaitForResponse instead */
    renderAndWait?: never;
    renderAndWaitForResponse?: never;
    handler?: Action<T>["handler"];
  };

export interface CatchAllFrontendAction {
  name: "*";
  render: (props: CatchAllFrontendActionRenderProps) => VNodeChild;
}

type AnyAction = { name: string } & Record<string, unknown>;
type ActionKind = "render" | "hitl" | "frontend";
type NormalizedRender = (props: { result?: unknown }) => VNodeChild | null;

function classifyAction(action: AnyAction): ActionKind {
  if (action.name === "*") return "render";

  if ("renderAndWaitForResponse" in action || "renderAndWait" in action) {
    return "hitl";
  }

  if ("available" in action) {
    if (action.available === "enabled" || action.available === "remote") {
      return "frontend";
    }
    if (action.available === "frontend" || action.available === "disabled") {
      return "render";
    }
  }

  if ("handler" in action) return "frontend";

  throw new Error("Invalid action configuration");
}

function actionRender(action: AnyAction): unknown {
  let render = action.render;
  if (!render && "renderAndWaitForResponse" in action) {
    render = action.renderAndWaitForResponse;
  }
  if (!render && "renderAndWait" in action) {
    render = action.renderAndWait;
  }
  return render;
}

function normalizeRender(
  render: unknown,
  parseTruthyResult = false,
): NormalizedRender {
  if (typeof render === "undefined") return () => null;
  if (typeof render === "string") return () => render;
  if (typeof render !== "function") {
    return (props: { result?: unknown }) =>
      h(render as Component, normalizeRenderProps(props, parseTruthyResult));
  }

  return (props: { result?: unknown }) => {
    const next = normalizeRenderProps(props, parseTruthyResult);
    return (render as (props: unknown) => VNodeChild)(next) ?? null;
  };
}

function normalizeRenderProps(
  props: { result?: unknown },
  parseTruthyResult: boolean,
): { result?: unknown } {
  return typeof props.result === "string" &&
    (parseTruthyResult ? Boolean(props.result) : true)
    ? { ...props, result: parseJson(props.result, props.result) }
    : props;
}

function normalizeHitlRender(getRender: () => unknown): NormalizedRender {
  return ((
    props: VueToolCallRendererRenderProps<Record<string, unknown>> & {
      respond?: (result: unknown) => Promise<void>;
    },
  ) => {
    const render = getRender();
    if (typeof render === "undefined") return null;
    if (typeof render === "string") return render;

    const renderProps = (() => {
      switch (props.status) {
        case "inProgress":
          return {
            args: props.args,
            respond: undefined,
            status: props.status,
            handler: undefined,
            result: undefined,
          };
        case "executing":
          return {
            args: props.args,
            respond: props.respond,
            status: props.status,
            handler: () => {},
            result: undefined,
          };
        case "complete":
          return {
            args: props.args,
            respond: undefined,
            status: props.status,
            handler: undefined,
            result: props.result
              ? parseJson(props.result, props.result)
              : props.result,
          };
        default:
          throw new CopilotKitError({
            code: CopilotKitErrorCode.UNKNOWN,
            message: `Invalid tool call status: ${String(props.status)}`,
          });
      }
    })();

    if (typeof render === "function") {
      return (render as (props: unknown) => VNodeChild)(renderProps) ?? null;
    }

    return h(render as Component, renderProps);
  }) as NormalizedRender;
}

function watchActionConfiguration(
  action: AnyAction,
  initialKind: ActionKind,
  dependencies: WatchSource<unknown>[] | undefined,
): void {
  const classifierSources: WatchSource<unknown>[] = [
    () => action.name,
    () => "renderAndWaitForResponse" in action,
    () => "renderAndWait" in action,
    () => "available" in action,
    () => action.available,
    () => "handler" in action,
    ...(dependencies ?? []),
  ];

  watch(
    classifierSources,
    () => {
      if (classifyAction(action) !== initialKind) {
        throw new Error("Action configuration changed between renders");
      }
    },
    { flush: "sync" },
  );
}

export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action: FrontendAction<T> | CatchAllFrontendAction,
  dependencies?: WatchSource<unknown>[],
): void;
export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action: LegacyFrontendAction<T>,
  dependencies?: WatchSource<unknown>[],
): void;
export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action:
    | FrontendAction<T>
    | LegacyFrontendAction<T>
    | CatchAllFrontendAction,
  dependencies?: WatchSource<unknown>[],
): void {
  const kind = classifyAction(action as AnyAction);
  watchActionConfiguration(action as AnyAction, kind, dependencies);

  if (kind === "render" && action.name === "*") {
    useRenderToolV2(
      {
        get name() {
          return "*" as const;
        },
        get render() {
          return normalizeRender(action.render, true);
        },
      } as never,
      dependencies,
    );
    return;
  }

  const typedAction = action as FrontendAction<T>;

  if (kind === "hitl") {
    useHumanInTheLoopV2<MappedParameterTypes<T>>(
      {
        get name() {
          return typedAction.name;
        },
        get description() {
          return typedAction.description;
        },
        get parameters() {
          return getZodParameters(typedAction.parameters as T | undefined);
        },
        get followUp() {
          return typedAction.followUp;
        },
        get render() {
          return normalizeHitlRender(() =>
            actionRender(typedAction as AnyAction),
          );
        },
      } as never,
      dependencies,
    );
    return;
  }

  if (kind === "render") {
    useRenderToolV2(
      {
        get name() {
          return typedAction.name;
        },
        get description() {
          return typedAction.description;
        },
        get parameters() {
          return getZodParameters(typedAction.parameters as T | undefined);
        },
        get render() {
          return normalizeRender(typedAction.render, true);
        },
      } as never,
      dependencies,
    );
    return;
  }

  useFrontendToolV1<T>(typedAction as never, dependencies);
}
