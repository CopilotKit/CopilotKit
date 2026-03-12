'use client'
import { NewCardRequest, Card as ICard, ExpensePolicy, MemberRole, Transaction } from "@/app/api/v1/data";
import { randomDigits } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useAuthContext } from "@/components/auth-context";
import {useCopilotReadable} from "@copilotkit/react-core";

export default function useCreditCards() {
    const [cards, setCards] = useState<ICard[]>([]);
    const [policies, setPolicies] = useState<ExpensePolicy[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const { currentUser } = useAuthContext()

    const changePin = async ({ cardId, pin }: { cardId: string, pin: string }) => {
        try {
            const response = await fetch(`/api/v1/cards/${cardId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pin }),
            });
            if (!response.ok) {
                throw new Error('Failed to change PIN');
            }
            return response.json();
        } catch (error) {
            console.error('Error changing PIN:', error);
        }
    }

    const fetchCards = async () => {
        try {
            const response = await fetch('/api/v1/cards');
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            setCards(data);
        } catch (error) {
            console.error('There was a problem with the fetch operation:', error);
        }
    };

    const fetchPolicies = async () => {
        try {
            const response = await fetch('/api/v1/policies');
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            setPolicies(data);
        } catch (error) {
            console.error('There was a problem with the fetch operation:', error);
        }
    };

    const fetchTransactions = async () => {
        try {
            const response = await fetch('/api/v1/transactions');
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            setTransactions(data);
        } catch (error) {
            console.error('There was a problem with the fetch operation:', error);
        }
    };

    useEffect(() => {
        void fetchCards();
        void fetchPolicies();
        void fetchTransactions();
    }, []);

    const addNewCard = async ({ type, color, pin }: NewCardRequest) => {
        const reqBody = {
            // random 4 digits
            last4: randomDigits(4).toString(),
            // 5 years from now in format MM/YY
            expiry: new Date(new Date().setFullYear(new Date().getFullYear() + 5)).toISOString().split('-')[1] + '/' + new Date().toISOString().split('-')[0].substring(2),
            type: type,
            color: color,
            pin: pin,
        }
        try {
            const response = await fetch('/api/v1/cards', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reqBody),
            });
            if (!response.ok) {
                throw new Error('Failed to add new card');
            }
            void fetchCards()
            return response.json();
        } catch (error) {
            console.error('Error adding new card:', error);
        }
    };

    const assignPolicyToCard = async ({ policyId, cardId }: { policyId: string, cardId: string }) => {
        try {
            const response = await fetch(`/api/v1/cards/${cardId}/policy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ policyId }),
            });
            if (!response.ok) {
                throw new Error('Failed to assign policy');
            }
            void fetchCards()
            return response.json();
        } catch (error) {
            console.error('Error assigning policy:', error);
        }
    };

    const addNoteToTransaction = async ({ transactionId, content }: { transactionId: string, content: string }) => {
        const reqBody = {
            content,
            userId: currentUser.id,
        }
        try {
            const response = await fetch(`/api/v1/transactions/${transactionId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reqBody),
            });
            if (!response.ok) {
                throw new Error('Failed to add new card');
            }
            void fetchTransactions()
            return response.json();
        } catch (error) {
            console.error('Error adding new card:', error);
        }
    };

    const changeTransactionStatus = async ({ id, status }: { id: string, status: 'pending' | 'approved' | 'denied' }) => {
        try {
            const response = await fetch(`/api/v1/transactions/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status }),
            });
            if (!response.ok) {
                throw new Error('Failed to change transaction status');
            }
            void fetchTransactions()
            return response.json();
        } catch (error) {
            console.error('Error changing transaction status:', error);
        }
    };

    // Provide the cards data to our copilot
    // This readable is set up here because the `useCards` hook is also used in the dashboard
    // So the cards information is available in both cards and dashboard pages.
    useCopilotReadable({
        description: 'The available credit cards, possible expense policies and transactions',
        value: {cards, policies, transactions},
    });

    return {
        cards: currentUser.role === MemberRole.Admin ? cards : cards.filter(card => {
            const policy = policies.find(policy => policy.id === card.expensePolicyId);
            return policy?.type === currentUser.team
        }),
        policies,
        transactions,
        changePin,
        addNewCard,
        addNoteToTransaction,
        assignPolicyToCard,
        changeTransactionStatus,
    }
}