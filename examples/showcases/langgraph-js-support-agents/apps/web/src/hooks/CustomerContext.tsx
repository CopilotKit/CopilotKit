"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { calculateMonthlyCharges } from "@/utils/servicePricing";
import { useCoAgent, useFrontendTool } from "@copilotkit/react-core";
import { initialCustomers } from "@/data/ticketsData";

export interface Customer {
  id: number;
  customerID: string;
  gender: string;
  SeniorCitizen: "0";
  Partner: "Yes" | "No";
  Dependents: "Yes" | "No";
  tenure: string;
  PhoneService: "Yes" | "No";
  MultipleLines: "Yes" | "No" | "No phone service";
  InternetService: "DSL" | "Fiber optic";
  OnlineSecurity: "Yes" | "No";
  OnlineBackup: "Yes" | "No";
  DeviceProtection: "Yes" | "No";
  TechSupport: "Yes" | "No";
  StreamingTV: "Yes" | "No";
  StreamingMovies: "Yes" | "No";
  Contract: "Month-to-month";
  PaperlessBilling: "Yes" | "No";
  PaymentMethod:
    | "Electronic check"
    | "Mailed check"
    | "Bank transfer (automatic)"
    | "Credit card (automatic)";
  MonthlyCharges: string;
  TotalCharges: string;
  Churn: "No" | "Yes";
  status: "new" | "active" | "resolved" | "escalated";
}

export interface NewCustomerInput {
  gender: string;
  Partner: "Yes" | "No";
  Dependents: "Yes" | "No";
  tenure: string;
  PhoneService: "Yes" | "No";
  MultipleLines?: "Yes" | "No" | "No phone service";
  InternetService: "DSL" | "Fiber optic";
  OnlineSecurity: "Yes" | "No";
  OnlineBackup: "Yes" | "No";
  DeviceProtection: "Yes" | "No";
  TechSupport: "Yes" | "No";
  StreamingTV: "Yes" | "No";
  StreamingMovies: "Yes" | "No";
  PaperlessBilling: "Yes" | "No";
  PaymentMethod:
    | "Electronic check"
    | "Mailed check"
    | "Bank transfer (automatic)"
    | "Credit card (automatic)";
}

export type AddonService =
  | "PhoneService"
  | "MultipleLines"
  | "OnlineSecurity"
  | "OnlineBackup"
  | "DeviceProtection"
  | "TechSupport"
  | "StreamingTV"
  | "StreamingMovies";

interface CustomerContextType {
  customers: Customer[];
  addCustomer: (customerData: NewCustomerInput) => Customer;
  deleteCustomer: (customerId: number) => boolean;
  updateCustomer: (
    customerId: number,
    updates: Partial<Customer>
  ) => Customer | null;
  addAddon: (customerId: string, addon: AddonService) => Customer | null;
  removeAddon: (customerId: string, addon: AddonService) => Customer | null;
  getCustomerById: (customerId: number) => Customer | undefined;
  getCustomerByCustomerId: (customerID: string) => Customer | undefined;
  recalculateCharges: (customer: Customer) => {
    monthlyCharges: number;
    totalCharges: number;
  };
}

type AgentState = {
  customers: Customer[];
};

const CustomerContext = createContext<CustomerContextType | undefined>(
  undefined
);

function generateCustomerID(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const letters = Array.from({ length: 5 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26))
  ).join("");
  return `${digits}-${letters}`;
}

export function CustomerProvider({ children }: { children: ReactNode }) {
  // Use useCoAgent as the single source of truth
  const { state: agentState, setState: setAgentState } = useCoAgent<AgentState>(
    {
      name: "starterAgent",
      initialState: {
        customers: initialCustomers,
      },
    }
  );

  // OPTION 1: Optimistic local state + agent sync
  const [localCustomers, setLocalCustomers] = useState<Customer[] | null>(null);

  // Derive customers: local override takes precedence over agent state
  const customers = localCustomers ?? agentState.customers ?? [];
  // Keep a ref to always have the latest customers in closures
  const customersRef = useRef<Customer[]>([]);
  useEffect(() => {
    customersRef.current = customers;
  }, [customers, agentState.customers]);

  // Clear local override when agent catches up
  useEffect(() => {
    if (
      localCustomers &&
      JSON.stringify(localCustomers) === JSON.stringify(agentState.customers)
    ) {
      setLocalCustomers(null);
    }
  }, [agentState.customers, localCustomers]);

  const recalculateCharges = useCallback((customer: Customer) => {
    const calculation = calculateMonthlyCharges(customer);
    const monthlyCharges = calculation.total;
    const tenure = parseInt(customer.tenure) || 0;
    const totalCharges = monthlyCharges * tenure;

    return { monthlyCharges, totalCharges };
  }, []);

  const addCustomer = useCallback(
    (customerData: NewCustomerInput): Customer => {
      const newId =
        customers.length > 0 ? Math.max(...customers.map((c) => c.id)) + 1 : 1;

      // Handle MultipleLines based on PhoneService
      const multipleLines =
        customerData.MultipleLines ||
        (customerData.PhoneService === "No" ? "No phone service" : "No");

      // Create customer with temporary charges
      const tempCustomer: Customer = {
        ...customerData,
        id: newId,
        customerID: generateCustomerID(),
        SeniorCitizen: "0",
        MultipleLines: multipleLines,
        Contract: "Month-to-month",
        MonthlyCharges: "0",
        TotalCharges: "0",
        Churn: "No",
        status: "new",
      };

      // Calculate actual charges
      const { monthlyCharges, totalCharges } = recalculateCharges(tempCustomer);

      const newCustomer: Customer = {
        ...tempCustomer,
        MonthlyCharges: monthlyCharges.toFixed(2),
        TotalCharges: totalCharges.toFixed(2),
      };

      const updatedCustomers = [...customers, newCustomer];
      // Update BOTH local and agent state
      setLocalCustomers(updatedCustomers);
      setAgentState({ customers: updatedCustomers });
      return newCustomer;
    },
    [customers, recalculateCharges, setAgentState]
  );

  const deleteCustomer = useCallback(
    (customerId: number): boolean => {
      const initialLength = customers.length;
      const updatedCustomers = customers.filter((c) => c.id !== customerId);
      // Update BOTH local and agent state
      setLocalCustomers(updatedCustomers);
      setAgentState({ customers: updatedCustomers });
      return initialLength !== updatedCustomers.length;
    },
    [customers, setAgentState]
  );

  const updateCustomer = useCallback(
    (customerId: number, updates: Partial<Customer>): Customer | null => {
      let updatedCustomer: Customer | null = null;

      const updatedCustomers = customers.map((customer) => {
        if (customer.id === customerId) {
          const updated = { ...customer, ...updates };

          // Handle MultipleLines dependency on PhoneService
          if (updates.PhoneService === "No") {
            updated.MultipleLines = "No phone service";
          } else if (
            updates.PhoneService === "Yes" &&
            updated.MultipleLines === "No phone service"
          ) {
            updated.MultipleLines = "No";
          }

          // Recalculate charges if any service changed
          const { monthlyCharges, totalCharges } = recalculateCharges(updated);
          updated.MonthlyCharges = monthlyCharges.toFixed(2);
          updated.TotalCharges = totalCharges.toFixed(2);

          updatedCustomer = updated;
          return updated;
        }
        return customer;
      });

      setLocalCustomers(updatedCustomers);
      setAgentState({ customers: updatedCustomers });
      return updatedCustomer;
    },
    [customers, recalculateCharges, setAgentState]
  );

  const addAddon = useCallback(
    (customerId: string, addon: AddonService): Customer | null => {
      let updatedCustomer: Customer | null = null;
      const updatedCustomers = customersRef.current.map((customer) => {
        if (customer.customerID === customerId) {
          const updates: Partial<Customer> = {};

          // Handle PhoneService and MultipleLines special case
          if (addon === "PhoneService") {
            updates.PhoneService = "Yes";
            if (customer.MultipleLines === "No phone service") {
              updates.MultipleLines = "No";
            }
          } else if (addon === "MultipleLines") {
            if (customer.PhoneService === "No") {
              return customer;
            }
            updates.MultipleLines = "Yes";
          } else {
            updates[addon] = "Yes";
          }
          const updated = { ...customer, ...updates };

          // Recalculate charges
          const { monthlyCharges, totalCharges } = recalculateCharges(updated);
          updated.MonthlyCharges = monthlyCharges.toFixed(2);
          updated.TotalCharges = totalCharges.toFixed(2);

          updatedCustomer = updated;
          return updated;
        }
        return customer;
      });

      if (updatedCustomer) {
        // Update BOTH local and agent state
        setLocalCustomers(updatedCustomers);
        setAgentState({ customers: updatedCustomers });
      } else {
        console.warn(
          `[CustomerContext] Failed to update. Customer ID ${customerId} not found in state.`
        );
      }

      return updatedCustomer;
    },
    [customers, recalculateCharges, setAgentState]
  );

  const removeAddon = (
    customerId: string,
    addon: AddonService
  ): Customer | null => {
    let updatedCustomer: Customer | null = null;

    const updatedCustomers = customersRef.current.map((customer) => {
      if (customer.customerID === customerId) {
        const updates: Partial<Customer> = {};

        // Handle PhoneService and MultipleLines special case
        if (addon === "PhoneService") {
          updates.PhoneService = "No";
          updates.MultipleLines = "No phone service";
        } else if (addon === "MultipleLines") {
          updates.MultipleLines = "No";
        } else {
          updates[addon] = "No";
        }

        const updated = { ...customer, ...updates };

        // Recalculate charges
        const { monthlyCharges, totalCharges } = recalculateCharges(updated);
        updated.MonthlyCharges = monthlyCharges.toFixed(2);
        updated.TotalCharges = totalCharges.toFixed(2);

        updatedCustomer = updated;
        return updated;
      }
      return customer;
    });

    if (updatedCustomer) {
      // Update BOTH local and agent state
      setLocalCustomers(updatedCustomers);
      setAgentState({ customers: updatedCustomers });
    }

    return updatedCustomer;
  };

  const getCustomerById = useCallback(
    (customerId: number): Customer | undefined => {
      return customers.find((c) => c.id === customerId);
    },
    [customers]
  );

  const getCustomerByCustomerId = useCallback(
    (customerID: string): Customer | undefined => {
      return customers.find((c) => c.customerID === customerID);
    },
    [customers]
  );

  // Frontend Tool: Add Addon
  useFrontendTool({
    name: "addAddonToCustomer",
    description:
      "Add a service addon to a customer. This will enable a specific service for the customer and recalculate their monthly charges automatically.",
    parameters: [
      {
        name: "customerID",
        type: "string",
        description:
          "The unique customer ID (e.g., '5575-GNVDE', '7590-VHVEG')",
        required: true,
      },
      {
        name: "addonName",
        type: "string",
        description:
          "The name of the addon service to add. Valid options: PhoneService, MultipleLines, OnlineSecurity, OnlineBackup, DeviceProtection, TechSupport, StreamingTV, StreamingMovies",
        required: true,
      },
    ],
    handler: async ({ customerID, addonName }) => {
      // Access current state directly from ref to avoid stale closure
      const currentCustomers = customersRef.current;
      const customer = currentCustomers.find(
        (c) => c.customerID === customerID
      );
      if (!customer) {
        return {
          success: false,
          message: `Customer with ID ${customerID} not found`,
        };
      }

      const result = addAddon(customer.customerID, addonName as AddonService);
      if (!result) {
        return {
          success: false,
          message: `Failed to add ${addonName}. Check if prerequisites are met (e.g., PhoneService required for MultipleLines)`,
        };
      }

      // setAgentState({ customers: result });
      return {
        success: true,
        message: `Successfully added ${addonName} to customer ${customer.customerID}`,
        newMonthlyCharges: result.MonthlyCharges,
        customer: {
          id: result.id,
          customerID: result.customerID,
          monthlyCharges: result.MonthlyCharges,
        },
      };
    },
  });

  // Frontend Tool: Remove Addon
  useFrontendTool({
    name: "removeAddonFromCustomer",
    description:
      "Remove a service addon from a customer. This will disable a specific service for the customer and recalculate their monthly charges automatically.",
    parameters: [
      {
        name: "customerID",
        type: "string",
        description:
          "The unique customer ID (e.g., '5575-GNVDE', '7590-VHVEG')",
        required: true,
      },
      {
        name: "addonName",
        type: "string",
        description:
          "The name of the addon service to remove. Valid options: PhoneService, MultipleLines, OnlineSecurity, OnlineBackup, DeviceProtection, TechSupport, StreamingTV, StreamingMovies",
        required: true,
      },
    ],
    handler: async ({ customerID, addonName }) => {
      // Access current state directly from ref to avoid stale closure
      const currentCustomers = customersRef.current;
      const customer = currentCustomers.find(
        (c) => c.customerID === customerID
      );

      if (!customer) {
        return {
          success: false,
          message: `Customer with ID ${customerID} not found`,
        };
      }

      const result = removeAddon(
        customer.customerID,
        addonName as AddonService
      );

      if (!result) {
        return {
          success: false,
          message: `Failed to remove ${addonName}`,
        };
      }

      return {
        success: true,
        message: `Successfully removed ${addonName} from customer ${customer.customerID}`,
        newMonthlyCharges: result.MonthlyCharges,
        customer: {
          id: result.customerID,
          customerID: result.customerID,
          monthlyCharges: result.MonthlyCharges,
        },
      };
    },
  });

  // Frontend Tool: Update Customer Settings
  useFrontendTool({
    name: "updateCustomerSettings",
    description:
      "Update customer settings such as Internet Service (switch between DSL and Fiber optic), Paperless Billing, or Partner status. This will recalculate monthly charges automatically.",
    parameters: [
      {
        name: "customerID",
        type: "string",
        description:
          "The unique customer ID (e.g., '5575-GNVDE', '7590-VHVEG')",
        required: true,
      },
      {
        name: "setting",
        type: "string",
        description:
          "The setting to update. Valid options: 'InternetService', 'PaperlessBilling', 'Partner'",
        required: true,
      },
      {
        name: "value",
        type: "string",
        description:
          "The new value for the setting. For InternetService: 'DSL' or 'Fiber optic'. For PaperlessBilling/Partner: 'Yes' or 'No'",
        required: true,
      },
    ],
    handler: async ({ customerID, setting, value }) => {
      // Access current state directly from ref to avoid stale closure
      const currentCustomers = customersRef.current;
      const customer = currentCustomers.find(
        (c) => c.customerID === customerID
      );

      if (!customer) {
        return {
          success: false,
          message: `Customer with ID ${customerID} not found`,
        };
      }

      // Validate setting and value
      const validSettings = ["InternetService", "PaperlessBilling", "Partner"];
      if (!validSettings.includes(setting)) {
        return {
          success: false,
          message: `Invalid setting: ${setting}. Valid options: ${validSettings.join(", ")}`,
        };
      }

      // Validate values based on setting
      if (setting === "InternetService") {
        if (value !== "DSL" && value !== "Fiber optic") {
          return {
            success: false,
            message: `Invalid value for InternetService: ${value}. Must be 'DSL' or 'Fiber optic'`,
          };
        }
      } else if (setting === "PaperlessBilling" || setting === "Partner") {
        if (value !== "Yes" && value !== "No") {
          return {
            success: false,
            message: `Invalid value for ${setting}: ${value}. Must be 'Yes' or 'No'`,
          };
        }
      }

      // Update the customer using updateCustomer function
      const updates: Partial<Customer> = {
        [setting]: value as any,
      };

      const result = updateCustomer(customer.id, updates);

      if (!result) {
        return {
          success: false,
          message: `Failed to update ${setting} for customer ${customerID}`,
        };
      }

      return {
        success: true,
        message: `Successfully updated ${setting} to '${value}' for customer ${customer.customerID}`,
        newMonthlyCharges: result.MonthlyCharges,
        customer: {
          id: result.id,
          customerID: result.customerID,
          monthlyCharges: result.MonthlyCharges,
          [setting]: result[setting as keyof Customer],
        },
      };
    },
  });

  const value: CustomerContextType = {
    customers,
    addCustomer,
    deleteCustomer,
    updateCustomer,
    addAddon,
    removeAddon,
    getCustomerById,
    getCustomerByCustomerId,
    recalculateCharges,
  };

  return (
    <CustomerContext.Provider value={value}>
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomers() {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error("useCustomers must be used within a CustomerProvider");
  }
  return context;
}
