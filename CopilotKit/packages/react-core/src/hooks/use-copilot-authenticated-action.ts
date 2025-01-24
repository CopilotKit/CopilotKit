import { Parameter } from "@copilotkit/shared";
import { Fragment, useCallback, useRef } from "react";
import { useCopilotContext } from "../context/copilot-context";
import { FrontendAction, ActionRenderProps } from "../types/frontend-action";
import { useCopilotAction } from "./use-copilot-action";
import React from "react";

/**
 * Hook to create an authenticated action that requires user sign-in before execution.
 *
 * @remarks
 * This feature is only available when using CopilotKit's hosted cloud service.
 * To use this feature, sign up at https://cloud.copilotkit.ai to get your publicApiKey.
 *
 * @param action - The frontend action to be wrapped with authentication
 * @param dependencies - Optional array of dependencies that will trigger recreation of the action when changed
 */
export function useCopilotAuthenticatedAction_c<T extends Parameter[]>(
  action: FrontendAction<T>,
  dependencies?: any[],
): void {
  const { authConfig_c, authStates_c, setAuthStates_c } = useCopilotContext();
  const pendingActionRef = useRef<ActionRenderProps<Parameter[]> | null>(null);

  const executeAction = useCallback(
    (props: ActionRenderProps<Parameter[]>) => {
      if (typeof action.render === "function") {
        return action.render(props);
      }
      return action.render || React.createElement(Fragment);
    },
    [action],
  );

  const wrappedRender = useCallback(
    (props: ActionRenderProps<Parameter[]>): string | React.ReactElement => {
      const isAuthenticated = Object.values(authStates_c || {}).some(
        (state) => state.status === "authenticated",
      );

      if (!isAuthenticated) {
        // Store action details for later execution
        pendingActionRef.current = props;

        return authConfig_c?.SignInComponent
          ? React.createElement(authConfig_c.SignInComponent, {
              onSignInComplete: (authState) => {
                setAuthStates_c?.((prev) => ({ ...prev, [action.name]: authState }));
                if (pendingActionRef.current) {
                  executeAction(pendingActionRef.current);
                  pendingActionRef.current = null;
                }
              },
            })
          : React.createElement(Fragment);
      }

      return executeAction(props);
    },
    [action, authStates_c, setAuthStates_c],
  );

  useCopilotAction(
    {
      ...action,
      render: wrappedRender,
    } as FrontendAction<T>,
    dependencies,
  );
}
