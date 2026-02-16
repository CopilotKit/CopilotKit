"use client";

import { useState } from "react";
import { V150EarlyAccessModal } from "@/components/layout/v150-early-access-modal";

export function SignUpSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <p className="text-muted-foreground">
        Want to be the first to know about new features?{" "}
        <button
          onClick={() => setIsModalOpen(true)}
          className="text-primary cursor-pointer border-none bg-transparent p-0 font-medium hover:underline"
        >
          Sign up for early access
        </button>{" "}
        to upcoming releases.
      </p>

      <V150EarlyAccessModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
