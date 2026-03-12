import { Card, Transaction } from "@/app/api/v1/data";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function randomDigits(digitsAmount: number): number {
  const min = Math.pow(10, digitsAmount - 1);
  const max = Math.pow(10, digitsAmount) - 1;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function filterTransactionsByCardLast4(transactions: Transaction[], cards: Card[], card4Digits: string): Transaction[] {
  const card = cards.find(c => c.last4 === card4Digits);
  return transactions.filter(transaction => transaction.cardId === card?.id);
}

export function filterTransactionsByPolicyId(transactions: Transaction[], policyId: string): Transaction[] {
  return transactions.filter(transaction => transaction.policyId === policyId);
}

export function filterTransactionByTitle(transactions: Transaction[], title: string): Transaction[] {
  return transactions.filter(transaction => transaction.title === title);
}
