"use client";
import {
  PaystubSummary,
  PaystubSummaryProps,
} from "@/components/paystub-summary";
import { AuthResult, SignInPrompt } from "@/components/sign-in-prompt";
import {
  useCopilotAction,
  useCopilotChat,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { Profile } from "@workos-inc/node";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Suspense } from "react";

export default function Chat() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ChatContainer />
    </Suspense>
  );
}

function ChatContainer() {
  const { appendMessage } = useCopilotChat();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const router = useRouter();
  const [authState, setAuthState] = useState<{
    isAuthenticated: boolean;
    userId: string;
    profile?: Partial<Profile>;
    authorizationUrl: string;
    paystubSummary?: PaystubSummaryProps;
  }>({
    isAuthenticated: false,
    userId: "",
    authorizationUrl: "",
  });

  const handleSignIn = async (
    authorizationUrl: string
  ): Promise<AuthResult> => {
    try {
      window.open(authorizationUrl, "_blank");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  };

  useEffect(() => {
    // trigger `onReceivingCallbackCode` action
    if (code) {
      appendMessage(
        new TextMessage({
          role: Role.System,
          content: `Here is authorization code ${code} for the user`,
        })
      );

      router.replace("/");
    }
  }, [code]);

  /*
    On mount, check if the user is authenticated by checking local storage
   */
  useEffect(() => {
    const profile = JSON.parse(
      localStorage.getItem("profile") ?? "{}"
    ) as Partial<Profile>;

    if (profile && Object.keys(profile).length > 0) {
      setAuthState((prev) => ({ ...prev, profile, isAuthenticated: true }));
      appendMessage(
        new TextMessage({
          role: Role.System,
          content: `You are a helpful assistant for Hexaware. Welcome ${profile.firstName}!`,
        })
      );
    } else {
      setAuthState((prev) => ({
        ...prev,
        isAuthenticated: false,
      }));
      appendMessage(
        new TextMessage({
          role: Role.System,
          content:
            "Please generate an authorization url for the user to sign in",
        })
      );
    }
  }, []);

  // Make auth state readable by the copilot
  useCopilotReadable({
    description: "User authentication state",
    value: authState,
  });

  useCopilotAction({
    name: "uponReceivingAuthorizationUrl",
    description:
      "when you receive an authorization url, you will be prompted to sign in",
    parameters: [
      {
        name: "authorizationUrl",
        description: "The authorization URL to sign in",
        type: "string",
        required: true,
      },
    ],
    render: ({ args }) => {
      const { authorizationUrl } = args;
      console.log("authorizationUrl", authorizationUrl);
      return (
        <SignInPrompt
          onSignIn={async () => {
            return handleSignIn(authorizationUrl!);
          }}
          message="Please sign in to continue"
        />
      );
    },
    followUp: false,
  });

  useCopilotAction({
    name: "updateUserProfile",
    description:
      "When you receive a profile and access token, update the user's profile and access token in local storage",
    parameters: [
      // Profile object
      {
        name: "id",
        description: "The id of the user",
        type: "string",
      },
      {
        name: "firstName",
        description: "The first name of the user",
        type: "string",
      },
      {
        name: "lastName",
        description: "The last name of the user",
        type: "string",
      },
      {
        name: "email",
        description: "The email of the user",
        type: "string",
      },
    ],
    handler: async (args) => {
      const { id, email, firstName, lastName } = args;
      console.log("SHIT", id, email, firstName, lastName);
      /*
       * Update local storage with the user's profile and access token
       */
      if (id && email && firstName && lastName) {
        localStorage.setItem(
          "profile",
          JSON.stringify({
            id,
            email,
            firstName,
            lastName,
          })
        );
        setAuthState((prev) => ({
          ...prev,
          isAuthenticated: true,
          userId: id,
          profile: {
            id,
            email,
            firstName,
            lastName,
          },
        }));
      }
    },
  });

  useCopilotAction({
    name: "updatePaystubSummary",
    parameters: [
      {
        name: "employeeName",
        description: "The name of the employee",
        type: "string",
      },
      {
        name: "payPeriod",
        description: "The pay period for the paystub",
        type: "string",
      },
      {
        name: "grossPay",
        description: "The gross pay for the paystub",
        type: "number",
      },
      {
        name: "deductions",
        description: "The deductions for the paystub",
        type: "number",
      },
      {
        name: "netPay",
        description: "The net pay for the paystub",
        type: "number",
      },
    ],
    description:
      "You will be provided with a paystub summary. Use this action to render the custom summary component using available data",
    handler: (args) => {
      setAuthState({
        ...authState,
        paystubSummary: args as PaystubSummaryProps,
      });
    },
    followUp: false,
  });

  useCopilotAction({
    name: "summarizePaystub",
    description:
      "Summarize the paystub summary. Use this action to render the custom summary component using available data",
    parameters: [
      {
        name: "employeeName",
        description: "The name of the employee",
        type: "string",
      },
      {
        name: "payPeriod",
        description: "The pay period for the paystub",
        type: "string",
      },
      {
        name: "grossPay",
        description: "The gross pay for the paystub",
        type: "number",
      },
      {
        name: "deductions",
        description: "The deductions for the paystub",
        type: "number",
      },
      {
        name: "netPay",
        description: "The net pay for the paystub",
        type: "number",
      },
    ],
    render: ({ args }) => <PaystubSummary {...(args as PaystubSummaryProps)} />,
    followUp: false,
  });

  console.log("authState.isAuthenticated", authState.isAuthenticated);

  return (
    <>
      <div className="fixed top-2 right-2 p-3 bg-white rounded-full shadow-sm border">
        {authState.isAuthenticated ? (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-green-700">
              Welcome, {authState.profile?.firstName}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 bg-gray-400 rounded-full" />
            <span className="text-gray-600 font-bold">Not signed in</span>
          </div>
        )}
      </div>
      <CopilotPopup
        defaultOpen={true}
        instructions={
          "You are HexaBot, a friendly assistant for Hexaware. Help users with questions about Hexaware's services, technical support, and company information. Be concise and professional."
        }
      />
    </>
  );
}
