import { Action, Parameter, MappedParameterTypes } from "@copilotkit/shared";

export type FrontendAction<T extends Parameter[] | [] = []> = Action<T> & {
  inProgressLabel?:
    | string
    | (T extends []
        ? (complete: boolean) => string
        : (args: Partial<MappedParameterTypes<T>>, complete: boolean) => string);
};
