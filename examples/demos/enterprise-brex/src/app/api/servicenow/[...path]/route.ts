import type { NextRequest } from "next/server";

// This route serves as a proxy route to reach the service-now endpoints

export const SERVICE_NOW_BASE_URL =
  "https://hexawaretechnologiesincdemo8.service-now.com/api/now";
const encodedCredentials = Buffer.from(
  `${process.env.SERVICENOW_USERNAME}:${process.env.SERVICENOW_PASSWORD}`,
).toString("base64");
export const serviceNowApiHeaders = {
  Authorization: `Basic ${encodedCredentials}`,
  "Content-Type": "application/json",
};

async function handler(req: NextRequest) {
  const { method, url: stringUrl } = req;
  const url = new URL(stringUrl);
  const path = url.pathname.replace(/\/api\/servicenow/, "");
  const query = Object.fromEntries(url.searchParams.entries());

  const urlWithQuery = new URL(`${SERVICE_NOW_BASE_URL}/${path}`);
  Object.entries(query).forEach(([key, value]) =>
    urlWithQuery.searchParams.append(key, value),
  );
  const response = await fetch(urlWithQuery.toString(), {
    method,
    headers: serviceNowApiHeaders,
  });

  if (!response.ok) {
    const error = await response.json();
    console.error(`Error with request: ${JSON.stringify(error)}`);
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const { result } = await response.json();

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export { handler as POST, handler as GET };
