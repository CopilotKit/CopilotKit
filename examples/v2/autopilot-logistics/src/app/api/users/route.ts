import { assertSameOrigin, userFromRequest } from "@/lib/auth";
import { manageUser } from "@/lib/domain";
import { errorResponse, field } from "@/lib/form";
import type { Role } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = userFromRequest(request);
    if (!user)
      return Response.json({ error: "Sign in required" }, { status: 401 });
    const data = await request.formData();
    const action = field(data, "action");
    if (action !== "create" && action !== "update" && action !== "deactivate")
      return Response.json({ error: "Unknown action" }, { status: 400 });
    const result = manageUser(
      user,
      action,
      field(data, "id"),
      field(data, "displayName"),
      field(data, "role") as Role,
      field(data, "operationKey"),
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
