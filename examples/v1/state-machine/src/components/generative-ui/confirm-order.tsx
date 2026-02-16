import React from "react";
import { AnimatedCard } from "@/components/animated-card";
import { useGlobalState } from "@/lib/stages";
import { Car, CardInfo, ContactInfo, FinancingInfo, Order } from "@/lib/types";

import { RenderFunctionStatus } from "@copilotkit/react-core";

interface ConfirmOrderProps {
  onConfirm: (order: Order) => void;
  onCancel: () => void;
  status: RenderFunctionStatus;
}

export const ConfirmOrder = ({
  onConfirm,
  onCancel,
  status,
}: ConfirmOrderProps) => {
  const { selectedCar, contactInfo, cardInfo, financingInfo } =
    useGlobalState();

  return (
    <AnimatedCard className="w-[500px]" status={status}>
      <h2 className="mb-4 text-2xl font-bold text-gray-800">Order Summary</h2>

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-blue-100 pb-2">
          <span className="font-medium">Vehicle</span>
          <span className="text-gray-600">
            {selectedCar?.year} {selectedCar?.make} {selectedCar?.model}
          </span>
        </div>

        <div className="flex items-center justify-between border-b border-blue-100 pb-2">
          <span className="font-medium">Price</span>
          <span className="text-gray-600">
            ${selectedCar?.price?.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center justify-between border-b border-blue-100 pb-2">
          <span className="font-medium">Customer</span>
          <span className="text-gray-600">{contactInfo?.name}</span>
        </div>

        <div className="flex items-center justify-between border-b border-blue-100 pb-2">
          <span className="font-medium">Payment</span>
          <span className="text-gray-600">
            {cardInfo?.type} ****{cardInfo?.cardNumber?.slice(-4)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="font-medium">Financing</span>
          <span className="text-gray-600">
            {financingInfo?.loanTerm} months
          </span>
        </div>
      </div>

      {status !== "complete" && (
        <ActionButtons
          onConfirm={() =>
            onConfirm({
              car: selectedCar || ({} as Car),
              contactInfo: contactInfo || ({} as ContactInfo),
              cardInfo: cardInfo || ({} as CardInfo),
              financingInfo: financingInfo || ({} as FinancingInfo),
              paymentType: cardInfo ? "card" : "financing",
            })
          }
          onCancel={onCancel}
        />
      )}
    </AnimatedCard>
  );
};

const ActionButtons = ({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <div className="mt-6 flex justify-end gap-4">
    <button
      onClick={onCancel}
      className="w-full rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-600 transition-colors duration-200 hover:bg-gray-100"
    >
      Cancel
    </button>
    <button
      onClick={onConfirm}
      className="w-full rounded-lg bg-pink-600 px-6 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-pink-800"
    >
      Confirm Order
    </button>
  </div>
);
