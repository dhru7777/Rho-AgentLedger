import type { CommerceOrder } from "../commerce/types.js";
import type { RhoTransaction } from "./types.js";

const ACCOUNT = "acct_agentledger_demo";

function isoDaysAgo(days: number, hour = 14) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function debit(cents: number, daysAgo: number, opts: {
  id: string;
  agent: string;
  counterparty: string;
  type?: string;
}): RhoTransaction {
  const posted = isoDaysAgo(daysAgo);
  return {
    id: opts.id,
    money_movement_id: `mm_${opts.id}`,
    account_id: ACCOUNT,
    account_name: "Agent operating account",
    status: "settled",
    transaction_type: opts.type || "ach_debit",
    amount: { amount: -Math.abs(cents), currency: "USD" },
    initiated_at: posted,
    posted_at: posted,
    counterparty_name: opts.counterparty,
    memo: `agent:${opts.agent}`,
    note: `Labeled Rho fixture · agent:${opts.agent}`,
    source: "fixture",
  };
}

function credit(cents: number, daysAgo: number, opts: {
  id: string;
  agent: string;
  counterparty: string;
  reference: string;
}): { order: CommerceOrder; tx: RhoTransaction } {
  const posted = isoDaysAgo(daysAgo, 16);
  const order: CommerceOrder = {
    id: `ord_${opts.id}`,
    platform: "fixture",
    agentId: opts.agent,
    agentName:
      opts.agent === "sales"
        ? "Shopping Agent"
        : opts.agent === "support"
          ? "Support Agent"
          : "Research Agent",
    title: opts.counterparty,
    amountCents: cents,
    currency: "USD",
    createdAt: posted,
    reference: opts.reference,
  };
  const tx: RhoTransaction = {
    id: opts.id,
    money_movement_id: `mm_${opts.id}`,
    account_id: ACCOUNT,
    account_name: "Agent operating account",
    status: "settled",
    transaction_type: "ach_credit",
    amount: { amount: Math.abs(cents), currency: "USD" },
    initiated_at: posted,
    posted_at: posted,
    counterparty_name: opts.counterparty,
    memo: `agent:${opts.agent} order:${order.id}`,
    note: `Labeled Rho fixture · settled sale`,
    source: "fixture",
  };
  return { order, tx };
}

/** 30-day cohort that reproduces the one-pager scorecard before any live demo run. */
export function fixtureCohort(): { orders: CommerceOrder[]; transactions: RhoTransaction[] } {
  const salesIn = [
    credit(320000, 24, { id: "rho_sales_1", agent: "sales", counterparty: "Lindt wholesale", reference: "fix_sales_1" }),
    credit(280000, 18, { id: "rho_sales_2", agent: "sales", counterparty: "Shopify UCP · chocolates", reference: "fix_sales_2" }),
    credit(242000, 9, { id: "rho_sales_3", agent: "sales", counterparty: "Stan storefront", reference: "fix_sales_3" }),
  ];
  const supportIn = [
    credit(180000, 21, { id: "rho_support_1", agent: "support", counterparty: "Retention upsell", reference: "fix_support_1" }),
    credit(140000, 11, { id: "rho_support_2", agent: "support", counterparty: "Warranty attach", reference: "fix_support_2" }),
  ];
  const researchIn = [
    credit(120000, 15, { id: "rho_research_1", agent: "research", counterparty: "ETH research memo", reference: "fix_research_1" }),
  ];

  const costs: RhoTransaction[] = [
    debit(45000, 22, { id: "rho_sales_c1", agent: "sales", counterparty: "Data enrichment API" }),
    debit(40000, 14, { id: "rho_sales_c2", agent: "sales", counterparty: "x402 nanopayment" }),
    debit(35000, 6, { id: "rho_sales_c3", agent: "sales", counterparty: "Ads spend" }),
    debit(50000, 19, { id: "rho_support_c1", agent: "support", counterparty: "Helpdesk tools" }),
    debit(30000, 8, { id: "rho_support_c2", agent: "support", counterparty: "MPP lookup" }),
    debit(60000, 16, { id: "rho_research_c1", agent: "research", counterparty: "Market data API" }),
    debit(40000, 5, { id: "rho_research_c2", agent: "research", counterparty: "ETH chart x402" }),
  ];

  return {
    orders: [...salesIn, ...supportIn, ...researchIn].map((row) => row.order),
    transactions: [...salesIn, ...supportIn, ...researchIn].map((row) => row.tx).concat(costs),
  };
}

export function matchingSettlement(order: {
  id: string;
  agentId: string;
  title: string;
  amountCents: number;
  createdAt: string;
  reference: string;
}): RhoTransaction {
  return {
    id: `rho_live_${order.reference}`,
    money_movement_id: `mm_live_${order.reference}`,
    account_id: ACCOUNT,
    account_name: "Agent operating account",
    status: "settled",
    transaction_type: "ach_credit",
    amount: { amount: Math.abs(order.amountCents), currency: "USD" },
    initiated_at: order.createdAt,
    posted_at: order.createdAt,
    counterparty_name: order.title,
    memo: `agent:${order.agentId} order:${order.id}`,
    note: "Demo settlement mirrored from the commerce receipt (Rho write API is not available).",
    source: "fixture",
  };
}
