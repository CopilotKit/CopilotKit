import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const generateFormTool = createTool({
  id: "generate_form",
  description:
    "Generates an event registration form for the user to sign up for an event.",
  inputSchema: z.object({}),
  execute: async () => {
    const components = [
      {
        id: "root",
        component: { Card: { child: "main-column" } },
      },
      {
        id: "main-column",
        component: {
          Column: {
            children: {
              explicitList: [
                "header",
                "name-field",
                "email-field",
                "event-type-field",
                "dietary-field",
                "register-btn",
              ],
            },
            gap: "medium",
          },
        },
      },
      {
        id: "header",
        component: {
          Column: {
            children: { explicitList: ["title", "subtitle"] },
            alignment: "center",
          },
        },
      },
      {
        id: "title",
        component: {
          Text: {
            text: { literalString: "Event Registration" },
            usageHint: "h2",
          },
        },
      },
      {
        id: "subtitle",
        component: {
          Text: {
            text: {
              literalString:
                "Register for the upcoming CopilotKit Developer Summit",
            },
            usageHint: "caption",
          },
        },
      },
      {
        id: "name-field",
        component: {
          TextField: {
            value: { path: "/name" },
            placeholder: { literalString: "Your full name" },
            label: { literalString: "Full Name" },
            action: "updateName",
          },
        },
      },
      {
        id: "email-field",
        component: {
          TextField: {
            value: { path: "/email" },
            placeholder: { literalString: "you@example.com" },
            label: { literalString: "Email" },
            action: "updateEmail",
          },
        },
      },
      {
        id: "event-type-field",
        component: {
          TextField: {
            value: { path: "/eventType" },
            placeholder: { literalString: "Workshop, Talk, or Both" },
            label: { literalString: "Session Type" },
            action: "updateEventType",
          },
        },
      },
      {
        id: "dietary-field",
        component: {
          TextField: {
            value: { path: "/dietary" },
            placeholder: { literalString: "Any dietary restrictions?" },
            label: { literalString: "Dietary Restrictions" },
            action: "updateDietary",
          },
        },
      },
      {
        id: "register-btn-text",
        component: {
          Text: { text: { literalString: "Register" } },
        },
      },
      {
        id: "register-btn",
        component: {
          Button: { child: "register-btn-text", action: "register" },
        },
      },
    ];

    return [
      { surfaceUpdate: { surfaceId: "event-registration", components } },
      { beginRendering: { surfaceId: "event-registration", root: "root" } },
    ];
  },
});
