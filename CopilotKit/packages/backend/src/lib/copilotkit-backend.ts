import {
  Action,
  Parameter,
} from "@copilotkit/shared";
import { CopilotBackendImplementation } from "./copilotkit-backend-implementation";

export class CopilotBackend extends CopilotBackendImplementation {

  // Prettier chokes on the `const` in the function signature
  // To have the main implementation checked by prettier, we split 
  // this into a separate file
  // prettier-ignore
  addAction<const T extends Parameter[] | [] = []>(action: Action<T>): void {
    super.addAction(action);
  }
}
