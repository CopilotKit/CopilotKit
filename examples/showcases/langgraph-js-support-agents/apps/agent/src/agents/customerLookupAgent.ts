import { RunnableConfig } from "@langchain/core/runnables";
import { CustomerSupportState } from "../types/state";

/**
 * Customer Lookup Agent Node
 * Attempts to identify customer from their message or existing state
 * Uses customers array from shared state (synced with frontend)
 */
export async function customerLookupAgentNode(
  state: CustomerSupportState,
  config: RunnableConfig
): Promise<Partial<CustomerSupportState>> {
  console.log("Customer Lookup Agent: Searching for customer...");

  // Check if customer already identified
  if (state.currentCustomer?.found) {
    console.log(`Customer already identified: ${state.currentCustomer.id}`);
    return {};
  }

  // Extract customer ID from last message
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];
  const messageText =
    typeof lastMessage?.content === "string" ? lastMessage.content : "";

  // Look for customer ID pattern (e.g., "7590-VHVEG")
  const customerIdPattern = /\b\d{4}-[A-Z]{5}\b/;
  const match = messageText.match(customerIdPattern);

  if (match) {
    const customerId = match[0];
    console.log(`Found customer ID in message: ${customerId}`);

    try {
      // Use customers from shared state (synced with frontend)
      const customers = (state as any).customers || [];
      const customerData = customers.find(
        (c: any) => c.customerID === customerId
      );

      if (customerData) {
        console.log(`Customer found: ${customerId}`);
        // Return complete state including customers
        return {
          ...state,
          currentCustomer: {
            id: customerId,
            found: true,
            data: customerData,
          },
        };
      } else {
        console.log(`Customer ID not found: ${customerId}`);
        // Return complete state including customers
        return {
          ...state,
          currentCustomer: {
            id: customerId,
            found: false,
            data: null,
          },
        };
      }
    } catch (error) {
      console.error("Customer lookup error:", error);
    }
  }

  console.log("No customer ID found in message");
  // Return complete state including customers
  return { ...state };
}
