import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile.js";
import type { CommerceOrder } from "../commerce/types.js";
import type { RhoTransaction } from "../rho/types.js";

function order(partial: Partial<CommerceOrder> & Pick<CommerceOrder, "id" | "amountCents">): CommerceOrder {
  return {
    platform: "fixture",
    agentId: "sales",
    agentName: "Shopping Agent",
    title: "Test",
    currency: "USD",
    createdAt: "2026-09-01T16:00:00.000Z",
    reference: partial.id,
    ...partial,
  };
}

function tx(partial: Partial<RhoTransaction> & Pick<RhoTransaction, "id" | "amount">): RhoTransaction {
  return {
    money_movement_id: `mm_${partial.id}`,
    account_id: "acct",
    account_name: "ops",
    status: "settled",
    transaction_type: "ach_credit",
    initiated_at: "2026-09-01T16:00:00.000Z",
    posted_at: "2026-09-01T16:00:00.000Z",
    counterparty_name: "Test",
    source: "fixture",
    ...partial,
  };
}

describe("reconcile", () => {
  it("joins on memo order id before amount+time", () => {
    const orders = [order({ id: "ord_a", amountCents: 1000 })];
    const transactions = [
      tx({
        id: "rho_wrong",
        amount: { amount: 1000, currency: "USD" },
        memo: "agent:sales order:ord_other",
      }),
      tx({
        id: "rho_hit",
        amount: { amount: 9999, currency: "USD" },
        memo: "agent:sales order:ord_a",
      }),
    ];
    const [row] = reconcile(orders, transactions);
    expect(row.kind).toBe("reference");
    expect(row.settlement?.id).toBe("rho_hit");
  });

  it("falls back to amount and timestamp when memos do not share an id", () => {
    const orders = [order({ id: "ord_b", amountCents: 4200, createdAt: "2026-09-10T12:00:00.000Z" })];
    const transactions = [
      tx({
        id: "rho_fuzzy",
        amount: { amount: 4200, currency: "USD" },
        posted_at: "2026-09-10T13:00:00.000Z",
        memo: "agent:sales",
      }),
    ];
    const [row] = reconcile(orders, transactions);
    expect(row.kind).toBe("fuzzy");
    expect(row.settlement?.id).toBe("rho_fuzzy");
  });
});
