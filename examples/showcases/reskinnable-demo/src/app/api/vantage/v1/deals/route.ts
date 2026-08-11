import * as store from "@/skins/vantage/data/store";

export const GET = async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const region = params.get("region");
  const minValue = Number(params.get("minValue") ?? 0);
  const deals = store
    .deals()
    .filter((d) => (status ? d.status === status : true))
    .filter((d) => (region ? d.region === region : true))
    .filter((d) => d.valueUsd >= (Number.isFinite(minValue) ? minValue : 0))
    .sort((a, b) => b.valueUsd - a.valueUsd);
  return Response.json({ deals });
};
