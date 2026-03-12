"use client";

import { useState } from "react";
import {
  FiUser,
  FiX,
  FiCheck,
} from "react-icons/fi";
import { RxAvatar } from "react-icons/rx";
import { CustomerProvider, useCustomers } from "@/hooks/CustomerContext";
import { CopilotSidebar } from "@copilotkit/react-ui"; 
import "@copilotkit/react-ui/styles.css"; 
import { WelcomeScreen } from "@/components/WelcomeScreen";

export default function CustomerSupportPage() {
  return (
    <CustomerProvider>
      <div className="flex h-screen overflow-hidden">
        <MainApp />
        <CopilotSidebar
          defaultOpen={true}
          clickOutsideToClose={false}
          labels={{
            title: "Telecom Support Assistant",
            initial:
              "Hi! 👋 I'm here to assist you with your telecom support needs. I can help you manage your account, troubleshoot issues, or provide information about your services.",
          }}
          suggestions={[
            {
              title: "Check my services",
              message: "Hi, I want to know about my services for customer ID: 5575-GNVDE",
            },
            {
              title: "Report an outage",
              message: "My internet has been down for 2 hours! Customer ID: 7590-VHVEG",
            },
          ]}
        />
      </div>
    </CustomerProvider>
  );
}

function MainApp() {
  const {
    customers,
    getCustomerByCustomerId,
    addAddon,
    removeAddon,
    updateCustomer,
  } = useCustomers();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const selectedCustomer = selectedCustomerId
    ? getCustomerByCustomerId(selectedCustomerId)
    : null;

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
      {/* Top Header with Account Dropdown */}
      <TopHeader
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onCustomerChange={setSelectedCustomerId}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <CustomerCard
          customer={selectedCustomer}
          addAddon={addAddon}
          removeAddon={removeAddon}
          updateCustomer={updateCustomer}
        />
      </div>
    </div>
  );
}

function TopHeader({ customers, selectedCustomerId, onCustomerChange }: any) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Telecom Support</h1>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-600">
          Customer Account:
        </label>
        <select
          value={selectedCustomerId}
          onChange={(e) => onCustomerChange(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[280px]"
        >
          <option value="">Select Customer Account</option>
          {customers.map((customer: any) => (
            <option key={customer.id} value={customer.customerID}>
              {customer.customerID} - {customer.gender} ({customer.tenure}{" "}
              months)
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}

function CustomerCard({
  customer,
  addAddon,
  removeAddon,
  updateCustomer,
}: {
  customer: any;
  addAddon: any;
  removeAddon: any;
  updateCustomer: any;
}) {
  if (!customer) {
    return <WelcomeScreen />
  }

  const data = customer;
  const monthlyCharges = parseFloat(customer.MonthlyCharges);

  const activeServices = [
    data.InternetService !== "No" && {
      name: `${data.InternetService} Internet`,
      included: true,
    },
    data.PhoneService === "Yes" && { name: "Phone Service", included: true },
    data.OnlineSecurity === "Yes" && {
      name: "Online Security",
      included: true,
    },
    data.OnlineBackup === "Yes" && { name: "Online Backup", included: true },
    data.DeviceProtection === "Yes" && {
      name: "Device Protection",
      included: true,
    },
    data.TechSupport === "Yes" && { name: "Tech Support", included: true },
    data.StreamingTV === "Yes" && { name: "Streaming TV", included: true },
    data.StreamingMovies === "Yes" && {
      name: "Streaming Movies",
      included: true,
    },
  ].filter(Boolean);

  const inactiveServices = [
    data.PhoneService === "No" && { name: "Phone Service" },
    data.OnlineSecurity === "No" && { name: "Online Security" },
    data.OnlineBackup === "No" && { name: "Online Backup" },
    data.DeviceProtection === "No" && { name: "Device Protection" },
    data.TechSupport === "No" && { name: "Tech Support" },
    data.StreamingTV === "No" && { name: "Streaming TV" },
    data.StreamingMovies === "No" && { name: "Streaming Movies" },
  ].filter(Boolean);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Left Card: Wide Horizontal (Black) - 2 columns */}
        <div className="lg:col-span-2">
          <div className="bg-black rounded-3xl shadow-xl p-8 text-white">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {/* Header */}
                <h2 className="text-2xl font-bold mb-2">Current Plan</h2>
                <p className="text-sm text-gray-400 mb-6">
                  Customer ID:{" "}
                  <span className="font-mono font-semibold text-gray-300">
                    {data.customerID}
                  </span>
                </p>

                {/* Price Display */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">$</span>
                    <span className="text-6xl font-extrabold">
                      {Math.floor(monthlyCharges)}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-3xl font-bold">
                        .{(monthlyCharges % 1).toFixed(2).slice(2)}
                      </span>
                      <span className="text-sm font-medium text-gray-400">
                        /month
                      </span>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="flex gap-8 text-sm">
                  <p className="text-gray-400">
                    Contract Type:{" "}
                    <span className="text-white font-medium">
                      {data.Contract}
                    </span>
                  </p>
                  <p className="text-gray-400">
                    Customer Since:{" "}
                    <span className="text-white font-medium">
                      Jan{" "}
                      {new Date().getFullYear() -
                        Math.floor(parseInt(data.tenure) / 12)}
                    </span>
                  </p>
                </div>
              </div>

              {/* Avatar Icon */}
              <div className="flex items-center justify-center ml-6">
                <div className="w-28 h-28 bg-white rounded-full flex items-center justify-center">
                  {data.gender === "Male" ? (
                    <RxAvatar className="w-16 h-16 text-black" />
                  ) : data.gender === "Female" ? (
                    <RxAvatar className="w-16 h-16 text-black" />
                  ) : (
                    <FiUser className="w-16 h-16 text-black" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Card: Tall Vertical (White) - 1 column */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-3xl shadow-xl p-8">
            {/* Active Services */}
            <h3 className="text-2xl font-bold text-gray-900 mb-6">
              Active Services
            </h3>

            <div className="space-y-3 mb-8">
              {activeServices.map((service: any, index: number) => {
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <FiCheck
                          className="w-4 h-4 text-white"
                          strokeWidth={3}
                        />
                      </div>
                      <span className="text-sm text-gray-700 font-medium">
                        {service.name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inactive Services */}
            {inactiveServices.length > 0 && (
              <>
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-xl font-bold text-gray-500 mb-6">
                    Inactive Services
                  </h3>

                  <div className="space-y-3">
                    {inactiveServices.map((service: any, index: number) => {
                      const serviceName = service.name.replace(" ", "");

                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between gap-3 group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="shrink-0 w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center">
                              <FiX
                                className="w-4 h-4 text-white"
                                strokeWidth={3}
                              />
                            </div>
                            <span className="text-sm text-gray-400 font-medium">
                              {service.name}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">
          You Can also Ask
        </h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          Ask the AI assistant to <strong>switch to Fiber Optic or DSL</strong>, 
          <strong> enable paperless billing</strong>, 
          <strong> change payment method</strong>, or 
          <strong> add/remove services</strong> like streaming, security, and tech support.
        </p>
      </div>
    </div>
  );
}
