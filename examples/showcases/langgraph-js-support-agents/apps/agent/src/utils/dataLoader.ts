import * as fs from "fs";
import * as path from "path";
import { CustomerData } from "../types/state";

/**
 * Load tickets data from JSON file
 */
export function loadTicketsData(): CustomerData[] {
  const filePath = path.join(__dirname, "../../data/tickets.json");
  const rawData = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(rawData);
}

/**
 * Find customer by customer ID
 */
export function findCustomerById(customerId: string): CustomerData | null {
  const tickets = loadTicketsData();
  const customer = tickets.find(
    (ticket) => ticket.customerID === customerId
  );
  return customer || null;
}

/**
 * Find customers by partial match (for search)
 */
export function searchCustomers(query: string): CustomerData[] {
  const tickets = loadTicketsData();
  const lowerQuery = query.toLowerCase();
  
  return tickets.filter((ticket) => {
    return (
      ticket.customerID?.toLowerCase().includes(lowerQuery) ||
      ticket.gender?.toLowerCase().includes(lowerQuery) ||
      ticket.InternetService?.toLowerCase().includes(lowerQuery)
    );
  });
}

/**
 * Get customer statistics for context
 */
export function getCustomerContext(customer: CustomerData): string {
  return `Customer Profile:
- Customer ID: ${customer.customerID}
- Tenure: ${customer.tenure} months
- Services: ${customer.InternetService} Internet, ${customer.PhoneService} Phone
- Contract: ${customer.Contract}
- Monthly Charges: $${customer.MonthlyCharges}
- Payment Method: ${customer.PaymentMethod}
- Churn Risk: ${customer.Churn === "Yes" ? "⚠️ HIGH" : "✓ Low"}
- Senior Citizen: ${customer.SeniorCitizen === "1" ? "Yes" : "No"}`;
}