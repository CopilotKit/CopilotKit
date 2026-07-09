"use client";
import { useEffect } from "react";
import useCreditCards from "@/app/actions";
import { setSandboxSnapshot } from "@/opengen/sandbox-functions";

/**
 * Mirrors the app's live (role-filtered) view into the OGUI sandbox snapshot so
 * the iframe's callbacks return the exact data the user sees. Renders nothing.
 * `cards` from useCreditCards is already role-scoped, so the iframe inherits the
 * same visibility rules as the dashboard.
 */
export function SandboxDataSync() {
  const { cards, policies, transactions } = useCreditCards();
  useEffect(() => {
    setSandboxSnapshot({ cards, policies, transactions });
  }, [cards, policies, transactions]);
  return null;
}
