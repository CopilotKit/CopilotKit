import type { CrmStore } from "./store.js";
import type { DealBrief } from "./types.js";

export function buildDealBrief(store: CrmStore, dealId: string): DealBrief {
  const deal = store.getDeal(dealId);
  if (!deal) throw new Error(`deal not found: ${dealId}`);
  const account = store.getAccount(deal.accountId);
  if (!account)
    throw new Error(`account not found for deal ${dealId}: ${deal.accountId}`);
  const contact = store.contactsForAccount(account.id)[0];
  const activities = store
    .activitiesForDeal(dealId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last = activities[0];

  const daysToClose =
    (new Date(deal.closeDate).getTime() - Date.now()) / 86_400_000;
  const closed = deal.stage === "Closed Won" || deal.stage === "Closed Lost";
  let risk: DealBrief["risk"] = "low"; // closed deals carry no open risk
  if (!closed && (deal.probability < 35 || daysToClose < 0)) risk = "high";
  else if (!closed && (deal.probability < 65 || daysToClose < 14))
    risk = "medium";

  const nextStep =
    deal.stage === "Lead"
      ? "Qualify: confirm budget, authority, need, timeline."
      : deal.stage === "Qualified"
        ? "Send a tailored proposal."
        : deal.stage === "Proposal"
          ? "Confirm pricing and start negotiation."
          : deal.stage === "Negotiation"
            ? "Address final blockers and request verbal commit."
            : "No action — deal is closed.";

  return {
    dealId: deal.id,
    dealName: deal.name,
    accountName: account.name,
    stage: deal.stage,
    amount: deal.amount,
    probability: deal.probability,
    keyContact: contact && {
      name: contact.name,
      title: contact.title,
      email: contact.email,
    },
    lastActivity: last && {
      type: last.type,
      body: last.body,
      createdAt: last.createdAt,
    },
    risk,
    nextStep,
  };
}
