import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listOrders, listUsers } from "@/lib/db";

export default async function Dashboard() {
  const user = await requireUser();
  const orders = listOrders(user);
  const active = orders.filter(
    (order) => order.status !== "cancelled" && order.status !== "delivered",
  );
  const users = listUsers(user);
  return (
    <>
      <div className="page-heading">
        <div>
          <small>OVERVIEW</small>
          <h1>Dashboard</h1>
          <p>Keep shipments moving across your workspace.</p>
        </div>
        <Link className="button primary" href="/orders/new">
          Create order
        </Link>
      </div>
      <div className="stats">
        <div>
          <span>Orders</span>
          <strong>{orders.length}</strong>
        </div>
        <div>
          <span>Active shipments</span>
          <strong>{active.length}</strong>
        </div>
        <div>
          <span>Team members</span>
          <strong>{users.filter((member) => member.active).length}</strong>
        </div>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>Recent orders</h2>
          <Link href="/orders">View all</Link>
        </div>
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Customer</th>
              <th>Destination</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 6).map((order) => (
              <tr key={order.id}>
                <td>
                  <Link href={`/orders/${order.id}`}>{order.reference}</Link>
                </td>
                <td>{order.customer}</td>
                <td>{order.destination}</td>
                <td>
                  <span className={`badge ${order.status}`}>
                    {order.status.replace("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
