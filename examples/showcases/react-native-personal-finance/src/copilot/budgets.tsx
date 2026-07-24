/**
 * CopilotKit human-in-the-loop write tools for BUDGETS.
 *
 * Registers TWO tools via `useHumanInTheLoop` from `@copilotkit/react-native`:
 *   - `setBudget`  — create / upsert a monthly category budget.
 *   - `editBudget` — change an existing budget's limit/currency, shown as a
 *                    BEFORE → AFTER diff so the user can see exactly what
 *                    changes before approving.
 *
 * Mount <BudgetTools /> anywhere inside <CopilotKitProvider> alongside
 * <AccountTools /> — each call registers independent tools and renders nothing
 * itself; the approval UI is rendered inline by CopilotChat per tool call.
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

import type { Budget, CurrencyCode } from "../types";
import { CURRENCIES, formatCurrency } from "../lib/currency";
import { useFinanceStore } from "../store/financeStore";
import { TOOLS } from "./contracts";
import type { EditBudgetArgs, SetBudgetArgs } from "./contracts";
import { ApprovalCard } from "./ApprovalCard";
import type { ApprovalRow } from "./ApprovalCard";

/**
 * The SDK's `useHumanInTheLoop<T>` constrains `T extends Record<string,
 * unknown>`. Our contract interfaces are intentionally index-signature-free,
 * so we widen with an intersection at the call site only — field types stay
 * exactly as declared in contracts.ts.
 */
type SetBudgetToolArgs = SetBudgetArgs & Record<string, unknown>;
type EditBudgetToolArgs = EditBudgetArgs & Record<string, unknown>;

// Marker prefix so the Complete-state render can distinguish an approval from
// a cancellation by inspecting the (stringified) tool result.
const CANCELLED_RESULT = "cancelled:";

const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [
  CurrencyCode,
  ...CurrencyCode[],
];

/** Zod schema mirroring SetBudgetArgs. */
const setBudgetSchema = z.object({
  category: z
    .string()
    .describe('Budget category name, e.g. "Groceries". Matches a category.'),
  limit: z.number().describe("Spending limit for the period, in the currency."),
  currency: z.enum(CURRENCY_CODES).describe("ISO currency code, e.g. USD."),
  period: z
    .literal("monthly")
    .optional()
    .describe('Budget period. Only "monthly" is supported today.'),
});

/** Zod schema mirroring EditBudgetArgs. */
const editBudgetSchema = z.object({
  id: z
    .string()
    .optional()
    .describe("Target budget id when known (preferred)."),
  category: z
    .string()
    .optional()
    .describe("Target budget by category name when the id is unknown."),
  limit: z.number().optional().describe("New spending limit."),
  currency: z
    .enum(CURRENCY_CODES)
    .optional()
    .describe("New ISO currency code."),
});

/** Resolve the budget an edit targets: prefer id, fall back to category. */
function findTargetBudget(args: Partial<EditBudgetArgs>): Budget | undefined {
  const { budgets } = useFinanceStore.getState();
  if (args.id) {
    const byId = budgets.find((b) => b.id === args.id);
    if (byId) return byId;
  }
  if (args.category) {
    return budgets.find(
      (b) => b.category.toLowerCase() === args.category!.toLowerCase(),
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// setBudget
// ---------------------------------------------------------------------------

function setBudgetRows(args: Partial<SetBudgetArgs>): ApprovalRow[] {
  const currency = (args.currency ?? "USD") as CurrencyCode;
  const limit = args.limit ?? 0;
  return [
    { label: "Category", value: args.category ?? "—" },
    { label: "Limit", value: formatCurrency(limit, currency) },
    { label: "Period", value: args.period ?? "monthly" },
    { label: "Currency", value: currency },
  ];
}

function useSetBudgetTool(): void {
  useHumanInTheLoop<SetBudgetToolArgs>({
    name: TOOLS.setBudget,
    description:
      "Create or update a monthly budget for a spending category. Requires " +
      "the user to approve the budget before it is saved.",
    parameters: setBudgetSchema,
    render: ({ status, args, respond, result }) => {
      const rows = setBudgetRows(args);

      if (status === ToolCallStatus.Complete) {
        const cancelled =
          typeof result === "string" && result.startsWith(CANCELLED_RESULT);
        return (
          <ApprovalCard
            emoji="🎯"
            title="Set budget"
            rows={rows}
            status={cancelled ? "cancelled" : "approved"}
            onApprove={() => {}}
            onCancel={() => {}}
          />
        );
      }

      if (status === ToolCallStatus.Executing) {
        const onApprove = () => {
          const saved = useFinanceStore.getState().setBudget({
            category: args.category,
            limit: args.limit,
            currency: args.currency,
            period: args.period ?? "monthly",
          });
          void respond(
            `Set ${saved.period} budget for "${saved.category}" to ` +
              `${formatCurrency(saved.limit, saved.currency)} (${saved.id}).`,
          );
        };
        const onCancel = () => {
          void respond(`${CANCELLED_RESULT} user declined to set the budget.`);
        };
        return (
          <ApprovalCard
            emoji="🎯"
            title="Set budget"
            approveLabel="Save"
            rows={rows}
            status="pending"
            onApprove={onApprove}
            onCancel={onCancel}
          />
        );
      }

      return <PreparingCard label="Preparing budget…" />;
    },
  });
}

// ---------------------------------------------------------------------------
// editBudget — BEFORE -> AFTER diff
// ---------------------------------------------------------------------------

/**
 * Build diff rows comparing the current budget with the proposed patch.
 * Only fields actually changing are shown as "old → new"; unchanged fields
 * are shown as a single value for context.
 */
function editBudgetRows(
  current: Budget | undefined,
  args: Partial<EditBudgetArgs>,
): ApprovalRow[] {
  if (!current) {
    // Target couldn't be resolved — surface what the agent asked for so the
    // user understands why nothing can be changed.
    const currency = (args.currency ?? "USD") as CurrencyCode;
    return [
      { label: "Target", value: args.category ?? args.id ?? "—" },
      {
        label: "New limit",
        value: args.limit != null ? formatCurrency(args.limit, currency) : "—",
      },
      { label: "Status", value: "No matching budget found" },
    ];
  }

  const newCurrency = (args.currency ?? current.currency) as CurrencyCode;
  const newLimit = args.limit ?? current.limit;

  const rows: ApprovalRow[] = [{ label: "Category", value: current.category }];

  const limitChanged = newLimit !== current.limit;
  rows.push({
    label: "Limit",
    value: limitChanged
      ? `${formatCurrency(current.limit, current.currency)} → ${formatCurrency(
          newLimit,
          newCurrency,
        )}`
      : formatCurrency(current.limit, current.currency),
  });

  const currencyChanged = newCurrency !== current.currency;
  if (currencyChanged) {
    rows.push({
      label: "Currency",
      value: `${current.currency} → ${newCurrency}`,
    });
  } else {
    rows.push({ label: "Currency", value: current.currency });
  }

  return rows;
}

function useEditBudgetTool(): void {
  useHumanInTheLoop<EditBudgetToolArgs>({
    name: TOOLS.editBudget,
    description:
      "Edit an existing budget (change its limit and/or currency), targeting " +
      "it by id or category. Shows a before/after diff and requires the user " +
      "to approve the change before it is applied.",
    parameters: editBudgetSchema,
    render: ({ status, args, respond, result }) => {
      const current = findTargetBudget(args);
      const rows = editBudgetRows(current, args);

      if (status === ToolCallStatus.Complete) {
        const cancelled =
          typeof result === "string" && result.startsWith(CANCELLED_RESULT);
        return (
          <ApprovalCard
            emoji="✏️"
            title="Edit budget"
            rows={rows}
            status={cancelled ? "cancelled" : "approved"}
            onApprove={() => {}}
            onCancel={() => {}}
          />
        );
      }

      if (status === ToolCallStatus.Executing) {
        const onApprove = () => {
          if (!current) {
            void respond(
              `${CANCELLED_RESULT} no budget matched ` +
                `${args.category ?? args.id ?? "the request"}; nothing changed.`,
            );
            return;
          }
          const patch: Partial<Omit<Budget, "id">> = {};
          if (args.limit != null) patch.limit = args.limit;
          if (args.currency != null) patch.currency = args.currency;
          const updated = useFinanceStore
            .getState()
            .editBudget(current.id, patch);
          if (!updated) {
            void respond(
              `${CANCELLED_RESULT} budget ${current.id} could not be updated.`,
            );
            return;
          }
          void respond(
            `Updated budget for "${updated.category}" (${updated.id}): limit ` +
              `now ${formatCurrency(updated.limit, updated.currency)}.`,
          );
        };
        const onCancel = () => {
          void respond(`${CANCELLED_RESULT} user declined to edit the budget.`);
        };
        return (
          <ApprovalCard
            emoji="✏️"
            title="Edit budget"
            approveLabel="Apply"
            rows={rows}
            status="pending"
            onApprove={onApprove}
            onCancel={onCancel}
          />
        );
      }

      return <PreparingCard label="Preparing budget change…" />;
    },
  });
}

// ---------------------------------------------------------------------------

function PreparingCard({ label }: { label: string }) {
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
        {label}
      </Text>
    </View>
  );
}

/**
 * Registers both budget human-in-the-loop tools (`setBudget` + `editBudget`).
 * Renders nothing; mount alongside <AccountTools /> under CopilotKitProvider.
 */
export function BudgetTools(): null {
  useSetBudgetTool();
  useEditBudgetTool();
  return null;
}
