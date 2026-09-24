import { assertSameOrigin, userFromRequest } from "@/lib/auth";
import { cancelOrder, updateOrder } from "@/lib/domain";
import { errorResponse, field, orderInput } from "@/lib/form";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = userFromRequest(request);
    if (!user)
      return Response.json({ error: "Sign in required" }, { status: 401 });
    const { id } = await context.params;
    const data = await request.formData();
    const version = Number(field(data, "version"));
    const key = field(data, "operationKey");
    if (!Number.isInteger(version) || version < 1)
      return Response.json({ error: "Invalid order version" }, { status: 400 });
    const action = field(data, "action");
    const result =
      action === "cancel"
        ? cancelOrder(user, id, version, key)
        : action === "update"
          ? updateOrder(user, id, version, orderInput(data), key)
          : null;
    if (!result)
      return Response.json({ error: "Unknown action" }, { status: 400 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
