import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ConfirmationBoxProps {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}

export function ServiceNowConfirmationBox({
  title,
  description,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
}: ConfirmationBoxProps) {
  const [resolution, setResolution] = useState(false);

  const handleConfirm = useCallback(() => {
    setResolution(true);
    onConfirm();
  }, [onConfirm]);
  const handleCancel = useCallback(() => {
    setResolution(true);
    onCancel();
  }, [onCancel]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600">{description}</p>
      </CardContent>
      {!resolution && (
        <CardFooter className="flex justify-end space-x-2">
          <Button variant="outline" onClick={handleCancel}>
            {cancelText}
          </Button>
          <Button onClick={handleConfirm}>{confirmText}</Button>
        </CardFooter>
      )}
    </Card>
  );
}
