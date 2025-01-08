import { Parameter } from "@copilotkit/shared";
import { Fragment, useCallback, useRef } from "react";
import { useCopilotContext } from "../context/copilot-context";
import { FrontendAction, ActionRenderProps } from "../types/frontend-action";
import { useCopilotAction } from "./use-copilot-action";
import React from "react";

export function useCopilotAuthenticatedAction<T extends Parameter[]>(
  action: FrontendAction<T>,
  dependencies?: any[],
): void {
  const { authConfig, authStates, setAuthStates } = useCopilotContext();
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
      const isAuthenticated = Object.values(authStates || {}).some(
        (state) => state.status === "authenticated",
      );

      if (!isAuthenticated) {
        // Store action details for later execution
        pendingActionRef.current = props;

        return authConfig?.SignInComponent
          ? React.createElement(authConfig.SignInComponent, {
              onSignInComplete: (authState) => {
                setAuthStates?.((prev) => ({ ...prev, [action.name]: authState }));
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
    [action, authStates, setAuthStates],
  );

  useCopilotAction(
    {
      ...action,
      render: wrappedRender,
    } as FrontendAction<T>,
    dependencies,
  );
}
