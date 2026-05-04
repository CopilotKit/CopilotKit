export enum CardBrand {
  Visa = "Visa",
  MasterCard = "MasterCard",
}

export const CARD_COLORS = {
  [CardBrand.Visa]: "bg-blue-500",
  [CardBrand.MasterCard]: "bg-red-500",
};

export interface Card {
  id: string;
  last4: string;
  expiry: string;
  type: CardBrand;
  color: string;
  pin: string;
  expensePolicyId?: string;
}

export enum MemberRole {
  Admin = "Admin",
  Assistant = "Assistant",
  Member = "Member",
}

export enum ExpenseRole {
  Marketing = "Marketing",
  Engineering = "Engineering",
  Executive = "Executive",
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  team: ExpenseRole;
}

export interface ExpensePolicy {
  id: string;
  type: ExpenseRole;
  limit: number;
  spent: number;
}

export interface TransactionNote {
  content: string;
  userId: string;
  date: string;
}

export interface Transaction {
  id: string;
  title: string;
  note?: TransactionNote;
  amount: number;
  date: string;
  policyId: string;
  cardId: string;
  status: "pending" | "denied" | "approved";
}

export interface NewCardRequest {
  type: CardBrand;
  color: string;
  pin: string;
}

export function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15);
}

export const data: {
  cards: Card[];
  team: Member[];
  policies: ExpensePolicy[];
  transactions: Transaction[];
} = {
  cards: [
    {
      id: "5tf3rmlcyg3",
      last4: "4242",
      expiry: "12/24",
      type: CardBrand.Visa,
      color: CARD_COLORS[CardBrand.Visa],
      pin: "1234",
      expensePolicyId: "8r5c3m4n5o",
    },
    {
      id: "wr197z5ilg",
      last4: "1234",
      expiry: "10/25",
      type: CardBrand.MasterCard,
      color: CARD_COLORS[CardBrand.MasterCard],
      pin: "5678",
      expensePolicyId: "7f3b3c4d5e",
    },
    {
      id: "fA5b7c6d5e",
      last4: "5555",
      expiry: "01/26",
      type: CardBrand.Visa,
      color: CARD_COLORS[CardBrand.Visa],
      pin: "9101",
      expensePolicyId: "9a8b7c6d5e",
    },
  ],
  policies: [
    { id: "7f3b3c4d5e", type: ExpenseRole.Marketing, limit: 5000, spent: 500 },
    {
      id: "8r5c3m4n5o",
      type: ExpenseRole.Executive,
      limit: 10000,
      spent: 1000,
    },
    {
      id: "9a8b7c6d5e",
      type: ExpenseRole.Engineering,
      limit: 15000,
      spent: 1500,
    },
  ],
  team: [
    {
      id: "9g5h2j1k4l",
      name: "John Doe",
      email: "john@example.com",
      role: MemberRole.Admin,
      team: ExpenseRole.Executive,
    },
    {
      id: "1a2b3c4d5e",
      name: "Jane Smith",
      email: "jane@example.com",
      role: MemberRole.Admin,
      team: ExpenseRole.Marketing,
    },
    {
      id: "2b3c4d5e6f",
      name: "Eve Miller",
      email: "eve@example.com",
      role: MemberRole.Assistant,
      team: ExpenseRole.Executive,
    },
    {
      id: "3b3b5f6d1b",
      name: "David Williams",
      email: "david@example.com",
      role: MemberRole.Member,
      team: ExpenseRole.Marketing,
    },
    {
      id: "7g5h2j1k4l",
      name: "Bob Johnson",
      email: "bob@example.com",
      role: MemberRole.Member,
      team: ExpenseRole.Engineering,
    },
  ],
  transactions: [
    {
      id: "t-1",
      title: "Google Ads",
      amount: -5000,
      date: "2023-06-01",
      policyId: "7f3b3c4d5e",
      cardId: "wr197z5ilg",
      status: "pending",
    },
    {
      id: "t-2",
      title: "AWS",
      amount: -10000,
      date: "2023-05-28",
      policyId: "9a8b7c6d5e",
      cardId: "fA5b7c6d5e",
      status: "pending",
    },
    {
      id: "t-3",
      title: "Microsoft 365",
      amount: -1000,
      date: "2023-05-26",
      policyId: "8r5c3m4n5o",
      cardId: "5tf3rmlcyg3",
      status: "pending",
    },
    {
      id: "t-4",
      title: "Delta Airlines",
      amount: -89.99,
      date: "2023-05-25",
      policyId: "8r5c3m4n5o",
      cardId: "5tf3rmlcyg3",
      note: {
        content: "SF Executive Offsite",
        userId: "9g5h2j1k4l",
        date: "2023-06-25",
      },
      status: "approved",
    },
  ],
};
