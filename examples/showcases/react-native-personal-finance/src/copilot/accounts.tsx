/**
 * CopilotKit human-in-the-loop write tool for ACCOUNTS.
 *
 * Registers `createAccount` via `useHumanInTheLoop` from
 * `@copilotkit/react-native`. When the agent calls `createAccount(args)` the
 * chat renders an <ApprovalCard> summarising the proposed account; the user
 * approves or cancels. Approval commits to the finance store and resolves the
 * tool back to the agent; cancellation resolves with a declined result so the
 * agent can react.
 *
 * Mount <AccountTools /> anywhere inside <CopilotKitProvider> (it renders
 * nothing — it only registers the tool).
 *
 * SDK signatures used (node_modules/@copilotkit/react-native -> re-exported
 * from @copilotkit/react-core/v2/headless):
 *   useHumanInTheLoop<T extends Record<string, unknown>>(
 *     tool: ReactHumanInTheLoop<T>, deps?: ReadonlyArray<unknown>
 *   ): void
 *   ReactHumanInTheLoop<T> = Omit<FrontendTool<T>, "handler"> & {
 *     render: React.ComponentType<
 *       | { status: ToolCallStatus.InProgress; args: Partial<T>; result: undefined; respond: undefined }
 *       | { status: ToolCallStatus.Executing;  args: T;          result: undefined; respond: (r: unknown) => Promise<void> }
 *       | { status: ToolCallStatus.Complete;   args: T;          result: string;    respond: undefined }
 *     >
 *   }
 * ToolCallStatus is an enum re-exported by @copilotkit/react-native as a *type*
 * only, so the runtime enum value is imported from @copilotkit/core.
 */

import { ActivityIndicator, Text, View } from "react-native";
import { z } from "zod";
import { useHumanInTheLoop } from "@copilotkit/react-native";
import { ToolCallStatus } from "@copilotkit/core";

import type { AccountType, CurrencyCode } from "../types";
import { CURRENCIES, formatCurrency } from "../lib/currency";
import { useFinanceStore } from "../store/financeStore";
import { TOOLS } from "./contracts";
import type { CreateAccountArgs } from "./contracts";
import { ApprovalCard } from "./ApprovalCard";

/**
 * The SDK's `useHumanInTheLoop<T>` constrains `T extends Record<string,
 * unknown>`. Our contract interfaces are intentionally index-signature-free,
 * so we widen with an intersection at the call site only — field types stay
 * exactly as declared in contracts.ts.
 */
type CreateAccountToolArgs = CreateAccountArgs & Record<string, unknown>;

// Marker prefix used so the Complete-state render can tell an approval from a
// cancellation by inspecting the (stringified) tool result.
const CANCELLED_RESULT = "cancelled:";

const ACCOUNT_TYPES: AccountType[] = ["cash", "bank", "card", "savings"];
const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [
  CurrencyCode,
  ...CurrencyCode[],
];

/** Zod schema mirroring CreateAccountArgs so the agent emits well-typed args. */
const createAccountSchema = z.object({
  name: z
    .string()
    .describe('Human-friendly account name, e.g. "Chase Checking".'),
  type: z
    .enum(ACCOUNT_TYPES as [AccountType, ...AccountType[]])
    .describe("Account type: cash, bank, card, or savings."),
  currency: z.enum(CURRENCY_CODES).describe("ISO currency code, e.g. USD."),
  balance: z
    .number()
    .optional()
    .describe("Opening balance in the account currency. Defaults to 0."),
  icon: z.string().optional().describe("Optional emoji icon for the account."),
});

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: "Cash",
  bank: "Bank",
  card: "Card",
  savings: "Savings",
};

/** Build the approval rows from the (possibly partial) proposed args. */
function accountRows(args: Partial<CreateAccountArgs>) {
  const currency = (args.currency ?? "USD") as CurrencyCode;
  const opening = args.balance ?? 0;
  return [
    { label: "Name", value: args.name ?? "—" },
    {
      label: "Type",
      value: args.type ? ACCOUNT_TYPE_LABEL[args.type] : "—",
    },
    { label: "Currency", value: currency },
    { label: "Opening balance", value: formatCurrency(opening, currency) },
  ];
}

/**
 * Registers the `createAccount` human-in-the-loop tool. Renders nothing
 * itself; the approval UI is rendered inline by CopilotChat when the tool is
 * called.
 */
export function AccountTools(): null {
  useHumanInTheLoop<CreateAccountToolArgs>({
    name: TOOLS.createAccount,
    description:
      "Create a new financial account. Always requires the user to approve " +
      "the details before the account is created.",
    parameters: createAccountSchema,
    render: ({ status, args, respond, result }) => {
      const rows = accountRows(args);

      if (status === ToolCallStatus.Complete) {
        const cancelled =
          typeof result === "string" && result.startsWith(CANCELLED_RESULT);
        return (
          <ApprovalCard
            emoji={args.icon ?? "🏦"}
            title="Create account"
            rows={rows}
            status={cancelled ? "cancelled" : "approved"}
            onApprove={() => {}}
            onCancel={() => {}}
          />
        );
      }

      if (status === ToolCallStatus.Executing) {
        const onApprove = () => {
          const created = useFinanceStore.getState().createAccount({
            name: args.name,
            type: args.type,
            currency: args.currency,
            balance: args.balance ?? 0,
            icon: args.icon ?? "🏦",
          });
          void respond(
            `Created account "${created.name}" (${created.id}) with opening ` +
              `balance ${formatCurrency(created.balance, created.currency)}.`,
          );
        };
        const onCancel = () => {
          void respond(
            `${CANCELLED_RESULT} user declined to create the account.`,
          );
        };
        return (
          <ApprovalCard
            emoji={args.icon ?? "🏦"}
            title="Create account"
            approveLabel="Create"
            rows={rows}
            status="pending"
            onApprove={onApprove}
            onCancel={onCancel}
          />
        );
      }

      // ToolCallStatus.InProgress — args still streaming in.
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 16,
            marginVertical: 8,
            borderWidth: 1,
            borderColor: "#E2E5EA",
            borderRadius: 16,
            backgroundColor: "#FFFFFF",
          }}
        >
          <ActivityIndicator size="small" color="#6B7280" />
          <Text style={{ marginLeft: 10, fontSize: 14, color: "#6B7280" }}>
            Preparing new account…
          </Text>
        </View>
      );
    },
  });

  return null;
}
