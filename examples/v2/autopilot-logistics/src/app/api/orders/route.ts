import { assertSameOrigin, userFromRequest } from "@/lib/auth";
import { createOrder } from "@/lib/domain";
import { errorResponse, field, orderInput } from "@/lib/form";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = userFromRequest(request);
    if (!user)
      return Response.json({ error: "Sign in required" }, { status: 401 });
    const data = await request.formData();
    const result = createOrder(
      user,
      orderInput(data),
      field(data, "operationKey"),
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
