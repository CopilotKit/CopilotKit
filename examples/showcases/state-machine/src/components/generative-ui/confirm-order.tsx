import React, { useRef, useState } from "react";
import { AnimatedCard } from "@/components/animated-card";
import { submitOnce } from "@/lib/single-submit";
import type { SubmissionFailure } from "@/lib/single-submit";
import type { Order } from "@/lib/types";

import { ToolCallStatus } from "@copilotkit/react-core/v2";

interface ConfirmOrderProps {
  order: Order | null;
  onConfirm: (order: Order) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
  status: ToolCallStatus;
}

export const ConfirmOrder = ({
  order,
  onConfirm,
  onCancel,
  status,
}: ConfirmOrderProps) => {
  return (
    <AnimatedCard className="w-[500px]" status={status}>
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Order Summary</h2>

      <div className="space-y-3">
        <div className="flex justify-between items-center border-b border-blue-100 pb-2">
          <span className="font-medium">Vehicle</span>
          <span className="text-gray-600">
            {order?.car.year} {order?.car.make} {order?.car.model}
          </span>
        </div>

        <div className="flex justify-between items-center border-b border-blue-100 pb-2">
          <span className="font-medium">Price</span>
          <span className="text-gray-600">
            ${order?.car.price?.toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between items-center border-b border-blue-100 pb-2">
          <span className="font-medium">Customer</span>
          <span className="text-gray-600">{order?.contactInfo.name}</span>
        </div>

        {order?.paymentType === "card" && order.cardInfo && (
          <div className="flex justify-between items-center border-b border-blue-100 pb-2">
            <span className="font-medium">Payment</span>
            <span className="text-gray-600">
              {order.cardInfo.type} ****{order.cardInfo.cardNumber.slice(-4)}
            </span>
          </div>
        )}

        {order?.paymentType === "financing" && order.financingInfo && (
          <div className="flex justify-between items-center">
            <span className="font-medium">Financing</span>
            <span className="text-gray-600">
              {order.financingInfo.loanTerm} months
            </span>
          </div>
        )}
      </div>

      {status === ToolCallStatus.Executing && order && (
        <ActionButtons onConfirm={() => onConfirm(order)} onCancel={onCancel} />
      )}
    </AnimatedCard>
  );
};

const ActionButtons = ({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => Promise<void> | void;
  onCancel: () => Promise<void> | void;
}) => {
  const pendingSubmission = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [failure, setFailure] = useState<SubmissionFailure | null>(null);
  const submit = async (action: () => Promise<void> | void) => {
    setFailure(null);
    await submitOnce({
      pending: pendingSubmission,
      action,
      onPendingChange: setIsPending,
      onError: setFailure,
    });
  };

  return (
    <div className="space-y-2 mt-6" aria-busy={isPending}>
      <div className="flex justify-end gap-4">
        <button
          type="button"
          disabled={isPending}
          onClick={async () => submit(onCancel)}
          className="px-6 py-2.5 w-full text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors duration-200 font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={async () => submit(onConfirm)}
          className="px-6 py-2.5 w-full text-white bg-pink-600 rounded-lg hover:bg-pink-800 transition-colors duration-200 font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm Order
        </button>
      </div>
      {isPending && (
        <p role="status" className="sr-only">
          Sending response.
        </p>
      )}
      {failure && (
        <div className="flex items-center justify-between gap-2 text-sm text-red-700">
          <p role="alert">{failure.message}</p>
          <button
            type="button"
            disabled={isPending}
            onClick={async () => submit(failure.retry)}
            className="font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};
