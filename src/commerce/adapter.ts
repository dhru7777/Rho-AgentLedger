import type { Receipt } from "../types.js";
import type { CommerceOrder, CommercePlatform } from "./types.js";

const orders = new Map<string, CommerceOrder>();

function platformFor(receipt: Receipt): CommercePlatform {
  const service = receipt.service.toLowerCase();
  if (service.includes("shopify") || service.includes("ucp") || service.includes("chocolate")) {
    return "shopify-ucp";
  }
  return "x402";
}

export function recordOrderFromReceipt(receipt: Receipt): CommerceOrder | null {
  if (receipt.outcome !== "SUCCESS") return null;
  const amountCents = Math.round(Number(receipt.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
  const order: CommerceOrder = {
    id: `ord_${receipt.id}`,
    platform: platformFor(receipt),
    agentId: "sales",
    agentName: "Sales Agent",
    title: receipt.service,
    amountCents,
    currency: "USD",
    createdAt: receipt.createdAt,
    reference: receipt.id,
  };
  orders.set(order.id, order);
  return order;
}

export function seedOrders(list: CommerceOrder[]) {
  for (const order of list) orders.set(order.id, order);
}

export function listOrders(): CommerceOrder[] {
  return [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrder(id: string) {
  return orders.get(id);
}
