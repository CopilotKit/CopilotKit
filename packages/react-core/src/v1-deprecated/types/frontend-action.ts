/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — ActionRenderProps:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — ActionRenderPropsNoArgs:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — ActionRenderPropsNoArgsWait:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — ActionRenderPropsWait:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CatchAllActionRenderProps:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CatchAllFrontendAction:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool-based generative UI): https://docs.copilotkit.ai/generative-ui/tool-based
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — FrontendAction:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool-based generative UI): https://docs.copilotkit.ai/generative-ui/tool-based
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — FrontendActionAvailability:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool-based generative UI): https://docs.copilotkit.ai/generative-ui/tool-based
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — RenderFunctionStatus:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { ActionInputAvailability } from "@copilotkit/runtime-client-gql";
import type {
  Action,
  Parameter,
  MappedParameterTypes,
} from "@copilotkit/shared";
import { actionParametersToJsonSchema } from "@copilotkit/shared";
import React from "react";

interface InProgressState<T extends Parameter[] | [] = []> {
  status: "inProgress";
  args: Partial<MappedParameterTypes<T>>;
  result: undefined;
}

interface ExecutingState<T extends Parameter[] | [] = []> {
  status: "executing";
  args: MappedParameterTypes<T>;
  result: undefined;
}

interface CompleteState<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
  result: any;
}

interface InProgressStateNoArgs<T extends Parameter[] | [] = []> {
  status: "inProgress";
  args: Partial<MappedParameterTypes<T>>;
  result: undefined;
}

interface ExecutingStateNoArgs<T extends Parameter[] | [] = []> {
  status: "executing";
  args: MappedParameterTypes<T>;
  result: undefined;
}

interface CompleteStateNoArgs<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
  result: any;
}

interface InProgressStateWait<T extends Parameter[] | [] = []> {
  status: "inProgress";
  args: Partial<MappedParameterTypes<T>>;
  /** @deprecated use respond instead */
  handler: undefined;
  respond: undefined;
  result: undefined;
}

interface ExecutingStateWait<T extends Parameter[] | [] = []> {
  status: "executing";
  args: MappedParameterTypes<T>;
  /** @deprecated use respond instead */
  handler: (result: any) => void;
  respond: (result: any) => void;
  result: undefined;
}

interface CompleteStateWait<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
  /** @deprecated use respond instead */
  handler: undefined;
  respond: undefined;
  result: any;
}

interface InProgressStateNoArgsWait<T extends Parameter[] | [] = []> {
  status: "inProgress";
  args: Partial<MappedParameterTypes<T>>;
  /** @deprecated use respond instead */
  handler: undefined;
  respond: undefined;
  result: undefined;
}

interface ExecutingStateNoArgsWait<T extends Parameter[] | [] = []> {
  status: "executing";
  args: MappedParameterTypes<T>;
  /** @deprecated use respond instead */
  handler: (result: any) => void;
  respond: (result: any) => void;
  result: undefined;
}

interface CompleteStateNoArgsWait<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
  /** @deprecated use respond instead */
  handler: undefined;
  respond: undefined;
}

export type ActionRenderProps<T extends Parameter[] | [] = []> =
  | CompleteState<T>
  | ExecutingState<T>
  | InProgressState<T>;

export type ActionRenderPropsNoArgs<T extends Parameter[] | [] = []> =
  | CompleteStateNoArgs<T>
  | ExecutingStateNoArgs<T>
  | InProgressStateNoArgs<T>;

export type ActionRenderPropsWait<T extends Parameter[] | [] = []> =
  | CompleteStateWait<T>
  | ExecutingStateWait<T>
  | InProgressStateWait<T>;

export type ActionRenderPropsNoArgsWait<T extends Parameter[] | [] = []> =
  | CompleteStateNoArgsWait<T>
  | ExecutingStateNoArgsWait<T>
  | InProgressStateNoArgsWait<T>;

export type CatchAllActionRenderProps<T extends Parameter[] | [] = []> =
  | (CompleteState<T> & {
      name: string;
    })
  | (ExecutingState<T> & {
      name: string;
    })
  | (InProgressState<T> & {
      name: string;
    });

/**
 * Render props for a catch-all action that waits for a response. Same as
 * {@link ActionRenderPropsWait} — including `respond` while executing — plus
 * the `name` of the tool call being handled, since one catch-all render serves
 * every tool.
 */
export type CatchAllActionRenderPropsWait<T extends Parameter[] | [] = []> =
  | (CompleteStateWait<T> & {
      name: string;
    })
  | (ExecutingStateWait<T> & {
      name: string;
    })
  | (InProgressStateWait<T> & {
      name: string;
    });

export type FrontendActionAvailability =
  | "disabled"
  | "enabled"
  | "remote"
  | "frontend";

export type FrontendAction<
  T extends Parameter[] | [] = [],
  N extends string = string,
> = Action<T> & {
  name: Exclude<N, "*">;
  /**
   * @deprecated Use `available` instead.
   */
  disabled?: boolean;
  available?: FrontendActionAvailability;
  pairedAction?: string;
  followUp?: boolean;
} & (
    | {
        render?:
          | string
          | (T extends []
              ? (
                  props: ActionRenderPropsNoArgs<T>,
                ) => string | React.ReactElement
              : (props: ActionRenderProps<T>) => string | React.ReactElement);
        /** @deprecated use renderAndWaitForResponse instead */
        renderAndWait?: never;
        renderAndWaitForResponse?: never;
      }
    | {
        render?: never;
        /** @deprecated use renderAndWaitForResponse instead */
        renderAndWait?: T extends []
          ? (props: ActionRenderPropsNoArgsWait<T>) => React.ReactElement
          : (props: ActionRenderPropsWait<T>) => React.ReactElement;
        renderAndWaitForResponse?: T extends []
          ? (props: ActionRenderPropsNoArgsWait<T>) => React.ReactElement
          : (props: ActionRenderPropsWait<T>) => React.ReactElement;
        handler?: never;
      }
  );

export type CatchAllFrontendAction = {
  name: "*";
} & (
  | {
      render: (props: CatchAllActionRenderProps<any>) => React.ReactElement;
      /** @deprecated use renderAndWaitForResponse instead */
      renderAndWait?: never;
      renderAndWaitForResponse?: never;
    }
  | {
      render?: never;
      /** @deprecated use renderAndWaitForResponse instead */
      renderAndWait?: (
        props: CatchAllActionRenderPropsWait<any>,
      ) => React.ReactElement;
      /**
       * Handle every tool call that has no dedicated action with one
       * human-in-the-loop render: the call stays pending until `respond` is
       * called. Use `name` to tell the calls apart.
       */
      renderAndWaitForResponse?: (
        props: CatchAllActionRenderPropsWait<any>,
      ) => React.ReactElement;
    }
);

export type RenderFunctionStatus = ActionRenderProps<any>["status"];

export function processActionsForRuntimeRequest(
  actions: FrontendAction<any>[],
) {
  const filteredActions = actions
    .filter(
      (action) =>
        action.available !== ActionInputAvailability.Disabled &&
        action.disabled !== true &&
        action.name !== "*" &&
        action.available != "frontend" &&
        !action.pairedAction,
    )
    .map((action) => {
      let available: ActionInputAvailability | undefined =
        ActionInputAvailability.Enabled;
      if (action.disabled) {
        available = ActionInputAvailability.Disabled;
      } else if (action.available === "disabled") {
        available = ActionInputAvailability.Disabled;
      } else if (action.available === "remote") {
        available = ActionInputAvailability.Remote;
      }
      return {
        name: action.name,
        description: action.description || "",
        jsonSchema: JSON.stringify(
          actionParametersToJsonSchema(action.parameters || []),
        ),
        available,
      };
    });
  return filteredActions;
}
