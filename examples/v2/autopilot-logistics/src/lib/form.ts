import { DomainError } from "./domain";
import type { OrderInput } from "./domain";

export function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function orderInput(data: FormData): OrderInput {
  return {
    customer: field(data, "customer"),
    origin: field(data, "origin"),
    destination: field(data, "destination"),
    shipDate: field(data, "shipDate"),
    serviceLevel: field(data, "serviceLevel") as OrderInput["serviceLevel"],
    assignedUserId: field(data, "assignedUserId") || null,
    status: field(data, "status") as OrderInput["status"],
    notes: field(data, "notes"),
  };
}

export function errorResponse(error: unknown): Response {
  return Response.json(
    { error: error instanceof DomainError ? error.message : "Change failed" },
    { status: error instanceof DomainError ? error.status : 500 },
  );
}
