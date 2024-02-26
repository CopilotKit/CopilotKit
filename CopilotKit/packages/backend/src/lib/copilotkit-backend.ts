import {
  Action,
  Parameter,
} from "@copilotkit/shared";
import { CopilotBackendImplementation } from "./copilotkit-backend-implementation";
import { RemoteChain } from "../types";

interface CopilotBackendConstructorParams<T extends Parameter[]| [] = []> {
  actions?: Action<T>[];
  langserve?: RemoteChain[];
  debug?: boolean;
}

export class CopilotBackend<const T extends Parameter[]| [] = []> extends CopilotBackendImplementation {
  constructor(params?: CopilotBackendConstructorParams<T>) {
    super(params);
  }

  // Prettier chokes on the `const` in the function signature
  // To have the main implementation checked by prettier, we split 
  // this into a separate file
  // prettier-ignore
  addAction<const T extends Parameter[] | [] = []>(action: Action<T>): void {
    super.addAction(action);
  }
}
