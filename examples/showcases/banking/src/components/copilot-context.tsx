"use client";
import { useAgentContext, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useAuthContext } from "@/components/auth-context";
import { Button } from "./ui/button";

export enum Page {
  Cards = "cards",
  Team = "team",
}

export enum CardsPageOperations {
  ChangePin = "change-pin",
}

export enum TeamPageOperations {
  InviteMember = "invite-member",
  RemoveMember = "remove-member",
  EditMember = "edit-member",
}

export const AVAILABLE_OPERATIONS_PER_PAGE = {
  [Page.Cards]: Object.values(CardsPageOperations),
  [Page.Team]: Object.values(TeamPageOperations),
};

// A component dedicated to adding readables/actions that are global to the app.
const CopilotContext = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuthContext();

  // A readable of app wide authentication and authorization context.
  // The LLM will now know which user is it working against, when performing operations.
  // Given the respective authorization role, the LLM will allow/deny actions/information throughout the entire app.
  useAgentContext({
    description: "The current user logged into the system",
    value: JSON.stringify(currentUser),
  });

  useAgentContext({
    description:
      "The available pages and operations, as well as the current page",
    value: {
      pages: Object.values(Page),
      operations: AVAILABLE_OPERATIONS_PER_PAGE,
      currentPage: window.location.pathname.split("/").pop() as Page,
    },
  });

  // This action is a generic "fits all" action
  // It's meant to allow the LLM to navigate to a page where an operation is available or probably available, and possibly activate the operation there.
  // It is tired to the readable above, and requires that operations are implemented in their respective pages.
  // The LLM here will redirect the user to a different page, and set an `operation` query param to notify the page of the requested action
  // For example, you can find `change-pin` in the cards page, which is activated when `operation=change-pin` query param is sent
  useHumanInTheLoop({
    name: "navigateToPageAndPerform",
    description: `
            Navigate to a different page to perform an operation.
            IMPORTANT: Only use this action when the user needs to go to a DIFFERENT page than the one they are currently on.
            Do NOT use this if the user is already on the correct page - instead, use the page-specific tools directly.
            For example, if the user is on the cards page and asks to add a card, do NOT use this action - use the addNewCard tool instead.
            Only use this when the user is on the wrong page entirely (e.g., on team page but asking about cards).
        `,
    parameters: z.object({
      page: z
        .enum(["/cards", "/team", "/"])
        .describe("The page in which to perform the operation"),
      operation: z
        .string()
        .describe(
          "The operation to perform. Use operation code from available operations per page. If the operation is unavailable, do not pass it",
        )
        .optional(),
      operationAvailable: z
        .boolean()
        .describe("Flag if the operation is available"),
    }),
    followUp: false,
    render: ({ args, respond }) => {
      const { page, operation, operationAvailable } = args;

      return (
        <div className="flex items-center justify-center space-x-4 rounded-lg bg-white p-4">
          <div>Navigate to {page}?</div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const operationParams = `?operation=${operation}`;
              window.location.href = `${page!.toLowerCase()}${
                operationAvailable ? operationParams : ""
              }`;
              respond?.(page!);
            }}
            aria-label="Confirm Navigation"
            className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
          >
            Yes
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => respond?.("cancelled")}
            aria-label="Cancel Navigation"
            className="h-12 w-12 rounded-full bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-700 dark:bg-gray-900/20 dark:text-gray-400 dark:hover:bg-gray-900/30 dark:hover:text-gray-300"
          >
            No
          </Button>
        </div>
      );
    },
  });

  return children;
};

export default CopilotContext;
