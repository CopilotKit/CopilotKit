import { Action, Parameter, MappedParameterTypes } from "@copilotkit/shared";

export type FrontendAction<T extends Parameter[] | [] = []> = Action<T> & {
  inProgressLabel?: string | T extends []
    ? () => string | Promise<string>
    : (args: Partial<MappedParameterTypes<T>>) => string | Promise<string>;
};
