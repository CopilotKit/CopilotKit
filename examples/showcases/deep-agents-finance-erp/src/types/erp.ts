export type Currency = "USD" | "EUR" | "GBP";

export interface KPI {
  label: string;
  value: string;
  change: number;
  trend: "up" | "down" | "flat";
  icon: string;
}

export interface Invoice {
  id: string;
  number: string;
  client: string;
  amount: number;
  currency: Currency;
  status: "paid" | "pending" | "overdue" | "draft";
  issuedDate: string;
  dueDate: string;
  items: InvoiceItem[];
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Account {
  id: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  balance: number;
  currency: Currency;
  code: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  category: string;
  accountCode: string;
  status: "completed" | "pending" | "failed";
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorderLevel: number;
  unitCost: number;
  location: string;
  status: "in-stock" | "low-stock" | "out-of-stock";
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  startDate: string;
  status: "active" | "on-leave" | "terminated";
  salary: number;
  avatar: string;
}

export interface RevenueDataPoint {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface ExpenseBreakdown {
  category: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface QuarterlyDataPoint {
  quarter: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface CashFlowDataPoint {
  quarter: string;
  operating: number;
  investing: number;
  financing: number;
  net: number;
}

export interface ARAgingData {
  current: number;
  thirtyDay: number;
  sixtyDay: number;
  ninetyPlus: number;
  total: number;
  collectionRate: number;
}

export interface BudgetVsActual {
  category: string;
  budget: number;
  actual: number;
  variance: number;
}

export interface MonthlyExpenseByCategory {
  month: string;
  payroll: number;
  operations: number;
  marketing: number;
  infrastructure: number;
  rnd: number;
  other: number;
}
