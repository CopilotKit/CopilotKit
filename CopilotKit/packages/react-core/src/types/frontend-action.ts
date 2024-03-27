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

export type ActionRenderProps<T extends Parameter[] | [] = []> =
  | CompleteState<T>
  | ExecutingState<T>
  | InProgressState<T>;

export type ActionRenderPropsNoArgs<T extends Parameter[] | [] = []> =
  | CompleteStateNoArgs<T>
  | ExecutingStateNoArgs<T>
  | InProgressStateNoArgs<T>;

export type FrontendAction<T extends Parameter[] | [] = []> = Action<T> & {
  render?:
    | string
    | (T extends []
        ? (props: ActionRenderPropsNoArgs<T>) => string | React.ReactElement
        : (props: ActionRenderProps<T>) => string | React.ReactElement);
};

export type RenderFunctionStatus = ActionRenderProps<any>["status"];
