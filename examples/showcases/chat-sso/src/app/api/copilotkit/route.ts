import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";
import { WorkOS } from "@workos-inc/node";

const workos = new WorkOS(process.env.WORKOS_API_KEY);
const clientId = process.env.WORKOS_CLIENT_ID!;
/*
  CopilotKit uses the redirectUri to redirect the user to the callback URL
  after the user has signed in. 
 */
const redirectUri = process.env.REDIRECT_URI!;

const serviceAdapter = new OpenAIAdapter();
const runtime = new CopilotRuntime({
  actions: [
    {
      name: "generateAuthorizationUrl",
      description: "Returns authorizationUrl for the user to sign in",
      handler: async () => ({
        message: `Here is the authorization url: ${await workos.sso.getAuthorizationUrl(
          {
            provider: "GoogleOAuth",
            redirectUri,
            clientId,
          }
        )}`,
      }),
    },
    {
      name: "onReceivingCallbackCode",
      description: "Returns the profile and access token of the user",
      parameters: [
        {
          name: "code",
          description: "The code received from the callback",
          type: "string",
          required: true,
        },
      ],
      handler: async (args: { code: string }) => {
        const { code } = args;

        if (!code) {
          return {
            message: "Code is required, please sign in before continuing",
          };
        }

        const { profile } = await workos.sso.getProfileAndToken({
          code,
          clientId,
        });
        return profile;
      },
    },
    {
      name: "onRequestingPaystub",
      description:
        "Whenever the user requests a paystub, use this action to get the paystub summary",
      parameters: [
        {
          name: "isAuthenticated",
          description: "Indicates if the user is authenticated",
          type: "boolean",
        },
      ],
      handler: (args: { isAuthenticated: boolean }) => {
        const { isAuthenticated } = args;
        if (!isAuthenticated) {
          return {
            message: "User is not authenticated",
          };
        }
        /*
          Mock returning a paystub summary
         */
        return {
          message: "Paystub summary fetched",
          paystubSummary: {
            employeeName: "John Doe",
            payPeriod: "January 2024",
            grossPay: 1000,
            deductions: 100,
            netPay: 900,
          },
        };
      },
    },
  ],
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
