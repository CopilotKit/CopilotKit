import { ActionInputAvailability } from "@copilotkit/runtime-client-gql";
import {
  Action,
  Parameter,
  MappedParameterTypes,
  actionParametersToJsonSchema,
  DEFINED_IN_MIDDLEWARE_EXPERIMENTAL,
} from "@copilotkit/shared";
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

export type FrontendActionAvailability = "disabled" | "enabled" | "remote" | "frontend";

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
              ? (props: ActionRenderPropsNoArgs<T>) => string | React.ReactElement
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
  render: (props: CatchAllActionRenderProps<any>) => React.ReactElement;
};

export type RenderFunctionStatus = ActionRenderProps<any>["status"];

export function processActionsForRuntimeRequest(actions: FrontendAction<any>[]) {
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
      let available: ActionInputAvailability | undefined = ActionInputAvailability.Enabled;
      if (action.disabled) {
        available = ActionInputAvailability.Disabled;
      } else if (action.available === "disabled") {
        available = ActionInputAvailability.Disabled;
      } else if (action.available === "remote") {
        available = ActionInputAvailability.Remote;
      }

      // Handle DEFINED_IN_MIDDLEWARE_EXPERIMENTAL for description
      // Pass through the sentinel for server-side middleware to replace
      const description = action.description === DEFINED_IN_MIDDLEWARE_EXPERIMENTAL
        ? DEFINED_IN_MIDDLEWARE_EXPERIMENTAL
        : (action.description || "");

      // Handle DEFINED_IN_MIDDLEWARE_EXPERIMENTAL for parameters
      // Create a marker object that the server-side middleware will detect and replace
      let jsonSchema: string;
      if (action.parameters === DEFINED_IN_MIDDLEWARE_EXPERIMENTAL) {
        jsonSchema = JSON.stringify({ __definedInMiddleware: DEFINED_IN_MIDDLEWARE_EXPERIMENTAL });
      } else {
        jsonSchema = JSON.stringify(actionParametersToJsonSchema(action.parameters || []));
      }

      return {
        name: action.name,
        description,
        jsonSchema,
        available,
      };
    });
  return filteredActions;
}
