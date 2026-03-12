import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findCustomerById, getCustomerContext } from "../utils/dataLoader";

/**
 * Tool to look up customer information by customer ID
 */
export const customerLookupTool = tool(
  async ({ customerId }) => {
    const customer = findCustomerById(customerId);
    
    if (!customer) {
      return `Customer with ID ${customerId} not found. Please verify the customer ID.`;
    }
    
    return getCustomerContext(customer);
  },
  {
    name: "lookupCustomer",
    description: "Look up customer information using their customer ID. Use this when the user provides their customer ID or when you need to fetch customer details.",
    schema: z.object({
      customerId: z.string().describe("The customer ID to look up (e.g., '7590-VHVEG')"),
    }),
  }
);