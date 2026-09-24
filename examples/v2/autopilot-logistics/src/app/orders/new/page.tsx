import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listUsers } from "@/lib/db";
import { OrderForm } from "@/components/OrderForm";

export default async function NewOrderPage() {
  const user = await requireUser();
  const operators = listUsers(user)
    .filter((person) => person.role === "operator" || person.role === "admin")
    .map((person) => ({ ...person }));
  return (
    <>
      <div className="page-heading">
        <div>
          <small>
            <Link href="/orders">ORDERS</Link> / NEW
          </small>
          <h1>Create order</h1>
          <p>Record a new shipment for {user.organizationName}.</p>
        </div>
      </div>
      <OrderForm operators={operators} role={user.role} />
    </>
  );
}
