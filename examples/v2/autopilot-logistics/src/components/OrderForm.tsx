"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { Order, Role } from "@/lib/db";
import { performBrowserAction } from "@copilotkit/react-core/v2";
import type { BrowserActionOutcome } from "@copilotkit/react-core/v2";

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
  const [serviceLevel, setServiceLevel] = useState(
    order?.service_level ?? "standard",
  );
  const editable =
    role !== "viewer" &&
    order?.status !== "cancelled" &&
    order?.status !== "delivered";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    return performBrowserAction(
      form,
      event.nativeEvent,
      async (): Promise<BrowserActionOutcome> => {
        setPending(true);
        setError("");
        const data = new FormData(form);
        let serverRejected = false;
        try {
          const response = await fetch(
            order ? `/api/orders/${order.id}` : "/api/orders",
            { method: "POST", body: data },
          );
          const result = (await response.json()) as {
            id?: string;
            version?: number;
            error?: string;
          };
          if (!response.ok) {
            serverRejected = true;
            throw new Error(result.error ?? "Order could not be saved");
          }
          setKey(crypto.randomUUID());
          if (!order) router.push(`/orders/${result.id}`);
          else router.refresh();
          return {
            status: "completed",
            recordId: result.id ?? order?.id,
            version: result.version ?? (order ? order.version + 1 : 1),
          };
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Order could not be saved",
          );
          return {
            status: serverRejected ? "failed" : "uncertain",
            reason:
              cause instanceof Error
                ? cause.message
                : "Order could not be saved",
          };
        } finally {
          setPending(false);
        }
      },
    );
  }

  if (!editable)
    return <p>This order is read-only for your account or its final status.</p>;

  return (
    <form
      data-autopilot-handler-version="1"
      data-autopilot-record-id={order?.id}
      data-autopilot-record-version={order?.version}
      data-autopilot-draft-id={order ? undefined : key}
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
        <div
          className="service-picker"
          role="group"
          aria-label="Service level"
          data-autopilot-custom-select
          data-autopilot-selected={serviceLevel}
          data-copilot-initial-value={order?.service_level ?? "standard"}
        >
          <span>Service level</span>
          <input type="hidden" name="serviceLevel" value={serviceLevel} />
          <div className="service-picker-options">
            {(["standard", "express", "priority"] as const).map((level) => (
              <button
                key={level}
                type="button"
                data-autopilot-option={level}
                aria-pressed={serviceLevel === level}
                onClick={(event) => {
                  setServiceLevel(level);
                  event.currentTarget.dispatchEvent(
                    new Event("input", { bubbles: true }),
                  );
                }}
              >
                {level[0].toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>
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

  async function cancel(event: MouseEvent<HTMLButtonElement>) {
    return performBrowserAction(
      event.currentTarget,
      event.nativeEvent,
      async (): Promise<BrowserActionOutcome> => {
        setPending(true);
        setError("");
        const data = new FormData();
        data.set("action", "cancel");
        data.set("version", String(order.version));
        data.set("operationKey", key);
        let serverRejected = false;
        try {
          const response = await fetch(`/api/orders/${order.id}`, {
            method: "POST",
            body: data,
          });
          const result = (await response.json()) as {
            error?: string;
            version?: number;
          };
          if (!response.ok) {
            serverRejected = true;
            throw new Error(result.error ?? "Cancellation failed");
          }
          setKey(crypto.randomUUID());
          router.refresh();
          return {
            status: "completed",
            recordId: order.id,
            version: result.version ?? order.version + 1,
          };
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Cancellation failed",
          );
          return {
            status: serverRejected ? "failed" : "uncertain",
            reason:
              cause instanceof Error ? cause.message : "Cancellation failed",
          };
        } finally {
          setPending(false);
        }
      },
      () => window.confirm(`Cancel ${order.reference} for ${order.customer}?`),
    );
  }

  return (
    <div
      className="danger-action"
      data-autopilot-record-id={order.id}
      data-autopilot-record-version={order.version}
    >
      <button
        className="button danger"
        data-copilot-action="cancel"
        data-copilot-confirm={`Cancel ${order.reference} for ${order.customer}`}
        data-autopilot-handler-version="1"
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
