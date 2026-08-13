import { publicAeoContract } from "@/lib/public-aeo-contract";

export function GET(): Response {
  return new Response(`${JSON.stringify(publicAeoContract, null, 2)}\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
