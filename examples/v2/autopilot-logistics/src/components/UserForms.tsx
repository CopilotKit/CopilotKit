"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/db";

type Person = { id: string; display_name: string; role: Role; active: number };

export function UserForm({ person }: { person?: Person }) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(
    form: HTMLFormElement,
    action: "create" | "update" | "deactivate",
  ) {
    setPending(true);
    setError("");
    const data = new FormData(form);
    data.set("action", action);
    data.set("operationKey", key);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        body: data,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "User change failed");
      setKey(crypto.randomUUID());
      if (!person) form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "User change failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="user-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget, person ? "update" : "create");
      }}
    >
      {person && <input type="hidden" name="id" value={person.id} />}
      <label>
        Display name{" "}
        <input
          required
          name="displayName"
          maxLength={100}
          defaultValue={person?.display_name}
        />
      </label>
      <label>
        Role{" "}
        <select name="role" defaultValue={person?.role ?? "operator"}>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <button className="button primary" type="submit" disabled={pending}>
        {person ? "Save user" : "Add user"}
      </button>
      {person?.active === 1 && (
        <button
          className="button danger"
          type="button"
          disabled={pending}
          onClick={(event) => {
            if (window.confirm(`Deactivate ${person.display_name}?`))
              void submit(event.currentTarget.form!, "deactivate");
          }}
        >
          Deactivate
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
