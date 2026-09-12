import type { CommerceOrder } from "../commerce/types.js";
import type { RhoTransaction } from "../rho/types.js";
import { agentForOrder, agentForTx, orderIdFromText } from "./attribution.js";

export type MatchKind = "reference" | "fuzzy" | "unmatched";

export type LedgerMatch = {
  order: CommerceOrder;
  settlement: RhoTransaction | null;
  kind: MatchKind;
  agentId: string;
};

const WINDOW_MS = 48 * 60 * 60 * 1000;

function cents(tx: RhoTransaction) {
  return tx.amount.amount;
}

export function reconcile(orders: CommerceOrder[], transactions: RhoTransaction[]): LedgerMatch[] {
  const used = new Set<string>();
  const credits = transactions.filter((tx) => tx.status === "settled" && cents(tx) > 0);

  return orders.map((order) => {
    const byRef = credits.find((tx) => {
      if (used.has(tx.id)) return false;
      const tagged = orderIdFromText(tx.memo) || orderIdFromText(tx.note);
      return tagged === order.id || tagged === order.reference;
    });
    if (byRef) {
      used.add(byRef.id);
      return { order, settlement: byRef, kind: "reference", agentId: agentForOrder(order) };
    }

    const orderMs = Date.parse(order.createdAt);
    const fuzzy = credits.find((tx) => {
      if (used.has(tx.id)) return false;
      if (cents(tx) !== order.amountCents) return false;
      const posted = Date.parse(tx.posted_at || tx.initiated_at);
      if (!Number.isFinite(orderMs) || !Number.isFinite(posted)) return false;
      if (Math.abs(posted - orderMs) > WINDOW_MS) return false;
      const agent = agentForTx(tx);
      return !agent || agent === agentForOrder(order);
    });
    if (fuzzy) {
      used.add(fuzzy.id);
      return { order, settlement: fuzzy, kind: "fuzzy", agentId: agentForOrder(order) };
    }

    return { order, settlement: null, kind: "unmatched", agentId: agentForOrder(order) };
  });
}
