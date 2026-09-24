import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOrder, listUsers } from "@/lib/db";
import { CancelOrder, OrderForm } from "@/components/OrderForm";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const order = getOrder(user, id);
  if (!order) notFound();
  const operators = listUsers(user)
    .filter((person) => person.role === "operator" || person.role === "admin")
    .map((person) => ({ ...person }));
  return (
    <>
      <div className="page-heading">
        <div>
          <small>
            <Link href="/orders">ORDERS</Link> / {order.reference}
          </small>
          <h1>{order.reference}</h1>
          <p>
            {order.customer} · Version {order.version}
          </p>
        </div>
        <span className={`badge ${order.status}`}>
          {order.status.replace("_", " ")}
        </span>
      </div>
      <OrderForm
        key={order.version}
        order={{ ...order }}
        operators={operators}
        role={user.role}
      />
      <CancelOrder
        key={`cancel-${order.version}`}
        order={{ ...order }}
        role={user.role}
      />
    </>
  );
}
