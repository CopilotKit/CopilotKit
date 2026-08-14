import * as store from "@/skins/commerce/data/store";
import { errorResponse } from "@/skins/commerce/data/http";

export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    return Response.json(store.declinePromotion(id), { status: 200 });
  } catch (error) {
    return errorResponse(error, "POST promotions/[id]/decline");
  }
};
