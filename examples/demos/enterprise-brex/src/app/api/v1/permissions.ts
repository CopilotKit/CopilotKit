import { MemberRole } from "@/app/api/v1/data";

const AdminAndAssistants = [MemberRole.Admin, MemberRole.Assistant];
const All = [MemberRole.Admin, MemberRole.Assistant, MemberRole.Member];
const AdminOnly = [MemberRole.Admin];

export const PERMISSIONS = {
  ADD_CARD: AdminOnly,
  ADD_POLICY: AdminAndAssistants,
  ADD_NOTE: All,
  SHOW_TRANSACTIONS: All,
  SET_PIN: All,
  APPROVE_TRANSACTION: AdminAndAssistants,
  READ_MSA: AdminOnly,
};
