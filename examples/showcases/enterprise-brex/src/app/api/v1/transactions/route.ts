import { data } from "../data";

// Get all transactions
export const GET = async () => {
  return new Response(JSON.stringify(data.transactions), { status: 200 });
};
