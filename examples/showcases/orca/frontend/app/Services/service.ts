import { client } from "../Client/client";

export async function getPRDataService() {
  const config = {
    method: "POST",
    url: "/api/getPRdata",
  };
  const res = await client(config);
  return res;
}
