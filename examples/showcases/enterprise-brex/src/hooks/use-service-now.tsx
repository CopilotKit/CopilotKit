"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { LoaderOverlay } from "@/components/ui/loader";
import { ServiceNowList } from "@/components/service-now-list";
import { useEffect, useState } from "react";
import { ServiceNowConfirmationBox } from "@/components/service-now-confirmation-box";
import { Parameter } from "@copilotkit/shared";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";

const BASE_URL = "/api/servicenow";
const INCIDENTS_API = `${BASE_URL}/table/incident`;
const SR_API = `${BASE_URL}/table/sc_request`;

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: Buffer.from(
    `atai@copilotkit.ai:C6%rN,6W?Fr;-ub;^bPTf#<eU5c+?yhMi3oTam*(`,
  ).toString("base64"),
};

type Entity = "incident" | "service request";
const getSharedParameters = (entity: Entity): Parameter[] => [
  {
    name: "shortDescription",
    type: "string",
    description: `A short description of the ${entity}. Ask the user to describe their ${entity} in a few words`,
    required: true,
  },
  {
    name: "description",
    type: "string",
    description: `The full description of the ${entity}. Reformat it as necessary while keeping the message and tone as close as possible to what reported`,
    required: true,
  },
];

const getDescriptionPrompt = (entity: Entity): string => {
  const request =
    entity === "incident" ? "report an incident" : "create a service request";
  return `
        ${request}.
        Collect each parameter at a time. Ask for one detail, get answered, ask for the other etc.
        If the user requested to ${request} and has already supplied the details, fit them into the parameters.
        Feel free to ask for information if needed to fill up what's missing
        
        Examples:
        - User is reporting an incident and has written: "I would like to report and incident, Thing A was working but now it seems to not work anymore".
          You should be able to fill in "shortDescription" with "Thing A malfunction" and a longer description: "Thing A was working but now it seems to not work anymore"
        - User is reporting an incident and has written: "I would like to report incident because Thing A is not working, it stopped"
          You should be able to fill in "shortDescription" with "Thing A malfunction" and request a longer description.
    `;
};

const getCallerIdByEmail = async (email: string): Promise<string> => {
  const response = await fetch(`/api/servicenow/table/sys_user?email=${email}`);
  const body = await response.json();
  return body[0].sys_id;
};

export const useServiceNow = async (currentUserEmail: string) => {
  const [sysId, setSysId] = useState<string | null>(null);

  useEffect(() => {
    const fetchSysId = async () => {
      if (sysId) return;
      const sysIdResponse = await getCallerIdByEmail(currentUserEmail);
      setSysId(sysIdResponse);
    };
    fetchSysId();
  }, [sysId, currentUserEmail]);

  useCopilotReadable({
    description: "Current user details with the ShareNow interface",
    value: {
      email: currentUserEmail,
      callerId: sysId,
    },
  });

  useCopilotAction({
    name: "getIncidents",
    description:
      "Fetch all incidents for a user ordered by creation, desc. The default limit is last 5 incidents",
    parameters: [
      {
        name: "limit",
        description: "The number of results to limit to",
        type: "number",
        required: true,
      },
    ],
    followUp: false,
    handler: async ({ limit }: { limit: number }) => {
      const params = new URLSearchParams({
        sysparm_query: `opened_by=${sysId}^ORDERBYDESCsys_created_on`,
        sysparm_limit: `${limit}`,
        sysparm_fields: "short_description,number,sys_created_on,state",
      });
      const response = await fetch(`${INCIDENTS_API}?${params.toString()}`);
      return await response.json();
    },
    render: ({ status, result }) => {
      if (status === "executing" || status === "inProgress") {
        // show a loading view while the action is executing, i.e. while the meeting is being fetched
        return <LoaderOverlay />;
      } else if (status === "complete") {
        if (!result.length) return "There are no incidents";
        // show the meeting card once the action is complete
        return <ServiceNowList items={result} title="Incidents" />;
      } else {
        return "There are no incidents";
      }
    },
  });

  useCopilotAction({
    name: "reportAnIncident",
    description: getDescriptionPrompt("incident"),
    parameters: getSharedParameters("incident"),
    renderAndWait: ({ args, handler }) => {
      const { shortDescription, description } = args;
      const handleConfirm = async () => {
        const response = await fetch(INCIDENTS_API, {
          body: JSON.stringify({
            short_description: shortDescription,
            description,
            caller_id: sysId,
          }),
          method: "POST",
        });
        handler?.(
          response.status === 200
            ? "new incident was confirmed and created by the system"
            : "incident confirmed but failed to create",
        );
      };

      return (
        <ServiceNowConfirmationBox
          title={shortDescription as string}
          description={description as string}
          onConfirm={handleConfirm}
          onCancel={() => handler?.("user decided to cancel")}
        />
      );
    },
  });

  useCopilotAction({
    name: "getServiceRequests",
    description:
      "Fetch all service requests for a user ordered by creation, desc. The default limit is last 5 service requests",
    parameters: [
      {
        name: "limit",
        description: "The number of results to limit to",
        type: "number",
        required: true,
      },
    ],
    followUp: false,
    handler: async ({ limit }: { limit: number }) => {
      const params = new URLSearchParams({
        sysparm_query: `opened_by=${sysId}^ORDERBYDESCsys_created_on`,
        sysparm_limit: `${limit}`,
        sysparm_fields: "short_description,number,sys_created_on,state",
      });
      const response = await fetch(`${SR_API}?${params.toString()}`);
      return await response.json();
    },
    render: ({ status, result }) => {
      if (status === "executing" || status === "inProgress") {
        // show a loading view while the action is executing, i.e. while the meeting is being fetched
        return <LoaderOverlay />;
      } else if (status === "complete") {
        // show the meeting card once the action is complete
        if (!result.length) return "There are no service requests";
        return <ServiceNowList items={result} title="Service requests" />;
      } else {
        return "There are no service requests";
      }
    },
  });

  useCopilotAction({
    name: "createServiceRequest",
    description: getDescriptionPrompt("service request"),
    parameters: getSharedParameters("service request"),
    renderAndWait: ({ args, handler }) => {
      const { shortDescription, description } = args;
      const handleConfirm = async () => {
        const response = await fetch(SR_API, {
          body: JSON.stringify({
            short_description: shortDescription,
            description,
            caller_id: sysId,
          }),
          method: "POST",
          headers,
        });
        handler?.(
          response.status === 200
            ? "service request was confirmed and created by the system"
            : "service request confirmed but failed to create",
        );
      };

      return (
        <ServiceNowConfirmationBox
          title={shortDescription as string}
          description={description as string}
          onConfirm={handleConfirm}
          onCancel={() => handler?.("user decided to cancel")}
        />
      );
    },
  });

  useCopilotChatSuggestions({
    instructions:
      "Suggest the following: Get my incidents, Get my service requests, Report a new incident, Create a new service request",
    maxSuggestions: 4,
    minSuggestions: 4,
  });
};
