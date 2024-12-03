import { Action, Parameter, MappedParameterTypes } from "@copilotkit/shared";
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
  handler: undefined;
  result: undefined;
}

interface ExecutingStateWait<T extends Parameter[] | [] = []> {
  status: "executing";
  args: MappedParameterTypes<T>;
  handler: (result: any) => void;
  result: undefined;
}

interface CompleteStateWait<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
  handler: undefined;
  result: any;
}

interface InProgressStateNoArgsWait<T extends Parameter[] | [] = []> {
  status: "inProgress";
  args: Partial<MappedParameterTypes<T>>;
  handler: undefined;
  result: undefined;
}

interface ExecutingStateNoArgsWait<T extends Parameter[] | [] = []> {
  status: "executing";
  args: MappedParameterTypes<T>;
  handler: (result: any) => void;
  result: undefined;
}

interface CompleteStateNoArgsWait<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
  handler: undefined;
  result: any;
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

export type FrontendActionAvailability = "disabled" | "enabled" | "remote";

export type FrontendAction<T extends Parameter[] | [] = []> = Action<T> & {
  /**
   * @deprecated Use `available` instead.
   */
  disabled?: boolean;
  available?: FrontendActionAvailability;
  followUp?: boolean;
} & (
    | {
        render?:
          | string
          | (T extends []
              ? (props: ActionRenderPropsNoArgs<T>) => string | React.ReactElement
              : (props: ActionRenderProps<T>) => string | React.ReactElement);
        renderAndWait?: never;
      }
    | {
        render?: never;
        renderAndWait: T extends []
          ? (props: ActionRenderPropsNoArgsWait<T>) => React.ReactElement
          : (props: ActionRenderPropsWait<T>) => React.ReactElement;
        handler?: never;
      }
  );

export type RenderFunctionStatus = ActionRenderProps<any>["status"];
