import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listOrders } from "@/lib/db";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const orders = listOrders(user, q);
  return (
    <>
      <div className="page-heading">
        <div>
          <small>SHIPMENTS</small>
          <h1>Orders</h1>
          <p>Search and manage your organization's orders.</p>
        </div>
        {user.role !== "viewer" && (
          <Link className="button primary" href="/orders/new">
            Create order
          </Link>
        )}
      </div>
      <form className="search-form" action="/orders">
        <label htmlFor="order-search">Search orders</label>
        <div>
          <input
            id="order-search"
            name="q"
            defaultValue={q}
            placeholder="Reference, customer, destination"
          />
          <button className="button" type="submit">
            Search
          </button>
        </div>
      </form>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Customer</th>
              <th>Destination</th>
              <th>Ship date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <Link href={`/orders/${order.id}`}>{order.reference}</Link>
                </td>
                <td>{order.customer}</td>
                <td>{order.destination}</td>
                <td>{order.ship_date}</td>
                <td>
                  <span className={`badge ${order.status}`}>
                    {order.status.replace("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <p>No orders match this search.</p>}
      </section>
    </>
  );
}
