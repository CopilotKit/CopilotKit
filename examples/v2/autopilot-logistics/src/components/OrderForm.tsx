"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import type { Order, Role } from "@/lib/db";

type Operator = { id: string; display_name: string; active: number };

export function OrderForm({
  order,
  operators,
  role,
}: {
  order?: Order;
  operators: Operator[];
  role: Role;
}) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const editable =
    role !== "viewer" &&
    order?.status !== "cancelled" &&
    order?.status !== "delivered";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        order ? `/api/orders/${order.id}` : "/api/orders",
        { method: "POST", body: data },
      );
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Order could not be saved");
      setKey(crypto.randomUUID());
      if (!order) router.push(`/orders/${result.id}`);
      else router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Order could not be saved",
      );
    } finally {
      setPending(false);
    }
  }

  if (!editable)
    return <p>This order is read-only for your account or its final status.</p>;

  return (
    <form
      className="editor card"
      onSubmit={submit}
      aria-label={order ? `Edit order ${order.reference}` : "Create order"}
    >
      <input type="hidden" name="operationKey" value={key} />
      {order && (
        <>
          <input type="hidden" name="version" value={order.version} />
          <input type="hidden" name="action" value="update" />
        </>
      )}
      <div className="form-grid">
        <label>
          Customer{" "}
          <input
            required
            maxLength={160}
            name="customer"
            defaultValue={order?.customer}
          />
        </label>
        <label>
          Requested ship date{" "}
          <input
            required
            type="date"
            name="shipDate"
            defaultValue={order?.ship_date}
          />
        </label>
        <label>
          Origin{" "}
          <input
            required
            maxLength={160}
            name="origin"
            defaultValue={order?.origin}
          />
        </label>
        <label>
          Destination{" "}
          <input
            required
            maxLength={160}
            name="destination"
            defaultValue={order?.destination}
          />
        </label>
        <label>
          Service level{" "}
          <select
            name="serviceLevel"
            defaultValue={order?.service_level ?? "standard"}
          >
            <option value="standard">Standard</option>
            <option value="express">Express</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <label>
          Assigned operator{" "}
          <select
            name="assignedUserId"
            defaultValue={order?.assigned_user_id ?? ""}
          >
            <option value="">Unassigned</option>
            {operators
              .filter((person) => person.active)
              .map((person) => (
                <option value={person.id} key={person.id}>
                  {person.display_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Status{" "}
          <select name="status" defaultValue={order?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="booked">Booked</option>
            {order && (
              <>
                <option value="in_transit">In transit</option>
                <option value="delivered">Delivered</option>
              </>
            )}
          </select>
        </label>
        <label className="wide">
          Notes{" "}
          <textarea
            name="notes"
            maxLength={2000}
            defaultValue={order?.notes}
            rows={4}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : order ? "Save changes" : "Create order"}
        </button>
      </div>
    </form>
  );
}

export function CancelOrder({ order, role }: { order: Order; role: Role }) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (role === "viewer" || !["draft", "booked"].includes(order.status))
    return null;

  async function cancel() {
    if (!window.confirm(`Cancel ${order.reference} for ${order.customer}?`))
      return;
    setPending(true);
    setError("");
    const data = new FormData();
    data.set("action", "cancel");
    data.set("version", String(order.version));
    data.set("operationKey", key);
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "POST",
        body: data,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Cancellation failed");
      setKey(crypto.randomUUID());
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancellation failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="danger-action">
      <button
        className="button danger"
        type="button"
        onClick={cancel}
        disabled={pending}
      >
        {pending ? "Cancelling…" : "Cancel order"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
