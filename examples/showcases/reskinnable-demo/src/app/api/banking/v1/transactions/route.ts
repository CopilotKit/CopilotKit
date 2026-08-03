import * as store from "@/skins/banking/data/store";

// Get all transactions
export const GET = async () => {
  return new Response(JSON.stringify(store.transactions()), { status: 200 });
};
