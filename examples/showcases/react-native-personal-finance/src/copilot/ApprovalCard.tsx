/**
 * Reusable, purely presentational approval card.
 *
 * Used by every human-in-the-loop flow (add transaction, set budget, confirm
 * a parsed receipt, ...). It holds NO business logic — it renders the rows it
 * is given and calls back on Approve / Edit / Cancel. Resolution state
 * (approved / cancelled) is driven entirely by the `status` prop.
 */

import { Text, TouchableOpacity, View } from "react-native";

export interface ApprovalRow {
  label: string;
  value: string;
}

export interface ApprovalCardProps {
  emoji?: string;
  title: string;
  rows: ApprovalRow[];
  approveLabel?: string;
  onApprove: () => void;
  onEdit?: () => void;
  onCancel: () => void;
  status?: "pending" | "approved" | "cancelled";
  /** Optional headline override for the resolved banner (e.g. "Added expense"). */
  resolvedLabel?: string;
  /** Optional muted second line in the resolved banner, e.g. the new balance. */
  resolvedDetail?: string;
}

export function ApprovalCard({
  emoji,
  title,
  rows,
  approveLabel = "Approve",
  onApprove,
  onEdit,
  onCancel,
  status = "pending",
  resolvedLabel,
  resolvedDetail,
}: ApprovalCardProps) {
  const resolved = status === "approved" || status === "cancelled";

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#E2E5EA",
        borderRadius: 16,
        backgroundColor: "#FFFFFF",
        padding: 16,
        marginVertical: 8,
        shadowColor: "#000000",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      {/* Header */}
      <View
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}
      >
        {emoji ? (
          <Text style={{ fontSize: 22, marginRight: 8 }}>{emoji}</Text>
        ) : null}
        <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1D21" }}>
          {title}
        </Text>
      </View>

      {/* Rows */}
      <View style={{ marginBottom: resolved ? 12 : 16 }}>
        {rows.map((row, i) => (
          <View
            key={`${row.label}-${i}`}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              paddingVertical: 6,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: "#F0F2F5",
            }}
          >
            <Text style={{ fontSize: 14, color: "#6B7280", marginRight: 12 }}>
              {row.label}
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: "#1A1D21",
                flexShrink: 1,
                textAlign: "right",
              }}
            >
              {row.value}
            </Text>
          </View>
        ))}
      </View>

      {resolved ? (
        <ResolvedBanner
          status={status}
          label={resolvedLabel}
          detail={resolvedDetail}
        />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity
            onPress={onApprove}
            style={{
              flex: 1,
              backgroundColor: "#16A34A",
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
              {approveLabel}
            </Text>
          </TouchableOpacity>

          {onEdit ? (
            <TouchableOpacity
              onPress={onEdit}
              style={{
                marginLeft: 8,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#D1D5DB",
                alignItems: "center",
              }}
            >
              <Text
                style={{ color: "#374151", fontWeight: "600", fontSize: 14 }}
              >
                Edit
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={onCancel}
            style={{
              marginLeft: 8,
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#FCA5A5",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 14 }}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function ResolvedBanner({
  status,
  label,
  detail,
}: {
  status: "approved" | "cancelled";
  label?: string;
  detail?: string;
}) {
  const approved = status === "approved";
  const headline = label ?? (approved ? "Approved" : "Cancelled");
  const accent = approved ? "#15803D" : "#B91C1C";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: detail ? "flex-start" : "center",
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: approved ? "#ECFDF5" : "#FEF2F2",
      }}
    >
      <Text style={{ fontSize: 16, marginRight: 6 }}>
        {approved ? "✅" : "✕"}
      </Text>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: accent }}>
          {headline}
        </Text>
        {detail ? (
          <Text
            style={{
              fontSize: 13,
              color: accent,
              opacity: 0.85,
              marginTop: 2,
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
