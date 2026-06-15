"use client";
import type {
  NewCardRequest,
  Card as ICard,
  ExpensePolicy,
  Transaction,
  PolicyException,
} from "@/app/api/v1/data";
import { MemberRole } from "@/app/api/v1/data";
import { randomDigits } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useAuthContext } from "@/components/auth-context";

// Cross-instance revalidation bus.
//
// `useCreditCards()` keeps its OWN local state and is called independently by
// several components (the dashboard page, copilot-context where the chat's
// approveTransaction/finalize tools live, page.tsx, …). A mutation made through
// one instance therefore would NOT refresh another — e.g. the agent approving a
// charge in chat (copilot-context's instance) left the dashboard's pending
// table showing the charge as still pending. Each instance registers a
// refetch callback here; every mutation calls `notifyDataChanged()` so ALL live
// instances re-pull from the server and every view reflects the change at once.
const dataChangeListeners = new Set<() => void>();
function notifyDataChanged() {
  for (const listener of dataChangeListeners) listener();
}

export default function useCreditCards() {
  const [cards, setCards] = useState<ICard[]>([]);
  const [policies, setPolicies] = useState<ExpensePolicy[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const { currentUser } = useAuthContext();

  const changePin = async ({
    cardId,
    pin,
  }: {
    cardId: string;
    pin: string;
  }) => {
    try {
      const response = await fetch(`/api/v1/cards/${cardId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        throw new Error("Failed to change PIN");
      }
      return response.json();
    } catch (error) {
      console.error("Error changing PIN:", error);
    }
  };

  const fetchCards = async () => {
    try {
      const response = await fetch("/api/v1/cards");
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();
      setCards(data);
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  const fetchPolicies = async () => {
    try {
      const response = await fetch("/api/v1/policies");
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();
      setPolicies(data);
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  const fetchTransactions = async () => {
    try {
      const response = await fetch("/api/v1/transactions");
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();
      setTransactions(data);
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  useEffect(() => {
    const refetchAll = () => {
      void Promise.all([fetchCards(), fetchPolicies(), fetchTransactions()]);
    };
    refetchAll();
    // Refresh this instance whenever ANY instance reports a mutation, so the
    // dashboard reflects chat-driven approvals (and vice-versa) immediately.
    dataChangeListeners.add(refetchAll);
    return () => {
      dataChangeListeners.delete(refetchAll);
    };
  }, []);

  const addNewCard = async ({ type, color, pin }: NewCardRequest) => {
    const reqBody = {
      // random 4 digits
      last4: randomDigits(4).toString(),
      // 5 years from now in format MM/YY
      expiry:
        new Date(new Date().setFullYear(new Date().getFullYear() + 5))
          .toISOString()
          .split("-")[1] +
        "/" +
        new Date().toISOString().split("-")[0].slice(2),
      type: type,
      color: color,
      pin: pin,
    };
    try {
      const response = await fetch("/api/v1/cards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });
      if (!response.ok) {
        throw new Error("Failed to add new card");
      }
      notifyDataChanged();
      return response.json();
    } catch (error) {
      console.error("Error adding new card:", error);
    }
  };

  const assignPolicyToCard = async ({
    policyId,
    cardId,
  }: {
    policyId: string;
    cardId: string;
  }) => {
    try {
      const response = await fetch(`/api/v1/cards/${cardId}/policy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ policyId }),
      });
      if (!response.ok) {
        throw new Error("Failed to assign policy");
      }
      notifyDataChanged();
      return response.json();
    } catch (error) {
      console.error("Error assigning policy:", error);
    }
  };

  const addNoteToTransaction = async ({
    transactionId,
    content,
  }: {
    transactionId: string;
    content: string;
  }) => {
    const reqBody = {
      content,
      userId: currentUser.id,
    };
    try {
      const response = await fetch(`/api/v1/transactions/${transactionId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });
      if (!response.ok) {
        throw new Error("Failed to add new card");
      }
      notifyDataChanged();
      return response.json();
    } catch (error) {
      console.error("Error adding new card:", error);
    }
  };

  const changeTransactionStatus = async ({
    id,
    status,
  }: {
    id: string;
    status: "pending" | "approved" | "denied";
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await fetch(`/api/v1/transactions/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      // Always refresh from the server so the UI reflects the real state
      // whether the write succeeded or was rejected (e.g. the over-limit gate).
      notifyDataChanged();
      if (!response.ok) {
        // Surface the server's symptom-only message (e.g. "<team> policy limit
        // exceeded") so the agent + UI can learn the failure instead of
        // silently reporting a false success.
        const body = await response.json().catch(() => null);
        return {
          ok: false,
          error: body?.message ?? "Failed to change transaction status",
        };
      }
      return { ok: true };
    } catch (error) {
      console.error("Error changing transaction status:", error);
      return { ok: false, error: "Network error" };
    }
  };

  const openPolicyException = async ({
    transactionId,
    code,
  }: {
    transactionId: string;
    code: string;
  }): Promise<{ ok: boolean; data?: PolicyException; error?: string }> => {
    try {
      const response = await fetch("/api/v1/exceptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transactionId, code }),
      });
      const body = await response.json().catch(() => null);
      notifyDataChanged();
      if (!response.ok) {
        return {
          ok: false,
          error: body?.message ?? "Failed to open policy exception",
        };
      }
      return { ok: true, data: body as PolicyException };
    } catch (error) {
      console.error("Error opening policy exception:", error);
      return { ok: false, error: "Network error" };
    }
  };

  const finalizePolicyException = async ({
    exceptionId,
  }: {
    exceptionId: string;
  }): Promise<{ ok: boolean; data?: PolicyException; error?: string }> => {
    try {
      const response = await fetch(
        `/api/v1/exceptions/${exceptionId}/finalize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      const body = await response.json().catch(() => null);
      notifyDataChanged();
      if (!response.ok) {
        return {
          ok: false,
          error: body?.message ?? "Failed to finalize policy exception",
        };
      }
      return { ok: true, data: body as PolicyException };
    } catch (error) {
      console.error("Error finalizing policy exception:", error);
      return { ok: false, error: "Network error" };
    }
  };

  return {
    cards:
      currentUser.role === MemberRole.Admin
        ? cards
        : cards.filter((card) => {
            const policy = policies.find(
              (policy) => policy.id === card.expensePolicyId,
            );
            return policy?.type === currentUser.team;
          }),
    policies,
    transactions,
    changePin,
    addNewCard,
    addNoteToTransaction,
    assignPolicyToCard,
    changeTransactionStatus,
    openPolicyException,
    finalizePolicyException,
  };
}
