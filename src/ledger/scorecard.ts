import { listOrders, recordOrderFromReceipt, seedOrders } from "../commerce/adapter.js";
import { listTxs, recordTx } from "../db/store.js";
import { fixtureCohort } from "../rho/fixtures.js";
import { listRhoTransactions, recordMirroredSettlement } from "../rho/client.js";
import { listBuyerCharges, listSellerCharges } from "../stripe/pay.js";
import { loadBuyerTrust, loadSellerTrust } from "../trust.js";
import type { Receipt } from "../types.js";
import { AGENT_IDS, AGENT_NAMES, agentForTx, type AgentId } from "./attribution.js";
import { creditForAgents } from "./credit.js";
import { reconcile, type LedgerMatch } from "./reconcile.js";

let seeded = false;

function ensureSeed() {
  if (seeded) return;
  seedOrders(fixtureCohort().orders);
  seeded = true;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function trustScore(roi: number, matchRate: number) {
  const roiPts = Math.min(40, roi * 5);
  const matchPts = matchRate * 40;
  return Math.round(clamp(20 + roiPts + matchPts, 1, 99));
}

export type AgentCard = {
  agentId: AgentId;
  name: string;
  revenueCents: number;
  costCents: number;
  roi: number;
  trust: number;
  matched: number;
  orders: number;
  question: string;
};

export function ingestReceipt(receipt: Receipt) {
  ensureSeed();
  const order = recordOrderFromReceipt(receipt);
  if (!order) return null;
  recordMirroredSettlement(order);
  return order;
}

export async function buildScorecard() {
  ensureSeed();
  try {
    const [buyerCharges, sellerCharges] = await Promise.all([listBuyerCharges(20), listSellerCharges(20)]);
    for (const ch of buyerCharges) {
      recordTx({
        id: `stripe_buy_${ch.id}`,
        at: new Date((ch.created || 0) * 1000).toISOString(),
        agentId: "sales",
        role: "buyer",
        rail: "fiat",
        direction: "out",
        amountCents: ch.amountCents,
        currency: "USD",
        status: ch.status || "succeeded",
        title: "Stripe charge",
        reference: ch.id,
        explorerUrl: ch.paymentIntentId
          ? `https://dashboard.stripe.com/test/payments/${ch.paymentIntentId}`
          : undefined,
        stripePaymentIntentId: ch.paymentIntentId,
      });
    }
    for (const ch of sellerCharges) {
      recordTx({
        id: `stripe_sell_${ch.id}`,
        at: new Date((ch.created || 0) * 1000).toISOString(),
        agentId: "sales",
        role: "seller",
        rail: "fiat",
        direction: "in",
        amountCents: ch.amountCents,
        currency: "USD",
        status: ch.status || "succeeded",
        title: "Stripe receipt",
        reference: ch.id,
        explorerUrl: ch.paymentIntentId
          ? `https://dashboard.stripe.com/test/payments/${ch.paymentIntentId}`
          : undefined,
        stripePaymentIntentId: ch.paymentIntentId,
      });
    }
  } catch {
    /* Stripe history is optional when keys are missing */
  }
  const feed = await listRhoTransactions();
  const orders = listOrders();
  const matches = reconcile(orders, feed.transactions);
  const cards = AGENT_IDS.map((id) => cardFor(id, matches, feed.transactions));
  const matchRateByAgent = Object.fromEntries(
    AGENT_IDS.map((id) => {
      const mine = matches.filter((row) => row.agentId === id);
      return [id, mine.length ? mine.filter((row) => row.settlement).length / mine.length : 0];
    }),
  ) as Record<AgentId, number>;
  const revenueByAgent = Object.fromEntries(cards.map((c) => [c.agentId, c.revenueCents])) as Record<AgentId, number>;
  const costByAgent = Object.fromEntries(cards.map((c) => [c.agentId, c.costCents])) as Record<AgentId, number>;
  const [buyerTrust, sellerTrust] = await Promise.all([loadBuyerTrust(), loadSellerTrust()]);
  const credit = await creditForAgents({
    matchRateByAgent,
    revenueByAgent,
    costByAgent,
    buyerTrust,
    sellerTrust,
    rhoLive: feed.mode === "live",
  });
  const winner = [...credit].sort((a, b) => b.score - a.score)[0];
  return {
    mode: feed.mode,
    liveError: feed.liveError || null,
    generatedAt: new Date().toISOString(),
    question: "Which agent should I trust with more money?",
    winner: winner
      ? { agentId: winner.agentId, name: winner.name, trust: winner.score, creditLineUsd: winner.creditLineUsd }
      : null,
    agents: cards,
    credit,
    transactions: listTxs(),
    matches: matches.map(publicMatch),
    rhoCount: feed.transactions.length,
    thesis: "Rho turns prepaid agent spend into a 4C credit file: character, capacity, collateral, condition.",
  };
}

function cardFor(id: AgentId, matches: LedgerMatch[], txs: Awaited<ReturnType<typeof listRhoTransactions>>["transactions"]): AgentCard {
  const mine = matches.filter((row) => row.agentId === id);
  const revenueCents = mine.reduce((n, row) => n + row.order.amountCents, 0);
  const costCents = txs
    .filter((tx) => tx.status === "settled" && tx.amount.amount < 0 && agentForTx(tx) === id)
    .reduce((n, tx) => n + Math.abs(tx.amount.amount), 0);
  const matched = mine.filter((row) => row.settlement).length;
  const matchRate = mine.length ? matched / mine.length : 0;
  const roi = costCents > 0 ? revenueCents / costCents : revenueCents > 0 ? 99 : 0;
  const trust = trustScore(roi, matchRate);
  return {
    agentId: id,
    name: AGENT_NAMES[id],
    revenueCents,
    costCents,
    roi: Number(roi.toFixed(2)),
    trust,
    matched,
    orders: mine.length,
    question: trust >= 85 ? "Give this agent more budget." : trust >= 70 ? "Hold budget steady." : "Do not increase budget.",
  };
}

function publicMatch(row: LedgerMatch) {
  return {
    orderId: row.order.id,
    title: row.order.title,
    agentId: row.agentId,
    amountCents: row.order.amountCents,
    kind: row.kind,
    rhoId: row.settlement?.id || null,
    postedAt: row.settlement?.posted_at || null,
    source: row.settlement?.source || null,
  };
}
