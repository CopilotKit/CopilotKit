import { client } from "../Client/client";

export async function getPRDataService() {
  const config = {
    method: "POST",
    url: "/api/getPRdata",
  };
  const res = await client(config);
  return res;
}

export async function getTestsService() {
  const config = {
    method: "POST",
    url: "/api/getTests",
  };
  const res = await client(config);
  return res;
}
