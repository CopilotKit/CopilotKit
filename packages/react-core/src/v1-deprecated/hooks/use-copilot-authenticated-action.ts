/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useCopilotAuthenticatedAction_c:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { Parameter } from "@copilotkit/shared";
import { Fragment, useCallback, useRef } from "react";
import { useCopilotContext } from "../context/copilot-context";
import type {
  FrontendAction,
  ActionRenderProps,
} from "../types/frontend-action";
import { useCopilotAction } from "./use-copilot-action";
import React from "react";

/**
 * Hook to create an authenticated action that requires user sign-in before execution.
 *
 * @internal Defunct — retained for backward compatibility.
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
                setAuthStates_c?.((prev) => ({
                  ...prev,
                  [action.name]: authState,
                }));
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
