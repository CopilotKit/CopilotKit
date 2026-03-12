import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export type PaystubSummaryProps = {
  employeeName: string;
  payPeriod: string;
  grossPay: number;
  deductions: number;
  netPay: number;
};

export const PaystubSummary: React.FC<PaystubSummaryProps> = ({
  employeeName,
  payPeriod,
  grossPay,
  deductions,
  netPay,
}) => {
  if (!employeeName || !payPeriod || !grossPay || !deductions || !netPay) {
    return null;
  }
  return (
    <Card className="w-full max-w-sm mx-auto">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Paystub Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm font-medium">Employee:</span>
            <span className="text-sm">{employeeName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Pay Period:</span>
            <span className="text-sm">{payPeriod}</span>
          </div>
          <Separator className="my-2" />
          <div className="flex justify-between">
            <span className="text-sm font-medium">Gross Pay:</span>
            <span className="text-sm">${grossPay.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Deductions:</span>
            <span className="text-sm">-${deductions.toFixed(2)}</span>
          </div>
          <Separator className="my-2" />
          <div className="flex justify-between font-semibold">
            <span className="text-sm">Net Pay:</span>
            <span className="text-sm">${netPay.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
