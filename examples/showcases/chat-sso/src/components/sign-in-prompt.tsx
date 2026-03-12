import React, { useState } from "react";
import { Button } from "@/components/ui/button";

export interface AuthResult {
  success: boolean;
  userId?: string;
  error?: string;
}

interface SignInPromptProps {
  onSignIn: () => Promise<AuthResult>;
  message: string;
}

export function SignInPrompt({ onSignIn, message }: SignInPromptProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await onSignIn();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4">
      <p className="font-bold">{message}</p>
      <Button
        onClick={handleSignIn}
        disabled={isLoading}
        className="mt-2 bg-blue-500 hover:bg-blue-600 text-white"
      >
        {isLoading ? "Signing in..." : "Sign In"}
      </Button>
    </div>
  );
}

export function SignInSuccessPrompt({ message }: { message: string }) {
  return (
    <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-4">
      <p className="font-bold">{message}</p>
    </div>
  );
}
