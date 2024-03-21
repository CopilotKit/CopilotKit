import {
  Action,
  AnnotatedFunction,
  Parameter,
} from "@copilotkit/shared";
import { CopilotBackendImplementation } from "./copilotkit-backend-implementation";
import { RemoteChain } from "../types";

interface CopilotBackendConstructorParams<T extends Parameter[]| [] = []> {
  actions?: Action<T>[];
  langserve?: RemoteChain[];
  debug?: boolean;
}

interface CopilotDeprecatedBackendConstructorParams<T extends Parameter[]| [] = []> {
  actions?: AnnotatedFunction<any>[];
  langserve?: RemoteChain[];
  debug?: boolean;
}


export class CopilotBackend<const T extends Parameter[]| [] = []> extends CopilotBackendImplementation {
  constructor(params?: CopilotBackendConstructorParams<T>);
  // @deprecated use Action<T> instead of AnnotatedFunction<T>
  constructor(params?: CopilotDeprecatedBackendConstructorParams<T>);
  constructor(params?: CopilotBackendConstructorParams<T> | CopilotDeprecatedBackendConstructorParams<T>) {
    super(params);
  }

  // Prettier chokes on the `const` in the function signature
  // To have the main implementation checked by prettier, we split 
  // this into a separate file
  // prettier-ignore
  addAction<const T extends Parameter[] | [] = []>(action: Action<T>): void;
  /** @deprecated Use addAction with Action<T> instead. */
  addAction(action: AnnotatedFunction<any>): void;
  addAction<const T extends Parameter[] | [] = []>(action: Action<T> | AnnotatedFunction<any>): void {
    super.addAction(action);
  }
}
