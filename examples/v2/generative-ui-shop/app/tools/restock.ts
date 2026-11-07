import { toolDefinition } from "#app/tools/tool-definition.ts";
import { z } from "zod";

const SubscribeToRestockInput = z.object({
  productId: z.string().describe("The product to watch for restock."),
  size: z.string().describe("Which size variation to watch."),
  color: z.string().describe("Which color variation to watch."),
  email: z
    .string()
    .email()
    .describe(
      "The customer's email address. Ask them for it if you do not have it.",
    ),
});

const SubscribeToRestockOutput = z.object({
  subscribed: z.boolean(),
  message: z.string(),
});

const subscribeToRestockDef = toolDefinition({
  name: "subscribeToRestock",
  description:
    "Sign the customer up for an email alert when a specific size + color combination is back in stock. Use this when the customer wants to be notified about a variation that is currently out of stock.",
  inputSchema: SubscribeToRestockInput,
  outputSchema: SubscribeToRestockOutput,
  lazy: true,
});

export const subscribeToRestock = subscribeToRestockDef.server(
  async ({ size, color, email }) => {
    // In a real store this would write to a `restock_alerts` table and
    // fire a notification when stock changes. For the workshop we just
    // confirm the subscription.
    return {
      subscribed: true,
      message: `Got it — we'll email ${email} when size ${size} in ${color} is back in stock.`,
    };
  },
);
