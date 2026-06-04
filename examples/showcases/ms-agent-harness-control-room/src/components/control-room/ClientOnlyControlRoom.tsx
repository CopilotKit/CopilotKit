"use client";

import { useEffect, useState } from "react";

import { ControlRoomApp } from "@/components/control-room/ControlRoomApp";

export function ClientOnlyControlRoom() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main
        aria-hidden="true"
        className="cockpit-shell flex h-[100dvh] flex-col p-3 md:p-4"
      />
    );
  }

  return <ControlRoomApp />;
}
